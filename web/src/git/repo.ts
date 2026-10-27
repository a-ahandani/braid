import git, { type FsClient, type ReadCommitResult } from 'isomorphic-git'
import http from 'isomorphic-git/http/web'
import { structuredPatch } from 'diff'
import type { NodeKind } from './graph'

export interface Ctx {
  fs: FsClient
  dir: string
  cache: object
  removeTree?: (path: string) => Promise<void>
}

export interface Commit {
  id: string
  parents: string[]
  author: string
  email: string
  time: number
  summary: string
  body: string
  kind: NodeKind
}

export type RefKind = 'head' | 'remote' | 'tag'

export interface RefLabel {
  name: string
  kind: RefKind
  current?: boolean
}

export interface BranchInfo {
  name: string
  oid: string
  isHead: boolean
}

export interface StashInfo {
  index: number
  message: string
  oid: string
}

export type ChangeKind = 'A' | 'M' | 'D' | '?'

export interface FileChange {
  path: string
  kind: ChangeKind
}

export interface WorkStatus {
  staged: FileChange[]
  unstaged: FileChange[]
}

export interface RepoData {
  name: string
  headBranch?: string
  headOid?: string
  commits: Commit[]
  refsByOid: Map<string, RefLabel[]>
  local: BranchInfo[]
  remote: BranchInfo[]
  tags: { name: string; oid: string }[]
  stashes: StashInfo[]
  status: WorkStatus
  hasMore: boolean
}

export const PAGE = 2000

function splitMessage(message: string): [string, string] {
  const i = message.indexOf('\n')
  if (i < 0) return [message.trim(), '']
  return [message.slice(0, i).trim(), message.slice(i + 1).trim()]
}

async function resolve(ctx: Ctx, ref: string): Promise<string | undefined> {
  try {
    return await git.resolveRef({ fs: ctx.fs, dir: ctx.dir, ref })
  } catch {
    return undefined
  }
}

async function peelToCommit(ctx: Ctx, oid: string): Promise<string | undefined> {
  try {
    return (await git.readCommit({ fs: ctx.fs, dir: ctx.dir, oid, cache: ctx.cache })).oid
  } catch {
    return undefined
  }
}

async function readStashes(ctx: Ctx): Promise<StashInfo[]> {
  let text: string
  try {
    text = (await (ctx.fs as { promises: { readFile: Function } }).promises.readFile(`${ctx.dir}/.git/logs/refs/stash`, 'utf8')) as string
  } catch {
    return []
  }
  const lines = text.split('\n').filter((l) => l.trim().length > 0).reverse()
  return lines.map((line, index) => {
    const [head, message = ''] = line.split('\t')
    const oid = head.split(' ')[1] ?? ''
    return { index, message: message.trim(), oid }
  })
}

export async function status(ctx: Ctx): Promise<WorkStatus> {
  const matrix = await git.statusMatrix({ fs: ctx.fs, dir: ctx.dir, cache: ctx.cache })
  const out: WorkStatus = { staged: [], unstaged: [] }
  for (const [path, head, workdir, stage] of matrix) {
    if (head === 1 && workdir === 1 && stage === 1) continue
    if (!(head === 0 && stage === 0) && stage !== 1) {
      out.staged.push({ path, kind: head === 0 ? 'A' : stage === 0 ? 'D' : 'M' })
    }
    if (stage === 0 && (workdir === 2 || (head === 1 && workdir === 1))) out.unstaged.push({ path, kind: '?' })
    else if (stage === 1 && workdir === 2) out.unstaged.push({ path, kind: 'M' })
    else if (stage === 1 && workdir === 0) out.unstaged.push({ path, kind: 'D' })
    else if (stage === 3) out.unstaged.push({ path, kind: workdir === 0 ? 'D' : 'M' })
  }
  return out
}

