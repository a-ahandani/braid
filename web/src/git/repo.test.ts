import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commit, commitFiles, createTag, discard, fileVersions, load, stage, status, unstage, writeIndex, writeWorkdir, type Ctx } from './repo'

let dir: string
let ctx: Ctx

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramulus-web-'))
  ctx = { fs, dir, cache: {} }
  await git.init({ fs, dir, defaultBranch: 'main' })
  await git.setConfig({ fs, dir, path: 'user.name', value: 'Test' })
  await git.setConfig({ fs, dir, path: 'user.email', value: 't@example.com' })
})

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('repo', () => {
  it('stages, commits, loads the graph and diffs a commit', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
    let st = await status(ctx)
    expect(st.unstaged).toEqual([{ path: 'a.txt', kind: '?' }])
    await stage(ctx, st.unstaged)
    st = await status(ctx)
    expect(st.staged).toEqual([{ path: 'a.txt', kind: 'A' }])
    await commit(ctx, 'first', false)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\n')
    st = await status(ctx)
    expect(st.unstaged).toEqual([{ path: 'a.txt', kind: 'M' }])
    await stage(ctx, st.unstaged)
    await commit(ctx, 'second\n\nmore detail', false)
    const data = await load(ctx)
    expect(data.headBranch).toBe('main')
    expect(data.commits.map((c) => c.summary)).toEqual(['second', 'first'])
    expect(data.commits[0].body).toBe('more detail')
    expect(data.refsByOid.get(data.commits[0].id)?.[0]).toEqual({ name: 'main', kind: 'head', current: true })
    expect(await commitFiles(ctx, data.commits[0].id)).toEqual([{ path: 'a.txt', kind: 'M' }])
    const v = await fileVersions(ctx, { kind: 'commit', oid: data.commits[0].id }, 'a.txt')
    expect(v).toEqual({ old: 'hello\n', new: 'hello\nworld\n', binary: false })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\nworld\nagain\n')
    await writeIndex(ctx, 'a.txt', 'hello\nworld\npartial\n')
    expect(await fileVersions(ctx, { kind: 'staged' }, 'a.txt')).toMatchObject({ old: 'hello\nworld\n', new: 'hello\nworld\npartial\n' })
    expect(await fileVersions(ctx, { kind: 'unstaged' }, 'a.txt')).toMatchObject({ old: 'hello\nworld\npartial\n', new: 'hello\nworld\nagain\n' })
    expect((await status(ctx)).staged).toEqual([{ path: 'a.txt', kind: 'M' }])
  })

  it('keeps a byte order mark and refuses stale writes', async () => {
    fs.writeFileSync(path.join(dir, 'b.txt'), '\uFEFFone\r\ntwo\r\n')
    await stage(ctx, (await status(ctx)).unstaged)
    await commit(ctx, 'bom', false)
    fs.writeFileSync(path.join(dir, 'b.txt'), '\uFEFFONE\r\ntwo\r\n')
    const v = await fileVersions(ctx, { kind: 'unstaged' }, 'b.txt')
    expect(v.old).toBe('\uFEFFone\r\ntwo\r\n')
    await expect(writeIndex(ctx, 'b.txt', v.new, 'stale')).rejects.toThrow(/changed since/)
    await writeIndex(ctx, 'b.txt', v.new, v.old)
    expect((await fileVersions(ctx, { kind: 'staged' }, 'b.txt')).new).toBe('\uFEFFONE\r\ntwo\r\n')
    await expect(writeWorkdir(ctx, 'b.txt', 'x', 'stale')).rejects.toThrow(/changed since/)
  })

  it('puts an annotated tag on its commit without adding a row', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
    await stage(ctx, (await status(ctx)).unstaged)
    const oid = await commit(ctx, 'first', false)
    await createTag(ctx, 'v1', oid, 'release one')
    const data = await load(ctx)
    expect(data.commits.map((c) => c.id)).toEqual([oid])
    expect(data.tags).toEqual([{ name: 'v1', oid }])
    expect(data.refsByOid.get(oid)?.some((r) => r.kind === 'tag' && r.name === 'v1')).toBe(true)
  })

  it('unstages and discards only the named file', async () => {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n')
    await stage(ctx, (await status(ctx)).unstaged)
    await commit(ctx, 'base', false)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a2\n')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b2\n')
    await stage(ctx, [{ path: 'a.txt', kind: 'M' }])
    expect((await status(ctx)).staged).toEqual([{ path: 'a.txt', kind: 'M' }])
    await unstage(ctx, ['a.txt'])
    expect((await status(ctx)).staged).toEqual([])
    await discard(ctx, [{ path: 'a.txt', kind: 'M' }])
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('a\n')
    expect(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8')).toBe('b2\n')
  })
})

