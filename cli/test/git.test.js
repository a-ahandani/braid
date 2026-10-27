import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import * as git from '../lib/git.js'

let dir
const sh = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: '2026-01-01T00:00:00', GIT_COMMITTER_DATE: '2026-01-01T00:00:00' } })

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramify-cli-'))
  sh('init', '-q', '-b', 'main')
  sh('config', 'user.name', 'Test')
  sh('config', 'user.email', 't@example.com')
})

after(() => rmSync(dir, { recursive: true, force: true }))

describe('git helper', () => {
  it('stages, commits, tags and loads the graph', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    let st = await git.status(dir)
    assert.deepEqual(st.unstaged, [{ path: 'a.txt', kind: '?' }])
    await git.stage(dir, ['a.txt'])
    st = await git.status(dir)
    assert.deepEqual(st.staged, [{ path: 'a.txt', kind: 'A' }])
    await git.commit(dir, 'first', false)
    writeFileSync(join(dir, 'a.txt'), 'hello\nworld\n')
    await git.stage(dir, ['a.txt'])
    await git.commit(dir, 'second\n\nmore detail', false)
    const head = sh('rev-parse', 'HEAD').trim()
    await git.createTag(dir, 'v1', head, 'release one')
    writeFileSync(join(dir, 'b.txt'), 'scratch\n')
    await git.stashSave(dir, 'wip note')
    const data = await git.load(dir)
    assert.equal(data.headBranch, 'main')
    assert.equal(data.headOid, head)
    assert.deepEqual(data.commits.map((c) => c.summary), ['On main: wip note', 'second', 'first'])
    assert.equal(data.commits[0].kind, 'stash')
    assert.equal(data.commits[0].parents.length, 1)
    assert.equal(data.commits[1].body, 'more detail')
    assert.deepEqual(data.tags, [{ name: 'v1', oid: head }])
    assert.ok(data.refsByOid[head].some((r) => r.kind === 'tag' && r.name === 'v1'))
    assert.ok(data.refsByOid[head].some((r) => r.kind === 'head' && r.current))
    assert.equal(data.stashes.length, 1)
    assert.deepEqual(await git.commitFiles(dir, head), [{ path: 'a.txt', kind: 'M' }])
    const lines = await git.diff(dir, { kind: 'commit', oid: head }, 'a.txt')
    assert.ok(lines.some((l) => l.type === 'add' && l.text === 'world'))
  })

  it('refuses option-like names and discards only the named file', async () => {
    await assert.rejects(git.createBranch(dir, '--exec=true', 'HEAD', false), /Invalid name/)
    writeFileSync(join(dir, 'a.txt'), 'changed\n')
    writeFileSync(join(dir, 'c.txt'), 'new\n')
    await git.discard(dir, [{ path: 'a.txt', kind: 'M' }])
    const st = await git.status(dir)
    assert.deepEqual(st.unstaged, [{ path: 'c.txt', kind: '?' }])
    await git.discard(dir, [{ path: 'c.txt', kind: '?' }])
    assert.deepEqual((await git.status(dir)).unstaged, [])
  })

  it('parses porcelain status including renames and conflicts', () => {
    const z = 'M  a.txt\0 M b.txt\0R  new.txt\0old.txt\0?? c.txt\0UU d.txt\0'
    assert.deepEqual(git.parseStatus(z), {
      staged: [
        { path: 'a.txt', kind: 'M' },
        { path: 'new.txt', kind: 'M' },
      ],
      unstaged: [
        { path: 'b.txt', kind: 'M' },
        { path: 'c.txt', kind: '?' },
        { path: 'd.txt', kind: 'M', conflict: true },
      ],
    })
  })
})
