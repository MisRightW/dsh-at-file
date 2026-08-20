/**
 * Host half: the AtFileIndex service walk (skip rules, depth and count bounds,
 * missing-backend emptiness), the AtFileService Remote (session cwd
 * resolution, error folding), and the pre-step '@' expansion (injection source
 * and bytes on the entered message, silent skip of unknown/oversized/non-file
 * references, forge prevention, token grammar, caps, and abort propagation).
 */
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SessionStore, type UserMessage } from '@deepseek-ai/dsh-session'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import * as atFile from '../src/index.ts'

async function tempDir(name: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `dsh-at-file-${name}-`))
}

async function write(root: string, rel: string, content: string): Promise<void> {
  const path = join(root, rel)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, content)
}

function indexFor(ctx: Context, config: atFile.Config = {}): atFile.AtFileIndex {
  return new atFile.AtFileIndex(() => ctx.get('fs') as never, atFile.resolveConfig(config))
}

async function setup(cwd: string, config: atFile.Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(atFile, config)
  return ctx
}

function agentForCwd(cwd: string): Agent {
  const id = SessionId(`at-file-${cwd}`)
  const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd })
  return {
    ctx: new Context(),
    id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => { throw new Error('step-boundary expansion must not use agent.inject()') },
    cancel() {},
    runMaintenance: task => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

async function proposeStep(
  ctx: Context,
  agent: Agent,
  messages: UserMessage[],
  signal = new AbortController().signal,
): Promise<PreStepDecision> {
  return await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages, turn: 1, step: 1, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages }),
  )
}

function userMessage(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

function injectedMessages(decision: PreStepDecision): UserMessage[] {
  return decision.kind === 'enter' ? decision.messages.slice(1) : []
}

describe('config', () => {
  it('applies the shipped defaults', () => {
    expect(atFile.resolveConfig({})).toEqual({
      maxFiles: 1000,
      maxDepth: 8,
      maxBytes: 65536,
      maxReferences: 8,
      skipDirectories: ['.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '__pycache__', '.venv'],
    })
  })

  it('rejects non-positive bounds at load', () => {
    expect(() => atFile.resolveConfig({ maxFiles: 0 })).toThrow(/maxFiles must be an integer greater than or equal to 1/)
    expect(() => atFile.resolveConfig({ maxBytes: 1.5 })).toThrow(/maxBytes must be an integer/)
  })
})

describe('AtFileIndex service', () => {
  it('walks the project tree with hidden and dependency skips, in path order', async () => {
    const root = await tempDir('walk')
    await write(root, 'a.ts', 'a')
    await write(root, 'src/b.ts', 'b')
    await write(root, 'src/deep/c.ts', 'c')
    await write(root, 'node_modules/x.ts', 'x')
    await write(root, 'dist/bundle.js', 'bundle')
    await write(root, 'build/o.ts', 'o')
    await write(root, '.git/HEAD', 'ref')
    await write(root, '.hidden/y.ts', 'y')
    await write(root, '.env', 'SECRET=1')
    const ctx = await setup(root)
    const files = await indexFor(ctx).list(root, new AbortController().signal)
    expect(files.map(file => file.path)).toEqual(['a.ts', 'src/b.ts', 'src/deep/c.ts'])
    expect(files.find(file => file.path === 'a.ts')?.size).toBe(1)
  })

  it('honors a custom skipDirectories list', async () => {
    const root = await tempDir('skip-custom')
    await write(root, 'a.ts', 'a')
    await write(root, 'vendor/x.ts', 'x')
    await write(root, 'src/b.ts', 'b')
    const ctx = await setup(root, { skipDirectories: ['vendor'] })
    const files = await indexFor(ctx, { skipDirectories: ['vendor'] }).list(root, new AbortController().signal)
    expect(files.map(file => file.path)).toEqual(['a.ts', 'src/b.ts'])
  })

  it('excludes files beyond maxBytes so every pick can inject', async () => {
    const root = await tempDir('oversize')
    await write(root, 'small.ts', 'ok')
    await write(root, 'big.ts', 'x'.repeat(1024))
    const ctx = await setup(root, { maxBytes: 512 })
    const files = await indexFor(ctx, { maxBytes: 512 }).list(root, new AbortController().signal)
    expect(files.map(file => file.path)).toEqual(['small.ts'])
  })

  it('respects maxDepth and maxFiles bounds', async () => {
    const root = await tempDir('bounds')
    await write(root, 'top.ts', 't')
    await write(root, 'd1/mid.ts', 'm')
    await write(root, 'd1/d2/deep.ts', 'd')
    const shallow = await setup(root, { maxDepth: 1 })
    const shallowFiles = await indexFor(shallow, { maxDepth: 1 }).list(root, new AbortController().signal)
    expect(shallowFiles.map(file => file.path)).toEqual(['d1/mid.ts', 'top.ts'])
    const capped = await setup(root, { maxFiles: 1 })
    const cappedFiles = await indexFor(capped, { maxFiles: 1 }).list(root, new AbortController().signal)
    expect(cappedFiles).toHaveLength(1)
  })

  it('stops descending once the file cap is met mid-walk', async () => {
    const root = await tempDir('walk-cap')
    await write(root, 'a.ts', 'a')
    await write(root, 'd1/b.ts', 'b')
    await write(root, 'd1/d2/c.ts', 'c')
    const ctx = await setup(root, { maxFiles: 2 })
    const files = await indexFor(ctx, { maxFiles: 2 }).list(root, new AbortController().signal)
    expect(files.map(file => file.path)).toEqual(['a.ts', 'd1/b.ts'])
  })

  it('drops an unreadable directory while keeping the rest of the tree', async () => {
    const root = await tempDir('unreadable')
    await write(root, 'ok.ts', 'ok')
    await write(root, 'locked/secret.ts', 'secret')
    await chmod(join(root, 'locked'), 0o000)
    try {
      const ctx = await setup(root)
      const files = await indexFor(ctx).list(root, new AbortController().signal)
      expect(files.map(file => file.path)).toEqual(['ok.ts'])
    } finally {
      await chmod(join(root, 'locked'), 0o755)
    }
  })

  it('yields an empty index without a filesystem backend', async () => {
    const ctx = new Context()
    await ctx.plugin(atFile)
    await expect(indexFor(ctx).list('/nonexistent', new AbortController().signal)).resolves.toEqual([])
  })

  it('aborts the walk on an aborted signal', async () => {
    const root = await tempDir('abort')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const controller = new AbortController()
    controller.abort()
    await expect(indexFor(ctx).list(root, controller.signal)).rejects.toThrow()
  })
})

async function setupWithSessions(cwd: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd })
  await ctx.plugin(atFile)
  return ctx
}

