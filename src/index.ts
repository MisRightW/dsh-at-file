/**
 * Workspace file references, host half: the `ctx.atFile` index service behind
 * the `atFile.list` Remote, and the `agent/pre-step` boundary that expands
 * every `@path` token of a user message into an injected file-content message.
 *
 * The browser half (`dsh-at-file/client`) lists candidates through the Remote
 * and lands the literal `@path` text in the draft; this half owns the two
 * deterministic sides of the gesture: the bounded index walk and the
 * injection. The expansion follows the skill-gesture posture: tokens that
 * name no readable regular file inside the size bound stay plain prose,
 * never an error.
 *
 * @module dsh-at-file
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FileSystem, FsDirEntry, FsTarget } from '@deepseek-ai/dsh-fs'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId, UserMessage } from '@deepseek-ai/dsh-session'
import type { AtFileEntry, AtFileListResult, AtFileReferenceSource } from './types.ts'

export type { AtFileEntry, AtFileListResult, AtFileReferenceSource } from './types.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'at-file': AtFileReferenceSource
  }
}

/** Index result cap. */
export const DEFAULT_MAX_FILES = 1000
/** Maximum directory depth walked from the session cwd. */
export const DEFAULT_MAX_DEPTH = 8
/** Per-reference injection cap, matching the agent-instructions workspace bound. */
export const DEFAULT_MAX_BYTES = 65536
/** Per-step expansion cap. */
export const DEFAULT_MAX_REFERENCES = 8
/** Directory basenames never indexed by default: version-control and dependency/build noise. */
export const DEFAULT_SKIP_DIRECTORIES = [
  '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', '.venv',
] as const

/** dsh-at-file plugin configuration. */
export interface Config {
  /** Maximum index rows one `list` call returns. @default 1000 */
  maxFiles?: number
  /** Maximum directory depth walked from the session cwd. @default 8 */
  maxDepth?: number
  /** Maximum UTF-8 bytes of one file's content injected per reference; larger files are not indexed. @default 65536 */
  maxBytes?: number
  /** Maximum references expanded in one pre-step. @default 8 */
  maxReferences?: number
  /**
   * Directory basenames never indexed (case-insensitive), extending the
   * always-on hidden-entry skip. @default .git, node_modules, dist, build, out, coverage, __pycache__, .venv
   */
  skipDirectories?: string[]
}

/** Validate and default the dsh-at-file configuration. */
export const Config: z<Config> = z.object({
  maxFiles: z.number().step(1).min(1).default(DEFAULT_MAX_FILES),
  maxDepth: z.number().step(1).min(1).default(DEFAULT_MAX_DEPTH),
  maxBytes: z.number().step(1).min(1).default(DEFAULT_MAX_BYTES),
  maxReferences: z.number().step(1).min(1).default(DEFAULT_MAX_REFERENCES),
  skipDirectories: z.array(z.string().min(1)).default([...DEFAULT_SKIP_DIRECTORIES]),
})

/** Resolved plugin configuration with every default applied. */
export type ResolvedConfig = Required<Config>

/** Resolve the plugin configuration, applying the shipped defaults. */
export function resolveConfig(config: Config): ResolvedConfig {
  const resolved: ResolvedConfig = {
    maxFiles: config.maxFiles ?? DEFAULT_MAX_FILES,
    maxDepth: config.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
    maxReferences: config.maxReferences ?? DEFAULT_MAX_REFERENCES,
    skipDirectories: config.skipDirectories ?? [...DEFAULT_SKIP_DIRECTORIES],
  }
  for (const [name, value] of Object.entries(resolved)) {
    if (name === 'skipDirectories') continue
    assertPositiveInteger(name, value as number)
  }
  return resolved
}

/** Cordis plugin name. */
export const name = 'at-file'

/** A whitespace-bounded `@path` token anywhere in the text. */
const REFERENCE_TOKEN = /(^|\s)@([^\s@]+)/g
/** Trailing sentence punctuation a path token may carry (`@a.ts,` → `@a.ts`). */
const TRAILING_PUNCTUATION = /[,.!?;:)]+$/u

