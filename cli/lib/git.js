import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NUL = '\0'
const RS = '\x1e'

export function run(dir, args, { input, allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd: dir, maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (err && !allowFail) {
          const msg = (stderr || stdout || err.message).toString().trim()
          reject(new Error(msg || `git ${args[0]} failed`))
        } else {
          resolve({ ok: !err, stdout: stdout.toString(), stderr: stderr.toString() })
        }
      },
    )
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

function safeName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.startsWith('-')) throw new Error(`Invalid name: ${JSON.stringify(name)}`)
  return name
}

function safePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('No files given')
  return paths.map((p) => {
    if (typeof p !== 'string' || p.length === 0) throw new Error('Invalid path')
    return p
  })
}

export async function toplevel(dir) {
  return (await run(dir, ['rev-parse', '--show-toplevel'])).stdout.trim()
}

async function stateOf(dir) {
  const gitDir = (await run(dir, ['rev-parse', '--git-dir'])).stdout.trim()
  const at = (p) => existsSync(join(dir, gitDir, p))
  if (at('MERGE_HEAD')) return 'merge'
  if (at('rebase-merge') || at('rebase-apply')) return 'rebase'
  if (at('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (at('REVERT_HEAD')) return 'revert'
  return null
}

export function parseStatus(porcelainZ) {
  const out = { staged: [], unstaged: [] }
  const items = porcelainZ.split(NUL)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.length < 4) continue
    const x = item[0]
    const y = item[1]
    let path = item.slice(3)
    if (x === 'R' || x === 'C') {
      i++
    }
    if (x === '?') {
      out.unstaged.push({ path, kind: '?' })
      continue
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      out.unstaged.push({ path, kind: 'M', conflict: true })
      continue
    }
    if (x !== ' ') out.staged.push({ path, kind: x === 'A' ? 'A' : x === 'D' ? 'D' : 'M' })
    if (y !== ' ') out.unstaged.push({ path, kind: y === 'D' ? 'D' : 'M' })
  }
  return out
}

