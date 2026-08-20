/**
 * Client half: the '@' source registration, the Remote mount, candidate
 * filtering, the session-keyed index cache, lexicon reads, and the pick
 * outcome — driven against a structural cordis context with mocked
 * inputTriggers/remote/sessions services.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, inject } from '../src/client/index.ts'
import { filterFiles } from '../src/client/filter.ts'
import type { InputTriggerSource } from '../src/client/trigger-contract.ts'
import TYPERT_REMOTE from '../typert/typert.remote-client.js'

const INDEX = [
  { path: 'src/main.ts' },
  { path: 'src/commit-helper.ts', size: 3 },
  { path: 'README.md' },
  { path: 'docs/code-review.md' },
]

type ListFn = (sessionId: string, signal?: AbortSignal) => Promise<unknown>

async function bench(list: ListFn, addressed?: string) {
  const ctx = new Context()
  let captured: InputTriggerSource | undefined
  const mount = vi.fn(() => Promise.resolve({ dispose: () => Promise.resolve() }))
  ctx.provide('inputTriggers', { registerSource: (src: InputTriggerSource) => { captured = src; return () => {} } })
  ctx.provide('remote', { $mount: mount, atFile: { list } })
  ctx.provide('sessions', {
    subagentAddress: (id: string) => id === addressed ? { parentSessionId: 'parent', childSessionId: id, mode: 'continuable' } : undefined,
  })
  await ctx.plugin({ inject: [...inject], apply }).await()
  return { ctx, source: captured!, mount }
}

const ok = (files: typeof INDEX = INDEX): ListFn =>
  (_sessionId: string, _signal?: AbortSignal) => Promise.resolve({ ok: true as const, value: { files } })

function countingList(files: typeof INDEX = INDEX) {
  const calls: string[] = []
  const list: ListFn = (sessionId: string) => {
    calls.push(sessionId)
    return Promise.resolve({ ok: true as const, value: { files } })
  }
  return { list, calls }
}

const proj = (id: string) => ({ sessionId: id })
const req = (query: string, signal?: AbortSignal) =>
  ({ query, position: 'leading' as const, signal: signal ?? new AbortController().signal })

describe('apply', () => {
  it('declares the services it binds', () => {
    expect(inject).toEqual(['inputTriggers', 'remote', 'sessions'])
  })

  it('mounts the atFile Remote and registers the "@" source', async () => {
    const { source, mount } = await bench(ok())
    expect(mount).toHaveBeenCalledWith(TYPERT_REMOTE)
    expect(source).toMatchObject({ trigger: '@', name: 'file', order: -10 })
  })
})

describe('filterFiles', () => {
  it('ranks basename-prefix, then path-prefix, then path-substring matches', () => {
    const files = [
      { path: 'a/main.ts' },
      { path: 'main.ts' },
      { path: 'src/foo-bar.ts' },
      { path: 'src/README.md' },
    ]
    expect(filterFiles(files, 'main')).toEqual([
      { name: 'main.ts' },
      { name: 'a/main.ts', description: 'a' },
    ])
    expect(filterFiles(files, 'src/foo')).toEqual([
      { name: 'src/foo-bar.ts', description: 'src' },
    ])
    expect(filterFiles(files, 'o-b')).toEqual([
      { name: 'src/foo-bar.ts', description: 'src' },
    ])
    expect(filterFiles(files, 'readme')).toEqual([
      { name: 'src/README.md', description: 'src' },
    ])
  })

  it('caps the result at the menu limit', () => {
    const files: { path: string }[] = []
    for (let i = 0; i < 60; i += 1) files.push({ path: `dir/file-${i}.ts` })
    expect(filterFiles(files, '', 10)).toHaveLength(10)
  })
})

describe('candidates', () => {
  it('lists via sessionId and filters by query', async () => {
    const { list, calls } = countingList()
    const { source } = await bench(list)
    const items = await source.candidates!(proj('s1'), req('commit'))
    expect(calls).toEqual(['s1'])
    expect(items).toEqual([{ name: 'src/commit-helper.ts', description: 'src' }])
  })

  it('rejects on a failed Remote result', async () => {
    const { source } = await bench(() => Promise.resolve({ ok: false as const, error: { code: 'internal', message: 'boom', details: {} } }))
    await expect(source.candidates!(proj('s1'), req('co'))).rejects.toThrow('boom')
  })

  it('does not fetch the index for an addressed child', async () => {
    const { list, calls } = countingList()
    const { source } = await bench(list, 'child')
    await expect(source.candidates!(proj('child'), req(''))).resolves.toEqual([])
    source.warm!(proj('child'))
    expect(calls).toEqual([])
  })

  it('caches per session: one Remote call across keystrokes', async () => {
    const { list, calls } = countingList()
    const { source } = await bench(list)
    await source.candidates!(proj('s1'), req(''))
    await source.candidates!(proj('s1'), req('main'))
    await source.candidates!(proj('s2'), req(''))
    expect(calls).toEqual(['s1', 's2'])
  })

  it('an aborted caller yields empty but leaves the shared fetch warm', async () => {
    const { list, calls } = countingList()
    const { source } = await bench(list)
    const aborted = new AbortController()
    aborted.abort()
    await expect(source.candidates!(proj('s1'), req('commit', aborted.signal))).resolves.toEqual([])
    await expect(source.candidates!(proj('s1'), req('commit'))).resolves.toEqual([
      { name: 'src/commit-helper.ts', description: 'src' },
    ])
    expect(calls).toHaveLength(1)
  })
})

describe('lexicon', () => {
  it('serves settled paths and notifies listeners per session', async () => {
    const { source, ctx } = await bench(ok())
    const listener = vi.fn()
    source.subscribeLexicon!(proj('s1'), listener)
    expect(source.lexicon!(proj('s1'))).toBeUndefined()
    await source.candidates!(proj('s1'), req(''))
    expect(source.lexicon!(proj('s1'))).toEqual(['src/main.ts', 'src/commit-helper.ts', 'README.md', 'docs/code-review.md'])
    expect(listener).toHaveBeenCalledTimes(1)
    // connection/reset clears the cache and notifies again.
    ;(ctx as unknown as { emit(name: string): void }).emit('connection/reset')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('an unsubscribed listener stops receiving notifications', async () => {
    const { source } = await bench(ok())
    const listener = vi.fn()
    const off = source.subscribeLexicon!(proj('s1'), listener)
    off()
    await source.candidates!(proj('s1'), req(''))
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('pick lands plain text', () => {
  it('onPick returns the literal @path text with a closing space', async () => {
    const { source } = await bench(ok())
    const outcome = source.onPick!({
      candidate: { name: 'src/main.ts', description: 'src' },
      session: proj('s1'),
      position: 'leading',
      via: 'menu',
      span: { start: 0, end: 4, draftRev: 7 },
    })
    expect(outcome).toEqual({ text: '@src/main.ts ' })
  })
})