/**
 * Bounded workspace file index. One `list` call walks the session project
 * directory under the plugin's depth and count caps and returns
 * workspace-relative paths, deterministic in path order. The filesystem
 * backend is read lazily per call, so a composition without `ctx.fs` yields
 * an empty index instead of failing to load.
 */
export class AtFileIndex {
  /**
   * @param fs - live filesystem accessor; absent backends yield an empty index.
   * @param config - resolved plugin bounds.
   */
  constructor(
    private readonly fs: () => FileSystem | undefined,
    private readonly config: ResolvedConfig,
  ) {}

  /**
   * List indexed workspace files under `cwd`.
   * @param cwd - the session's project directory (absolute host path).
   * @param signal - aborts the walk.
   * @returns workspace-relative file paths in path order.
   */
  async list(cwd: string, signal: AbortSignal): Promise<readonly AtFileEntry[]> {
    signal.throwIfAborted()
    const fileSystem = this.fs()
    if (fileSystem === undefined) return []
    const root = await fileSystem.resolve(cwd, { signal })
    signal.throwIfAborted()
    const out: AtFileEntry[] = []
    await this.walk(fileSystem, '', root, 0, out, signal)
    out.sort((a, b) => a.path.localeCompare(b.path))
    return out
  }

  private async walk(
    fileSystem: FileSystem,
    rootRel: string,
    target: FsTarget,
    depth: number,
    out: AtFileEntry[],
    signal: AbortSignal,
  ): Promise<void> {
    /* v8 ignore next 2 -- the loop-top maxFiles check intercepts before any
       recursive call; this entry check is defensive redundancy for recursion. */
    if (out.length >= this.config.maxFiles) return
    let children: readonly FsDirEntry[]
    try {
      children = await fileSystem.listDir(target, signal)
    } catch {
      // An unreadable directory drops out of the index; the rest of the tree
      // stays available. Listing is best-effort, like any picker index.
      return
    }
    for (const child of children) {
      if (out.length >= this.config.maxFiles) return
      signal.throwIfAborted()
      if (child.name.startsWith('.')) continue
      const rel = rootRel.length === 0 ? child.name : `${rootRel}/${child.name}`
      if (child.type === 'directory') {
        if (this.config.skipDirectories.includes(child.name.toLowerCase())) continue
        if (depth + 1 > this.config.maxDepth) continue
        await this.walk(fileSystem, rel, child.target, depth + 1, out, signal)
        continue
      }
      /* v8 ignore next 2 -- the local backend reports every child's type; the
         other-arm tolerates exotic entries (broken links, special files). */
      if (child.type !== 'file') continue
      // Files beyond the injection cap are not indexed: picking one would
      // silently never inject, so the index only lists what can be referenced.
      if (child.size !== undefined && child.size > this.config.maxBytes) continue
      /* v8 ignore next 2 -- the local backend always reports file sizes; the
         undefined arm serves backends that omit them (AtFileEntry.size is optional). */
      out.push(child.size === undefined ? { path: rel } : { path: rel, size: child.size })
    }
  }
}

/**
 * The `ctx.atFile` service exposed over the `atFile` Remote namespace: the
 * browser lists candidates through `atFile.list`, addressed by session so the
 * host resolves cwd from the session header — the client never submits a raw
 * path.
 */
export class AtFileService extends TypertRemoteService {
  private readonly index: AtFileIndex

  /**
   * @param ctx - host Cordis context.
   * @param config - resolved plugin bounds.
   */
  constructor(ctx: Context, config: ResolvedConfig) {
    super(ctx, 'atFile')
    this.index = new AtFileIndex(() => ctx.get('fs') as FileSystem | undefined, config)
  }

  /**
   * List the workspace file index of one session's project directory.
   * @param sessionId - the session whose header cwd resolves the project root.
   * @param signal - aborts the walk.
   * @returns workspace-relative paths in path order.
   */
  @Remote
  async list(sessionId: SessionId, signal: AbortSignal): Promise<AtFileListResult> {
    signal.throwIfAborted()
    const session = this.ctx.get('sessions')?.get(sessionId)
    if (session === undefined) throw new Error(`at-file: session "${sessionId}" not found`)
    const cwd = session.header.cwd
    if (cwd === undefined) throw new Error(`at-file: session "${sessionId}" has no project cwd`)
    const files = await this.index.list(cwd, signal)
    return { files }
  }
}