export async function status(dir) {
  const { stdout } = await run(dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  return { ...parseStatus(stdout), state: await stateOf(dir) }
}

export function parseLog(text, stashInfo) {
  const commits = []
  for (const rec of text.split(RS)) {
    const t = rec.replace(/^\n/, '')
    if (!t.trim()) continue
    const [id, parents, author, email, time, summary, body = ''] = t.split(NUL)
    if (!id) continue
    if (stashInfo.internals.has(id)) continue
    const stash = stashInfo.messages.get(id)
    const ps = parents ? parents.split(' ') : []
    commits.push({
      id,
      parents: stash !== undefined ? ps.slice(0, 1) : ps,
      author,
      email,
      time: Number(time),
      summary: stash ?? summary,
      body: body.trim(),
      kind: stash !== undefined ? 'stash' : ps.length > 1 ? 'merge' : 'commit',
    })
  }
  return commits
}

export async function load(dir, limit = 2000) {
  const headBranch = (await run(dir, ['symbolic-ref', '-q', '--short', 'HEAD'], { allowFail: true })).stdout.trim() || undefined
  const headOid = (await run(dir, ['rev-parse', '-q', '--verify', 'HEAD'], { allowFail: true })).stdout.trim() || undefined
  const refsByOid = {}
  const addRef = (oid, label) => (refsByOid[oid] ??= []).push(label)
  const local = []
  const remote = []
  const tags = []
  const refs = await run(dir, ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(*objectname)%00%(symref)', 'refs/heads', 'refs/remotes', 'refs/tags'])
  for (const line of refs.stdout.split('\n')) {
    if (!line) continue
    const [refname, objectname, peeled, symref] = line.split(NUL)
    if (symref) continue
    const oid = peeled || objectname
    if (refname.startsWith('refs/heads/')) {
      const name = refname.slice(11)
      local.push({ name, oid, isHead: name === headBranch })
      addRef(oid, { name, kind: 'head', current: name === headBranch })
    } else if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice(13)
      remote.push({ name, oid, isHead: false })
      addRef(oid, { name, kind: 'remote' })
    } else if (refname.startsWith('refs/tags/')) {
      const name = refname.slice(10)
      tags.push({ name, oid })
      addRef(oid, { name, kind: 'tag' })
    }
  }
  const stashes = []
  const stashList = await run(dir, ['stash', 'list', '--format=%H%x00%s'], { allowFail: true })
  for (const line of stashList.stdout.split('\n')) {
    if (!line) continue
    const [oid, message] = line.split(NUL)
    stashes.push({ index: stashes.length, message, oid })
  }
  const internals = new Set()
  if (stashes.length > 0) {
    const parents = await run(dir, ['rev-list', '--no-walk', '--parents', ...stashes.map((s) => s.oid)])
    for (const line of parents.stdout.split('\n')) {
      const [, ...ps] = line.trim().split(' ')
      ps.slice(1).forEach((p) => internals.add(p))
    }
  }
  const log = await run(dir, [
    'log',
    '--date-order',
    `--max-count=${limit + 1 + internals.size}`,
    '--format=%H%x00%P%x00%an%x00%ae%x00%ct%x00%s%x00%b%x1e',
    '--all',
  ], { allowFail: true })
  const commits = parseLog(log.stdout, { internals, messages: new Map(stashes.map((s) => [s.oid, s.message])) })
  const hasMore = commits.length > limit
  return {
    name: dir.split(/[\\/]/).filter(Boolean).pop(),
    headBranch,
    headOid,
    commits: commits.slice(0, limit),
    refsByOid,
    local,
    remote,
    tags,
    stashes,
    status: await status(dir),
    hasMore,
    native: true,
  }
}

async function parentOf(dir, oid) {
  return (await run(dir, ['rev-parse', '-q', '--verify', `${oid}^`], { allowFail: true })).stdout.trim() || undefined
}

export async function commitFiles(dir, oid) {
  const parent = await parentOf(dir, oid)
  const args = parent ? ['diff-tree', '-r', '-z', '-M', '--name-status', parent, oid] : ['diff-tree', '--root', '-r', '-z', '-M', '--name-status', oid]
  const { stdout } = await run(dir, args)
  const parts = stdout.split(NUL)
  const out = []
  for (let i = 0; i < parts.length - 1; i += 2) {
    const code = parts[i][0]
    let path = parts[i + 1]
    if (code === 'R' || code === 'C') {
      path = parts[i + 2]
      i++
    }
    if (!path) continue
    out.push({ path, kind: code === 'A' ? 'A' : code === 'D' ? 'D' : 'M' })
  }
  return out
}

export function parseDiff(text) {
  const lines = []
  let inHunk = false
  for (const raw of text.split('\n')) {
    if (raw.startsWith('@@')) {
      inHunk = true
      lines.push({ type: 'hunk', text: raw })
    } else if (raw.startsWith('Binary files')) {
      lines.push({ type: 'note', text: 'Binary file' })
    } else if (!inHunk) {
      continue
    } else if (raw.startsWith('+')) lines.push({ type: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) lines.push({ type: 'del', text: raw.slice(1) })
    else if (raw.startsWith(' ')) lines.push({ type: 'ctx', text: raw.slice(1) })
    else if (raw.startsWith('\\')) lines.push({ type: 'note', text: raw })
  }
  return lines
}

export async function diff(dir, area, path) {
  safePaths([path])
  let args
  if (area.kind === 'commit') {
    const parent = await parentOf(dir, area.oid)
    args = parent ? ['diff', '--no-color', '-M', parent, area.oid, '--', path] : ['show', '--format=', '--no-color', area.oid, '--', path]
  } else if (area.kind === 'staged') {
    args = ['diff', '--no-color', '--cached', '--', path]
  } else {
    const tracked = (await run(dir, ['ls-files', '--error-unmatch', '--', path], { allowFail: true })).ok
    args = tracked ? ['diff', '--no-color', '--', path] : ['diff', '--no-color', '--no-index', '--', '/dev/null', path]
  }
  const { stdout } = await run(dir, args, { allowFail: true })
  return parseDiff(stdout)
}

export async function stage(dir, paths) {
  await run(dir, ['add', '-A', '--', ...safePaths(paths)])
}

export async function unstage(dir, paths) {
  await run(dir, ['reset', '-q', '--', ...safePaths(paths)])
}

export async function discard(dir, files) {
  const tracked = files.filter((f) => f.kind !== '?').map((f) => f.path)
  const untracked = files.filter((f) => f.kind === '?').map((f) => f.path)
  if (tracked.length) await run(dir, ['checkout', '-q', '--', ...safePaths(tracked)])
  if (untracked.length) await run(dir, ['clean', '-f', '-q', '--', ...safePaths(untracked)])
}

export async function commit(dir, message, amend) {
  if (!message || !message.trim()) throw new Error('A commit message is required')
  await run(dir, ['commit', '-q', '-F', '-', ...(amend ? ['--amend'] : [])], { input: message })
}

export async function checkoutBranch(dir, name) {
  await run(dir, ['switch', '-q', safeName(name)])
}

export async function checkoutRemote(dir, name) {
  safeName(name)
  const i = name.indexOf('/')
  const local = name.slice(i + 1)
  const exists = (await run(dir, ['rev-parse', '-q', '--verify', `refs/heads/${local}`], { allowFail: true })).ok
  await run(dir, exists ? ['switch', '-q', local] : ['switch', '-q', '-c', local, '--track', name])
}

export async function checkoutCommit(dir, oid) {
  await run(dir, ['switch', '-q', '--detach', safeName(oid)])
}

export async function createBranch(dir, name, at, checkout) {
  await run(dir, ['branch', '--', safeName(name), safeName(at)])
  if (checkout) await run(dir, ['switch', '-q', name])
}

export async function deleteBranch(dir, name) {
  await run(dir, ['branch', '-D', '--', safeName(name)])
}

export async function renameBranch(dir, oldName, newName) {
  await run(dir, ['branch', '-m', '--', safeName(oldName), safeName(newName)])
}

export async function createTag(dir, name, at, message) {
  if (message && message.trim()) await run(dir, ['tag', '-a', '-F', '-', '--', safeName(name), safeName(at)], { input: message })
  else await run(dir, ['tag', '--', safeName(name), safeName(at)])
}

export async function deleteTag(dir, name) {
  await run(dir, ['tag', '-d', '--', safeName(name)])
}

export async function stashSave(dir, message) {
  await run(dir, ['stash', 'push', '-u', '-q', ...(message && message.trim() ? ['-m', message] : [])])
}

export async function stashApply(dir, index, pop) {
  await run(dir, ['stash', pop ? 'pop' : 'apply', '-q', `stash@{${Number(index)}}`])
}

export async function stashDrop(dir, index) {
  await run(dir, ['stash', 'drop', '-q', `stash@{${Number(index)}}`])
}

export async function merge(dir, branch) {
  const r = await run(dir, ['merge', '--no-edit', safeName(branch)], { allowFail: true })
  if (!r.ok) {
    if ((await stateOf(dir)) === 'merge') return 'conflicts'
    throw new Error((r.stderr || r.stdout).trim())
  }
  return /Already up to date/i.test(r.stdout) ? 'up-to-date' : /Fast-forward/.test(r.stdout) ? 'fast-forward' : 'merged'
}

export async function rebase(dir, onto) {
  const r = await run(dir, ['-c', 'core.editor=true', 'rebase', '--', safeName(onto)], { allowFail: true })
  if (!r.ok) {
    if ((await stateOf(dir)) === 'rebase') return 'conflicts'
    throw new Error((r.stderr || r.stdout).trim())
  }
  return 'done'
}

export async function cherryPick(dir, oid) {
  const r = await run(dir, ['cherry-pick', safeName(oid)], { allowFail: true })
  if (!r.ok) {
    if ((await stateOf(dir)) === 'cherry-pick') return 'conflicts'
    throw new Error((r.stderr || r.stdout).trim())
  }
  return 'done'
}

export async function revert(dir, oid) {
  const r = await run(dir, ['revert', '--no-edit', safeName(oid)], { allowFail: true })
  if (!r.ok) {
    if ((await stateOf(dir)) === 'revert') return 'conflicts'
    throw new Error((r.stderr || r.stdout).trim())
  }
  return 'done'
}

export async function reset(dir, oid, mode) {
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw new Error('Invalid reset mode')
  await run(dir, ['reset', '-q', `--${mode}`, safeName(oid)])
}

export async function abort(dir) {
  const state = await stateOf(dir)
  if (!state) return
  await run(dir, [state, '--abort'])
}

export async function continueOp(dir) {
  const state = await stateOf(dir)
  if (!state) return
  if (state === 'merge') await run(dir, ['-c', 'core.editor=true', 'commit', '-q', '--no-edit'])
  else await run(dir, ['-c', 'core.editor=true', state, '--continue'])
}

export async function fetchAll(dir) {
  await run(dir, ['fetch', '--all', '--prune'])
}

export async function pull(dir, mode) {
  const flag = mode === 'rebase' ? '--rebase' : mode === 'ff-only' ? '--ff-only' : '--no-rebase'
  await run(dir, ['pull', flag])
}

export async function push(dir) {
  const upstream = (await run(dir, ['rev-parse', '-q', '--abbrev-ref', '@{u}'], { allowFail: true })).ok
  if (upstream) {
    await run(dir, ['push'])
    return
  }
  const branch = (await run(dir, ['symbolic-ref', '-q', '--short', 'HEAD'])).stdout.trim()
  const remotes = (await run(dir, ['remote'])).stdout.trim().split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  if (!remote) throw new Error('This repository has no remote to push to')
  await run(dir, ['push', '-u', '--', remote, branch])
}

export function isRepo(dir) {
  try {
    return statSync(dir).isDirectory()
  } catch {
    return false
  }
}
