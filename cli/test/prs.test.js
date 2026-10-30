import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { changePullRequest, mergePullRequest, pullRequest, pullRequests } from '../lib/prs.js'

const root = mkdtempSync(join(tmpdir(), 'ramulus-prs-'))
const bin = join(root, 'bin')
const LIST = '[{"number":7,"title":"Add login","url":"https://github.com/o/r/pull/7","headRefName":"login","state":"OPEN","isDraft":true},{"number":3,"title":"Old","url":"https://github.com/o/r/pull/3","headRefName":"old","state":"MERGED","isDraft":false}]'

after(() => rmSync(root, { recursive: true, force: true }))

describe('pull requests', { skip: process.platform === 'win32' }, () => {
  mkdirSync(bin)
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/sh\nif [ -n "$GITHUB_TOKEN" ]; then echo 'HTTP 401: Bad credentials' >&2; exit 1; fi\nif [ "$2" = view ]; then /bin/cat "${join(root, 'view.json')}"; exit 0; fi\nif [ "$2" = ready ] || [ "$2" = close ] || [ "$2" = reopen ]; then echo "$@" >> "${join(root, 'changes.log')}"; exit 0; fi\nif [ "$2" = merge ]; then echo "$@" >> "${join(root, 'merges.log')}"; if [ "$3" = 9 ]; then echo 'Pull request is not mergeable: the merge commit cannot be cleanly created.' >&2; exit 1; fi; exit 0; fi\necho '${LIST}'\n`,
  )
  chmodSync(join(bin, 'gh'), 0o755)
  const repo = (name) => {
    const d = join(root, name)
    mkdirSync(d)
    return d
  }

  it('reads them through gh, retrying without a token that gh rejects', async () => {
    const list = await pullRequests(repo('a'), { PATH: bin, GITHUB_TOKEN: 'stale' })
    assert.deepEqual(list, [
      { number: 7, title: 'Add login', url: 'https://github.com/o/r/pull/7', branch: 'login', state: 'DRAFT' },
      { number: 3, title: 'Old', url: 'https://github.com/o/r/pull/3', branch: 'old', state: 'MERGED' },
    ])
  })

  it('merges through gh with the chosen method and passes GitHub refusals on', async () => {
    const dir = repo('c')
    const env = { PATH: bin, GITHUB_TOKEN: 'stale' }
    await mergePullRequest(dir, 7, 'squash', env)
    assert.equal(readFileSync(join(root, 'merges.log'), 'utf8'), 'pr merge 7 --squash\n')
    await assert.rejects(mergePullRequest(dir, 9, 'merge', env), /not mergeable/)
    await assert.rejects(mergePullRequest(dir, 7, 'fast', env), /Invalid merge method/)
    await assert.rejects(mergePullRequest(dir, '7; rm -rf', 'merge', env), /Invalid pull request number/)
  })

  it('reads one pull request with its checks, reviews and comments', async () => {
    writeFileSync(
      join(root, 'view.json'),
      JSON.stringify({
        number: 7, title: 'Add login', body: 'Adds **login**', state: 'OPEN', isDraft: false, author: { login: 'maya' }, headRefName: 'login', baseRefName: 'main',
        url: 'https://github.com/o/r/pull/7', createdAt: '2026-10-01T00:00:00Z', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', additions: 12, deletions: 3,
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'test', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://ci/1' },
          { __typename: 'CheckRun', name: 'lint', workflowName: 'CI', status: 'IN_PROGRESS', conclusion: '', detailsUrl: 'https://ci/2' },
          { __typename: 'CheckRun', name: 'e2e', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://ci/3' },
          { __typename: 'StatusContext', context: 'deploy', state: 'PENDING', targetUrl: 'https://deploy' },
        ],
        reviews: [{ author: { login: 'leo' }, state: 'APPROVED', body: 'Looks good', submittedAt: '2026-10-02T00:00:00Z' }],
        comments: [{ author: { login: 'sam' }, body: 'Nice', createdAt: '2026-10-03T00:00:00Z' }],
        files: [{ path: 'src/login.ts', additions: 12, deletions: 3 }],
        commits: [{ oid: 'abc123', messageHeadline: 'Add login form', committedDate: '2026-10-01T00:00:00Z' }],
      }),
    )
    const pr = await pullRequest(repo('d'), 7, { PATH: bin })
    assert.equal(pr.author, 'maya')
    assert.deepEqual(pr.checks.map((c) => `${c.name}:${c.state}`), ['test:pass', 'lint:running', 'e2e:fail', 'deploy:running'])
    assert.equal(pr.checks[3].url, 'https://deploy')
    assert.deepEqual(pr.reviews[0], { author: 'leo', state: 'APPROVED', body: 'Looks good', at: '2026-10-02T00:00:00Z' })
    assert.deepEqual(pr.comments[0], { author: 'sam', body: 'Nice', at: '2026-10-03T00:00:00Z' })
    await assert.rejects(pullRequest(repo('e'), 0, { PATH: bin }), /Invalid pull request number/)
  })

  it('keeps a pull request view for a moment and forgets it after a change', async () => {
    const dir = repo('g')
    const first = await pullRequest(dir, 7, { PATH: bin })
    writeFileSync(join(root, 'view.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(root, 'view.json'), 'utf8')), title: 'Renamed' }))
    assert.equal((await pullRequest(dir, 7, { PATH: bin })).title, first.title)
    await changePullRequest(dir, 7, 'draft', { PATH: bin })
    assert.equal((await pullRequest(dir, 7, { PATH: bin })).title, 'Renamed')
  })

  it('marks as draft or ready, closes and reopens through gh', async () => {
    const dir = repo('f')
    for (const action of ['draft', 'ready', 'close', 'reopen']) await changePullRequest(dir, 7, action, { PATH: bin })
    assert.match(readFileSync(join(root, 'changes.log'), 'utf8'), /pr ready 7 --undo\npr ready 7\npr close 7\npr reopen 7\n$/)
    await assert.rejects(changePullRequest(dir, 7, 'constructor', { PATH: bin }), /Invalid pull request action/)
  })

  it('returns nothing when gh is missing', async () => {
    assert.deepEqual(await pullRequests(repo('b'), { PATH: join(root, 'none') }), [])
  })
})