/**
 * `@path` tokens of the claimed user messages, deduplicated in first-seen
 * order and capped at `max`. Only direct user input can forge a gesture;
 * injected context sources are never scanned.
 * @param messages - the step's claimed batch.
 * @param max - expansion cap.
 * @returns candidate workspace-relative paths, unvalidated against the index.
 */
function referencedPaths(messages: readonly UserMessage[], max: number): string[] {
  const paths: string[] = []
  for (const message of messages) {
    if ((message.source as { kind?: unknown }).kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      for (const match of block.text.matchAll(REFERENCE_TOKEN)) {
        const raw = match[2]
        /* v8 ignore next 2 -- the second capture group always matches by construction. */
        if (raw === undefined) continue
        const path = raw.replace(TRAILING_PUNCTUATION, '')
        if (path.length === 0) continue
        if (!paths.includes(path)) paths.push(path)
        if (paths.length >= max) return paths
      }
    }
  }
  return paths
}

/**
 * Read one reference into an injected user message. Missing targets, non-file
 * types, and files beyond `maxBytes` return undefined — the token stays plain
 * prose, the same silent-skip posture as the skill gesture boundary. Abort
 * surfaces through the caller's `signal.throwIfAborted()`.
 * @param fs - filesystem backend for resolution and reads.
 * @param cwd - the session's project directory.
 * @param path - the user's workspace-relative path.
 * @param maxBytes - per-reference byte bound.
 * @param signal - aborts the read.
 * @returns the injected message, or undefined when the reference is unusable.
 */
async function readReference(
  fs: FileSystem,
  cwd: string,
  path: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<UserMessage | undefined> {
  try {
    const target = await fs.resolve(path, { cwd, signal })
    const info = await fs.stat(target, signal)
    if (info === undefined || info.type !== 'file') return undefined
    if (info.size !== undefined && info.size > maxBytes) return undefined
    const text = await fs.readText(target, signal)
    const bytes = new TextEncoder().encode(text).byteLength
    /* v8 ignore next 4 -- the local backend's stat always reports an exact size,
       so the byte-level bound is only reachable with an unreliable backend. */
    if (bytes > maxBytes) return undefined
    return createUserMessage({
      content: [{ type: 'text', text: renderFileReference(path, text) }],
      source: { kind: 'at-file', path, bytes },
    })
  } catch {
    // An unresolvable, unreadable, or malformed reference stays plain prose;
    // abort is handled at the loop boundary, never swallowed here.
    return undefined
  }
}

/** Model-facing framing of one injected file reference. */
function renderFileReference(path: string, text: string): string {
  return `<at-file path="${escapeAttribute(path)}">\n${text}\n</at-file>`
}

/** Escape the path attribute inside the pseudo-XML frame. */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function assertPositiveInteger(name: string, value: number, minimum = 1): void {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`at-file: ${name} must be an integer greater than or equal to ${minimum}`)
  }
}

/**
 * Register the `atFile` index service and the `@path` pre-step expansion.
 * @param ctx - host Cordis context.
 * @param config - plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  // The service registers itself as `ctx.atFile` through the TypertRemoteService
  // constructor; the typert-loader mounts its ./typert manifest automatically.
  new AtFileService(ctx, resolved)

  // User-explicit file reference: a claimed user message whose text carries
  // `@path` tokens naming readable regular files under the session cwd enters
  // this step as injected context appended after every other injection —
  // background first, the material the model must act on last. Only
  // `source.kind === 'user'` messages are scanned, so external text cannot
  // forge the gesture, and an unresolvable token stays ordinary prose.
  ctx.on('agent/pre-step', async (
    { agent, messages, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const paths = referencedPaths(messages, resolved.maxReferences)
    if (paths.length === 0) return decision
    signal.throwIfAborted()
    const fs = ctx.get('fs')
    if (fs === undefined) return decision
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return decision
    const injections: UserMessage[] = []
    for (const path of paths) {
      signal.throwIfAborted()
      const message = await readReference(fs, cwd, path, resolved.maxBytes, signal)
      if (message !== undefined) injections.push(message)
    }
    if (injections.length === 0) return decision
    return { kind: 'enter', messages: [...decision.messages, ...injections] }
  })
}
