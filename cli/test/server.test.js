import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createServer } from '../lib/server.js'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'ramulus-srv-')))
const repo = (name) => {
  const d = join(root, name)
  execFileSync('git', ['init', '-q', '-b', 'main', d])
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: d, encoding: 'utf8' }).trim()
}
const first = repo('first')
const second = repo('second')
const token = 'a'.repeat(32)
let server
let base

const call = async (op, body = {}, tok = token) => {
  const res = await fetch(`${base}/api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ramulus-token': tok }, body: JSON.stringify(body) })
  return res.json()
}

before(async () => {
  server = createServer({ dir: first, uiDir: root, token, stateFile: join(root, 'state', 'recent.json') })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('helper server', () => {
  it('only touches repositories the user opened', async () => {
    assert.equal((await call('status', {}, 'b'.repeat(32))).error, 'bad token')
    assert.deepEqual((await call('status')).result.unstaged, [])
    assert.match((await call('status', { repo: second })).error, /Open that repository first/)
    assert.match((await call('openRepo', { path: join(root, 'missing') })).error, /does not exist/)
    assert.equal((await call('openRepo', { path: join(second, '.') })).result.name, 'second')
    assert.deepEqual((await call('status', { repo: second })).result.unstaged, [])
    const repos = (await call('repos')).result
    assert.equal(repos.current.dir, first)
    assert.deepEqual(repos.recent.map((r) => r.name), ['second', 'first'])
    assert.equal((await call('constructor')).error, 'unknown operation')
    const events = (repo) => fetch(`${base}/api/events?token=${token}&repo=${encodeURIComponent(repo)}`, { signal: AbortSignal.timeout(2000) })
    assert.equal((await events(join(root, 'other'))).status, 401)
    const open = await events(second)
    assert.equal(open.status, 200)
    await open.body.cancel()
  })
})