export async function load(ctx: Ctx, limit = PAGE): Promise<RepoData> {
  const { fs, dir, cache } = ctx
  const refsByOid = new Map<string, RefLabel[]>()
  const addRef = (oid: string, label: RefLabel) => {
    const list = refsByOid.get(oid) ?? []
    list.push(label)
    refsByOid.set(oid, list)
  }
  const headBranch = (await git.currentBranch({ fs, dir, test: true })) ?? undefined
  const headOid = await resolve(ctx, 'HEAD')
  const tips = new Set<string>()
  if (headOid) tips.add(headOid)

  const local: BranchInfo[] = []
  for (const name of await git.listBranches({ fs, dir })) {
    const oid = await resolve(ctx, `refs/heads/${name}`)
    if (!oid) continue
    tips.add(oid)
    local.push({ name, oid, isHead: name === headBranch })
    addRef(oid, { name, kind: 'head', current: name === headBranch })
  }
  const remote: BranchInfo[] = []
  for (const r of await git.listRemotes({ fs, dir })) {
    for (const b of await git.listBranches({ fs, dir, remote: r.remote })) {
      if (b === 'HEAD') continue
      const name = `${r.remote}/${b}`
      const oid = await resolve(ctx, `refs/remotes/${name}`)
      if (!oid) continue
      tips.add(oid)
      remote.push({ name, oid, isHead: false })
      addRef(oid, { name, kind: 'remote' })
    }
  }
  const tags: { name: string; oid: string }[] = []
  for (const name of await git.listTags({ fs, dir })) {
    const raw = await resolve(ctx, `refs/tags/${name}`)
    const oid = raw && (await peelToCommit(ctx, raw))
    if (!oid) continue
    tips.add(oid)
    tags.push({ name, oid })
    addRef(oid, { name, kind: 'tag' })
  }
  const stashes = await readStashes(ctx)
  const stashMessages = new Map(stashes.map((s) => [s.oid, s.message]))
  const internals = new Set<string>()
  const loaded = new Map<string, ReadCommitResult>()
  const read = async (oid: string) => {
    const hit = loaded.get(oid)
    if (hit) return hit
    const c = await git.readCommit({ fs, dir, oid, cache })
    loaded.set(oid, c)
    return c
  }
  for (const s of stashes) {
    try {
      const c = await read(s.oid)
      c.commit.parent.slice(1).forEach((p) => internals.add(p))
      tips.add(s.oid)
    } catch {
      continue
    }
  }

  const frontier: string[] = []
  const seen = new Set<string>()
  for (const t of tips) {
    if (seen.has(t)) continue
    seen.add(t)
    try {
      await read(t)
      frontier.push(t)
    } catch {
      continue
    }
  }
  const timeOf = (oid: string) => loaded.get(oid)!.commit.committer.timestamp
  const commits: Commit[] = []
  let hasMore = false
  while (frontier.length > 0) {
    let best = 0
    for (let i = 1; i < frontier.length; i++) if (timeOf(frontier[i]) > timeOf(frontier[best])) best = i
    const oid = frontier.splice(best, 1)[0]
    const c = loaded.get(oid)!.commit
    for (const p of c.parent) {
      if (seen.has(p)) continue
      seen.add(p)
      try {
        await read(p)
        frontier.push(p)
      } catch {
        continue
      }
    }
    if (internals.has(oid)) continue
    if (commits.length >= limit) {
      hasMore = true
      break
    }
    const stash = stashMessages.get(oid)
    const [summary, body] = splitMessage(c.message)
    commits.push({
      id: oid,
      parents: stash !== undefined ? c.parent.slice(0, 1) : c.parent,
      author: c.author.name,
      email: c.author.email,
      time: c.committer.timestamp,
      summary: stash ?? summary,
      body,
      kind: stash !== undefined ? 'stash' : c.parent.length > 1 ? 'merge' : 'commit',
    })
  }
  const name = dir.split('/').filter(Boolean).pop() ?? dir
  return { name, headBranch, headOid, commits, refsByOid, local, remote, tags, stashes, status: await status(ctx), hasMore }
}

export async function commitFiles(ctx: Ctx, oid: string): Promise<FileChange[]> {
  const [entry] = await git.log({ fs: ctx.fs, dir: ctx.dir, ref: oid, depth: 1, includeChanges: true, cache: ctx.cache })
  const changes = (entry?.commit as { changes?: [string | null, string | null, string][] }).changes ?? []
  return changes.map(([newOid, oldOid, path]) => ({ path, kind: newOid === null ? 'D' : oldOid === null ? 'A' : 'M' }))
}

export type DiffArea = { kind: 'commit'; oid: string } | { kind: 'staged' } | { kind: 'unstaged' }

export interface DiffLine {
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'note'
  text: string
}