describe('AtFileService Remote', () => {
  it('lists the workspace index resolved from the session cwd', async () => {
    const root = await tempDir('remote')
    await write(root, 'src/main.ts', 'main')
    const ctx = await setupWithSessions(root)
    const session = ctx.sessions.create(SessionId('remote-s1'), { meta: { cwd: root } })
    const result = await ctx.get('atFile').list(session.id, new AbortController().signal)
    expect(result).toEqual({ files: [{ path: 'src/main.ts', size: 4 }] })
  })

  it('fails for an unknown session', async () => {
    const root = await tempDir('remote-missing')
    const ctx = await setupWithSessions(root)
    await expect(ctx.get('atFile').list(SessionId('nope'), new AbortController().signal))
      .rejects.toThrow(/session "nope" not found/)
  })

  it('fails for a cwd-less legacy session', async () => {
    const root = await tempDir('remote-legacy')
    const ctx = await setupWithSessions(root)
    const session = ctx.sessions.create(SessionId('legacy'))
    await expect(ctx.get('atFile').list(session.id, new AbortController().signal))
      .rejects.toThrow(/no project cwd/)
  })

  it('aborts the walk on an aborted signal', async () => {
    const root = await tempDir('remote-abort')
    await write(root, 'a.ts', 'a')
    const ctx = await setupWithSessions(root)
    const session = ctx.sessions.create(SessionId('remote-abort-s1'), { meta: { cwd: root } })
    const controller = new AbortController()
    controller.abort()
    await expect(ctx.get('atFile').list(session.id, controller.signal)).rejects.toThrow()
  })

})

