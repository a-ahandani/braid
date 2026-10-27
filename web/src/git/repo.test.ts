import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import git from 'isomorphic-git'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { commit, commitFiles, diffLines, discard, load, stage, status, unstage, type Ctx } from './repo'

let dir: string
let ctx: Ctx

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ramify-web-'))
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
    const lines = await diffLines(ctx, { kind: 'commit', oid: data.commits[0].id }, 'a.txt')
    expect(lines.some((l) => l.type === 'add' && l.text === 'world')).toBe(true)
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
