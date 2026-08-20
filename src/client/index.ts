/**
 * File reference plugin, browser half: mounts the `atFile` Remote namespace
 * and registers the '@'-trigger `file` source into `ctx.inputTriggers`.
 * Candidates come from the `atFile.list` Remote addressed by the per-call
 * session projection (the host resolves cwd from the session header). A pick
 * lands the literal `@path ` text and the prompt ships the same literal;
 * determinism lives host-side — the pre-step boundary (the package's Node
 * half) recognizes `@path` tokens of user messages and injects the file
 * content for every entry point. Draft chip visuals derive from the lexicon
 * scan; this source implements no reference codec.
 *
 * Index fetches are cached per session (single-flight): the per-keystroke
 * candidates re-poll a settled snapshot locally, so one session costs one
 * Remote call. The scope-birth warm hook prewarms the session's key;
 * connection/reset clears everything.
 *
 * This half deliberately imports no browser-runtime package: it consumes the
 * Cordis Context and the `ctx.remote`/`ctx.inputTriggers` services through
 * narrow structural faces, so the bundle stays installable against any host
 * that provides the input-trigger pipeline.
 *
 * @module dsh-at-file/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  ClientSessionContext,
  InputTriggerService,
  InputTriggerSource,
} from './trigger-contract.ts'
import TYPERT_REMOTE from '../../typert/typert.remote-client.js'
import type { AtFileEntry, AtFileListResult } from '../types.ts'
import { filterFiles } from './filter.ts'

/** The `atFile` Remote face the mounted namespace exposes to this plugin. */
export interface AtFileRemote {
  list(sessionId: string, signal?: AbortSignal): Promise<RemoteResult<AtFileListResult>>
}

/** Structural `ctx.remote`: the mounted namespace plus the mount API. */
export interface ClientRemote {
  $mount(contribution: unknown): Promise<unknown>
  atFile?: AtFileRemote
}

/** Structural session list face: only the addressed-child guard is read. */
export interface SessionList {
  subagentAddress?(sessionId: string): unknown
}

/** One session's index fetch: the shared promise plus its own abort handle. */
interface IndexFetch {
  readonly promise: Promise<readonly AtFileEntry[]>
  readonly abort: AbortController
  /** Settled index for synchronous lexicon reads (unset while in flight or on failure). */
  settled?: readonly AtFileEntry[]
}

/** Required services: the trigger source face, the Remote mount, and the session list. */
export const inject = ['inputTriggers', 'remote', 'sessions']

/**
 * Client plugin body: mount the Remote namespace and register the '@' source.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const remote = ctx.get('remote') as ClientRemote | undefined
  if (remote !== undefined) {
    // $mount registers in the calling fiber; its disposer is released with it.
    void remote.$mount(TYPERT_REMOTE)
  }
  const sessions = ctx.get('sessions') as SessionList | undefined
  // Session-keyed index cache; single-flight per key. Plugin-closure state:
  // the fiber effect below is its teardown boundary.
  const fetches = new Map<string, IndexFetch>()
  // Per-session lexicon invalidation listeners (subscribeLexicon consumers).
  const lexiconListeners = new Map<string, Set<() => void>>()

  const notifyLexicon = (sessionId: string): void => {
    for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
      try {
        listener()
      } catch (error) {
        // Contain listener failures: settlement notifies from an ignored
        // promise chain (a throw would surface as an unhandled rejection)
        // and one faulty consumer must not starve the others.
        console.error('[dsh-at-file] lexicon listener failed:', error)
      }
    }
  }

  const fetchIndex = (sessionId: string): Promise<readonly AtFileEntry[]> => {
    if (sessions?.subagentAddress?.(sessionId) !== undefined) return Promise.resolve([])
    if (remote?.atFile === undefined) return Promise.resolve([])
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing.promise
    const abort = new AbortController()
    const promise = (async () => {
      const result = await remote.atFile!.list(sessionId, abort.signal)
      if (!result.ok) throw new Error(`atFile.list failed: ${result.error.code ?? 'remote'}: ${result.error.message}`)
      return result.value.files
    })()
    const entry: IndexFetch = { promise, abort }
    fetches.set(sessionId, entry)
    promise.then(
      // Settled snapshot backs the synchronous lexicon reads.
      (files) => {
        entry.settled = files
        notifyLexicon(sessionId)
      },
      // A failed fetch must not poison the key: the next consumer retries.
      () => {
        /* v8 ignore next 2 -- only a stale-fetch race with a replaced entry
           reaches the miss arm; specs drive fetches to settle before reuse. */
        if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
      },
    )
    return promise
  }

  const clearAll = (): void => {
    for (const [key, entry] of [...fetches]) {
      fetches.delete(key)
      entry.abort.abort()
      notifyLexicon(key)
    }
  }

  const source: InputTriggerSource = {
    trigger: '@',
    name: 'file',
    // File references are the most general '@' kind: above subagent and
    // plugin-id sources in the grouped menu.
    order: -10,
    async candidates(session: ClientSessionContext, { query, signal }) {
      const files = await fetchIndex(session.sessionId)
      // Superseded keystroke: the shared fetch stays warm, this caller yields.
      if (signal.aborted) return []
      return filterFiles(files, query)
    },
    warm(session: ClientSessionContext) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      fetchIndex(session.sessionId).catch(() => {})
    },
    lexicon(session: ClientSessionContext) {
      return fetches.get(session.sessionId)?.settled?.map(file => file.path)
    },
    subscribeLexicon(session: ClientSessionContext, listener) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
    onPick({ candidate }) {
      // Plain-text-reference decision: the pick lands plain text and the
      // prompt ships the same literal. Determinism lives host-side — the
      // pre-step boundary expands `@path`; a token naming no readable file
      // stays ordinary prose.
      return { text: `@${candidate.name} ` }
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerService
  // The connection-reset event is declared by the harness runtime, not by
  // cordis itself; route through a structural on() so the bundle stays
  // installable without it.
  (ctx as { on(name: string, listener: () => void): unknown }).on('connection/reset', clearAll)
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
      clearAll()
    }
  }, 'dsh-at-file: source')
}