async function blobAt(ctx: Ctx, oid: string | undefined, path: string): Promise<string> {
  if (!oid) return ''
  try {
    const { blob } = await git.readBlob({ fs: ctx.fs, dir: ctx.dir, oid, filepath: path, cache: ctx.cache })
    return new TextDecoder().decode(blob)
  } catch {
    return ''
  }
}

async function stagedBlob(ctx: Ctx, path: string): Promise<string> {
  const oids = await git.walk({
    fs: ctx.fs,
    dir: ctx.dir,
    cache: ctx.cache,
    trees: [git.STAGE()],
    map: async (filepath, [entry]) => (filepath === path && entry ? await entry.oid() : undefined),
  })
  const oid = (oids as (string | undefined)[]).find((o) => o !== undefined)
  if (!oid) return ''
  const { blob } = await git.readBlob({ fs: ctx.fs, dir: ctx.dir, oid, cache: ctx.cache })
  return new TextDecoder().decode(blob)
}

async function workdirText(ctx: Ctx, path: string): Promise<string> {
  try {
    const data = (await (ctx.fs as { promises: { readFile: Function } }).promises.readFile(`${ctx.dir}/${path}`)) as Uint8Array
    return new TextDecoder().decode(data)
  } catch {
    return ''
  }
}

export async function diffLines(ctx: Ctx, area: DiffArea, path: string): Promise<DiffLine[]> {
  let oldText = ''
  let newText = ''
  if (area.kind === 'commit') {
    const c = await git.readCommit({ fs: ctx.fs, dir: ctx.dir, oid: area.oid, cache: ctx.cache })
    oldText = await blobAt(ctx, c.commit.parent[0], path)
    newText = await blobAt(ctx, area.oid, path)
  } else if (area.kind === 'staged') {
    oldText = await blobAt(ctx, await resolve(ctx, 'HEAD'), path)
    newText = await stagedBlob(ctx, path)
  } else {
    oldText = (await stagedBlob(ctx, path)) || (await blobAt(ctx, await resolve(ctx, 'HEAD'), path))
    newText = await workdirText(ctx, path)
  }
  if (oldText.includes('\0') || newText.includes('\0')) return [{ type: 'note', text: 'Binary file' }]
  const patch = structuredPatch(path, path, oldText, newText, undefined, undefined, { context: 3 })
  const out: DiffLine[] = []
  for (const h of patch.hunks) {
    out.push({ type: 'hunk', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` })
    for (const l of h.lines) {
      out.push({ type: l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx', text: l.slice(1) })
    }
  }
  return out
}

async function author(ctx: Ctx) {
  const name = await git.getConfig({ fs: ctx.fs, dir: ctx.dir, path: 'user.name' })
  const email = await git.getConfig({ fs: ctx.fs, dir: ctx.dir, path: 'user.email' })
  if (!name || !email) throw new Error('Set user.name and user.email in the repository or global git config first')
  return { name, email }
}

export async function stage(ctx: Ctx, files: FileChange[]) {
  for (const f of files) {
    if (f.kind === 'D') await git.remove({ fs: ctx.fs, dir: ctx.dir, filepath: f.path, cache: ctx.cache })
    else await git.add({ fs: ctx.fs, dir: ctx.dir, filepath: f.path, cache: ctx.cache })
  }
}

export async function unstage(ctx: Ctx, paths: string[]) {
  for (const p of paths) await git.resetIndex({ fs: ctx.fs, dir: ctx.dir, filepath: p, cache: ctx.cache })
}

export async function discard(ctx: Ctx, files: FileChange[]) {
  const tracked = files.filter((f) => f.kind !== '?').map((f) => f.path)
  for (const f of files) {
    if (f.kind === '?') {
      if (ctx.removeTree) await ctx.removeTree(`${ctx.dir}/${f.path}`)
      else await (ctx.fs as { promises: { unlink: Function } }).promises.unlink(`${ctx.dir}/${f.path}`)
    }
  }
  if (tracked.length > 0) {
    await git.checkout({ fs: ctx.fs, dir: ctx.dir, filepaths: tracked, force: true, cache: ctx.cache })
  }
}

export async function commit(ctx: Ctx, message: string, amend: boolean): Promise<string> {
  return git.commit({ fs: ctx.fs, dir: ctx.dir, message, author: await author(ctx), amend, cache: ctx.cache })
}

export async function checkoutBranch(ctx: Ctx, name: string) {
  await git.checkout({ fs: ctx.fs, dir: ctx.dir, ref: name, cache: ctx.cache })
}

export async function checkoutRemote(ctx: Ctx, remoteName: string) {
  const i = remoteName.indexOf('/')
  const remote = remoteName.slice(0, i)
  const branch = remoteName.slice(i + 1)
  await git.checkout({ fs: ctx.fs, dir: ctx.dir, ref: branch, remote, cache: ctx.cache })
}

export async function checkoutCommit(ctx: Ctx, oid: string) {
  await git.checkout({ fs: ctx.fs, dir: ctx.dir, ref: oid, cache: ctx.cache })
}

export async function createBranch(ctx: Ctx, name: string, at: string, checkout: boolean) {
  await git.branch({ fs: ctx.fs, dir: ctx.dir, ref: name, object: at, checkout })
}

export async function deleteBranch(ctx: Ctx, name: string) {
  await git.deleteBranch({ fs: ctx.fs, dir: ctx.dir, ref: name })
}

export async function renameBranch(ctx: Ctx, oldName: string, newName: string) {
  await git.renameBranch({ fs: ctx.fs, dir: ctx.dir, oldref: oldName, ref: newName })
}

export async function createTag(ctx: Ctx, name: string, at: string, message: string) {
  if (message.trim()) {
    await git.annotatedTag({ fs: ctx.fs, dir: ctx.dir, ref: name, object: at, message, tagger: await author(ctx), cache: ctx.cache })
  } else {
    await git.tag({ fs: ctx.fs, dir: ctx.dir, ref: name, object: at })
  }
}

export async function deleteTag(ctx: Ctx, name: string) {
  await git.deleteTag({ fs: ctx.fs, dir: ctx.dir, ref: name })
}

export async function stashSave(ctx: Ctx, message: string) {
  await git.stash({ fs: ctx.fs, dir: ctx.dir, op: 'push', message: message.trim() || undefined })
}

export async function stashApply(ctx: Ctx, index: number, pop: boolean) {
  await git.stash({ fs: ctx.fs, dir: ctx.dir, op: pop ? 'pop' : 'apply', refIdx: index })
}

export async function stashDrop(ctx: Ctx, index: number) {
  await git.stash({ fs: ctx.fs, dir: ctx.dir, op: 'drop', refIdx: index })
}

export type MergeOutcome = 'up-to-date' | 'fast-forward' | 'merged'

export async function merge(ctx: Ctx, branch: string, head: string): Promise<MergeOutcome> {
  const r = await git.merge({
    fs: ctx.fs,
    dir: ctx.dir,
    ours: head,
    theirs: branch,
    author: await author(ctx),
    message: `Merge ${branch} into ${head}`,
    cache: ctx.cache,
  })
  await git.checkout({ fs: ctx.fs, dir: ctx.dir, ref: head, cache: ctx.cache })
  return r.alreadyMerged ? 'up-to-date' : r.fastForward ? 'fast-forward' : 'merged'
}

export async function reset(ctx: Ctx, branch: string, oid: string, hard: boolean) {
  await git.writeRef({ fs: ctx.fs, dir: ctx.dir, ref: `refs/heads/${branch}`, value: oid, force: true })
  if (hard) await git.checkout({ fs: ctx.fs, dir: ctx.dir, ref: branch, force: true, cache: ctx.cache })
}

export interface NetSettings {
  corsProxy: string
  username: string
  token: string
}

function netArgs(ctx: Ctx, s: NetSettings) {
  return {
    fs: ctx.fs,
    dir: ctx.dir,
    http,
    cache: ctx.cache,
    corsProxy: s.corsProxy || undefined,
    onAuth: () => (s.token ? { username: s.username || 'x-access-token', password: s.token } : undefined),
  }
}

export async function fetchAll(ctx: Ctx, s: NetSettings) {
  for (const r of await git.listRemotes({ fs: ctx.fs, dir: ctx.dir })) {
    await git.fetch({ ...netArgs(ctx, s), remote: r.remote, prune: true, tags: true })
  }
}

export async function pull(ctx: Ctx, s: NetSettings, head: string) {
  await git.pull({ ...netArgs(ctx, s), ref: head, author: await author(ctx) })
}

export async function push(ctx: Ctx, s: NetSettings, head: string) {
  await git.push({ ...netArgs(ctx, s), ref: head, remote: 'origin' })
}