describe('mapStatus', () => {
  it('maps every status matrix state', async () => {
    const { mapStatus } = await import('./repo')
    const m = (h: number, w: number, s: number) => mapStatus([['f', h, w, s]])
    expect(m(0, 2, 0)).toEqual({ staged: [], unstaged: [{ path: 'f', kind: '?' }] })
    expect(m(0, 2, 2)).toEqual({ staged: [{ path: 'f', kind: 'A' }], unstaged: [] })
    expect(m(0, 2, 3)).toEqual({ staged: [{ path: 'f', kind: 'A' }], unstaged: [{ path: 'f', kind: 'M' }] })
    expect(m(1, 1, 1)).toEqual({ staged: [], unstaged: [] })
    expect(m(1, 2, 1)).toEqual({ staged: [], unstaged: [{ path: 'f', kind: 'M' }] })
    expect(m(1, 2, 2)).toEqual({ staged: [{ path: 'f', kind: 'M' }], unstaged: [] })
    expect(m(1, 2, 3)).toEqual({ staged: [{ path: 'f', kind: 'M' }], unstaged: [{ path: 'f', kind: 'M' }] })
    expect(m(1, 0, 1)).toEqual({ staged: [], unstaged: [{ path: 'f', kind: 'D' }] })
    expect(m(1, 0, 0)).toEqual({ staged: [{ path: 'f', kind: 'D' }], unstaged: [] })
    expect(m(1, 1, 0)).toEqual({ staged: [{ path: 'f', kind: 'D' }], unstaged: [{ path: 'f', kind: '?' }] })
    expect(m(1, 1, 3)).toEqual({ staged: [{ path: 'f', kind: 'M' }], unstaged: [{ path: 'f', kind: 'M' }] })
  })
})

describe('branches, stashes and merges', () => {
  it('switching to a new branch at an older commit updates the working tree', async () => {
    const { createBranch } = await import('./repo')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    await stage(ctx, (await status(ctx)).unstaged)
    const first = await commit(ctx, 'first', false)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two, longer\n')
    await stage(ctx, (await status(ctx)).unstaged)
    await commit(ctx, 'second', false)
    await createBranch(ctx, 'old', first, true)
    expect((await load(ctx)).headBranch).toBe('old')
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('one\n')
    expect(await status(ctx)).toEqual({ staged: [], unstaged: [] })
  })

  it('lists a stash as one row and hides its index commit', async () => {
    const { stashSave } = await import('./repo')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    await stage(ctx, (await status(ctx)).unstaged)
    await commit(ctx, 'first', false)
    fs.writeFileSync(path.join(dir, 'a.txt'), 'edited\n')
    await stashSave(ctx, 'wip note')
    const data = await load(ctx)
    expect(data.stashes.length).toBe(1)
    expect(data.stashes[0].index).toBe(0)
    expect(data.commits.filter((c) => c.kind === 'stash').length).toBe(1)
    expect(data.commits.length).toBe(2)
    expect(await status(ctx)).toEqual({ staged: [], unstaged: [] })
  })

  it('refuses to merge with local edits', async () => {
    const { createBranch, merge } = await import('./repo')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    await stage(ctx, (await status(ctx)).unstaged)
    const first = await commit(ctx, 'first', false)
    await createBranch(ctx, 'side', first, true)
    fs.writeFileSync(path.join(dir, 'b.txt'), 'side\n')
    await stage(ctx, (await status(ctx)).unstaged)
    await commit(ctx, 'side work', false)
    await git.checkout({ fs, dir, ref: 'main' })
    fs.writeFileSync(path.join(dir, 'a.txt'), 'dirty\n')
    await expect(merge(ctx, 'side', 'main')).rejects.toThrow('Commit or stash')
    fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n')
    expect(await merge(ctx, 'side', 'main')).toBe('fast-forward')
    expect(fs.existsSync(path.join(dir, 'b.txt'))).toBe(true)
  })
})