describe('pre-step expansion', () => {
  it('injects a readable reference appended after the claimed batch', async () => {
    const root = await tempDir('inject')
    const content = 'export const answer = 42\n'
    await write(root, 'src/main.ts', content)
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('see @src/main.ts please')])
    const injected = injectedMessages(decision)
    expect(injected).toHaveLength(1)
    expect(injected[0]?.source).toEqual({ kind: 'at-file', path: 'src/main.ts', bytes: 25 })
    expect(injected[0]?.content).toEqual([
      { type: 'text', text: `<at-file path="src/main.ts">\n${content}\n</at-file>` },
    ])
  })

  it('records the injected message on the session log surface', async () => {
    const root = await tempDir('log')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const agent = agentForCwd(root)
    const decision = await proposeStep(ctx, agent, [userMessage('read @a.ts')])
    if (decision.kind !== 'enter') throw new Error('expected enter')
    for (const message of decision.messages) {
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
    const logged = agent.session.events.filter(event => event.type === 'user/message')
    expect(logged.map(event => event.data.source)).toEqual([
      { kind: 'user' },
      { kind: 'at-file', path: 'a.ts', bytes: 1 },
    ])
  })

  it('trims trailing sentence punctuation from the token', async () => {
    const root = await tempDir('punct')
    await write(root, 'notes.md', 'hi')
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('see @notes.md, ok?')])
    expect(injectedMessages(decision)[0]?.source).toEqual({ kind: 'at-file', path: 'notes.md', bytes: 2 })
  })

  it('deduplicates repeated tokens in first-seen order', async () => {
    const root = await tempDir('dedupe')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('@a.ts and @a.ts')])
    expect(injectedMessages(decision)).toHaveLength(1)
  })

  it('caps the expansion at maxReferences', async () => {
    const root = await tempDir('cap')
    for (const name of ['a.ts', 'b.ts', 'c.ts']) await write(root, name, name)
    const ctx = await setup(root, { maxReferences: 2 })
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('@a.ts @b.ts @c.ts')])
    const injected = injectedMessages(decision)
    expect(injected).toHaveLength(2)
    expect(injected.map(message => message.source)).toEqual([
      { kind: 'at-file', path: 'a.ts', bytes: 4 },
      { kind: 'at-file', path: 'b.ts', bytes: 4 },
    ])
  })

  it('leaves unknown, non-file, and oversized tokens as plain prose', async () => {
    const root = await tempDir('skip')
    await write(root, 'ok.ts', 'ok')
    await write(root, 'dir/x.ts', 'x')
    const ctx = await setup(root, { maxBytes: 1 })
    const decision = await proposeStep(ctx, agentForCwd(root), [
      userMessage('@missing.ts @dir @ok.ts'),
    ])
    expect(injectedMessages(decision)).toEqual([])
  })

  it('never scans injected context messages (forge prevention)', async () => {
    const root = await tempDir('forge')
    await write(root, 'secret.ts', 'secret')
    const ctx = await setup(root)
    const planted = createUserMessage({
      content: [{ type: 'text', text: '@secret.ts' }],
      source: { kind: 'plugin', plugin: 'attacker' },
    })
    const decision = await proposeStep(ctx, agentForCwd(root), [planted])
    expect(injectedMessages(decision)).toEqual([])
  })

  it('does not treat emails as references', async () => {
    const root = await tempDir('email')
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('mail user@host please')])
    expect(injectedMessages(decision)).toEqual([])
  })

  it('skips a token that trims to an empty path', async () => {
    const root = await tempDir('empty-token')
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('see @, ok')])
    expect(injectedMessages(decision)).toEqual([])
  })

  it('passes through a rejected downstream decision untouched', async () => {
    const root = await tempDir('reject')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const signal = new AbortController().signal
    const decision = await agentEvents(ctx, agentForCwd(root)).waterfall(
      'agent/pre-step',
      { messages: [userMessage('@a.ts')], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: 'reject' as const }),
    )
    expect(decision).toEqual({ kind: 'reject' })
  })

  it('is a no-op when the session carries no project cwd', async () => {
    const root = await tempDir('no-cwd')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const id = SessionId('at-file-no-cwd')
    const session = Session.create(id, [], { version: 0, id, createdAt: 0 })
    const decision = await proposeStep(ctx, { ...agentForCwd(root), session }, [userMessage('@a.ts')])
    expect(injectedMessages(decision)).toEqual([])
  })

  it('leaves an unreadable (non-text) file as plain prose', async () => {
    const root = await tempDir('binary')
    await writeFile(join(root, 'blob.bin'), Buffer.from([0xff, 0xfe, 0x01, 0x02]))
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [userMessage('@blob.bin')])
    expect(injectedMessages(decision)).toEqual([])
  })

  it('scans only text blocks of a user message', async () => {
    const root = await tempDir('blocks')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const decision = await proposeStep(ctx, agentForCwd(root), [createUserMessage({
      content: [
        { type: 'text', text: 'see @a.ts' },
        { type: 'image', image: 'data:image/png;base64,AA==' as never, attachment: null as never },
      ],
      source: { kind: 'user' },
    })])
    expect(injectedMessages(decision)).toHaveLength(1)
  })

  it('propagates an aborted signal', async () => {
    const root = await tempDir('abort')
    await write(root, 'a.ts', 'a')
    const ctx = await setup(root)
    const controller = new AbortController()
    controller.abort()
    await expect(proposeStep(ctx, agentForCwd(root), [userMessage('@a.ts')], controller.signal))
      .rejects.toThrow()
  })

  it('is a no-op without a filesystem backend', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(atFile)
    const decision = await proposeStep(ctx, agentForCwd('/nonexistent'), [userMessage('@a.ts')])
    expect(injectedMessages(decision)).toEqual([])
  })
})
