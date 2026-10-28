import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import * as git from './git.js'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

const OPS = {
  load: (dir, b) => git.load(dir, b.limit),
  status: (dir) => git.status(dir),
  commitFiles: (dir, b) => git.commitFiles(dir, b.oid),
  fileVersions: (dir, b) => git.fileVersions(dir, b.area, b.path),
  writeIndex: (dir, b) => git.writeIndex(dir, b.path, b.content, b.expected),
  writeWorkdir: (dir, b) => git.writeWorkdir(dir, b.path, b.content, b.expected),
  openPath: (dir, b) => git.openPath(dir, b.path),
  stage: (dir, b) => git.stage(dir, b.paths),
  unstage: (dir, b) => git.unstage(dir, b.paths),
  discard: (dir, b) => git.discard(dir, b.files),
  commit: (dir, b) => git.commit(dir, b.message, b.amend),
  checkoutBranch: (dir, b) => git.checkoutBranch(dir, b.name),
  checkoutRemote: (dir, b) => git.checkoutRemote(dir, b.name),
  checkoutCommit: (dir, b) => git.checkoutCommit(dir, b.oid),
  createBranch: (dir, b) => git.createBranch(dir, b.name, b.at, b.checkout),
  deleteBranch: (dir, b) => git.deleteBranch(dir, b.name),
  renameBranch: (dir, b) => git.renameBranch(dir, b.oldName, b.newName),
  createTag: (dir, b) => git.createTag(dir, b.name, b.at, b.message),
  deleteTag: (dir, b) => git.deleteTag(dir, b.name),
  stashSave: (dir, b) => git.stashSave(dir, b.message),
  stashApply: (dir, b) => git.stashApply(dir, b.index, b.pop),
  stashDrop: (dir, b) => git.stashDrop(dir, b.index),
  merge: (dir, b) => git.merge(dir, b.branch),
  rebase: (dir, b) => git.rebase(dir, b.onto),
  cherryPick: (dir, b) => git.cherryPick(dir, b.oid),
  revert: (dir, b) => git.revert(dir, b.oid),
  reset: (dir, b) => git.reset(dir, b.oid, b.mode),
  abort: (dir) => git.abort(dir),
  continue: (dir) => git.continueOp(dir),
  fetchAll: (dir) => git.fetchAll(dir),
  pull: (dir, b) => git.pull(dir, b.mode),
  push: (dir) => git.push(dir),
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data ?? null))
}

const STATE = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ramulus', 'recent.json')

function watchRepo(dir) {
  const clients = new Set()
  let timer
  let watcher
  try {
    watcher = watch(dir, { recursive: true }, (_, file) => {
      const f = (file ?? '').toString().replaceAll('\\', '/')
      if (f.includes('.git/objects') || f.endsWith('.lock') || f.includes('node_modules')) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        for (const res of clients) res.write('data: changed\n\n')
      }, 400)
    })
  } catch {
    watcher = undefined
  }
  return { clients, close: () => (clearTimeout(timer), watcher?.close()) }
}

export function createServer({ dir, root = dir, uiDir, token, stateFile = STATE }) {
  const known = new Set(dir ? [dir] : [])
  const watchers = new Map()
  const readRecent = () => readFile(stateFile, 'utf8').then(JSON.parse, () => [])
  const remember = async (repo) => {
    const list = [repo, ...(await readRecent()).filter((d) => d !== repo)].slice(0, 12)
    await mkdir(dirname(stateFile), { recursive: true })
    await writeFile(stateFile, JSON.stringify(list))
  }
  if (dir) remember(dir).catch(() => {})
  const info = (repo) => ({ dir: repo, name: basename(repo) })
  const SHELL = {
    repos: async () => ({ current: dir ? info(dir) : null, recent: (await readRecent()).filter((d) => existsSync(d)).map(info) }),
    findRepos: async () => ({ root, repos: dir ? [] : (await git.findRepos(root)).map(info) }),
    pickFolder: () => git.pickFolder(),
    openRepo: async (b) => {
      const path = resolve(dir, String(b.path ?? '').trim().replace(/^~(?=$|[/\\])/, homedir()))
      if (!existsSync(path) || !statSync(path).isDirectory()) throw new Error('That folder does not exist')
      const top = await git.toplevel(path)
      known.add(top)
      await remember(top).catch(() => {})
      return info(top)
    },
  }

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
      res.writeHead(403).end('forbidden host')
      return
    }
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/events') {
      const repo = url.searchParams.get('repo') || dir
      if (url.searchParams.get('token') !== token || !known.has(repo)) {
        res.writeHead(401).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      let w = watchers.get(repo)
      if (!w) watchers.set(repo, (w = watchRepo(repo)))
      w.clients.add(res)
      req.on('close', () => {
        w.clients.delete(res)
        if (w.clients.size === 0 && watchers.get(repo) === w) {
          w.close()
          watchers.delete(repo)
        }
      })
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-ramulus-token'] !== token) {
        sendJson(res, 401, { error: 'bad token' })
        return
      }
      const name = url.pathname.slice(5)
      const shell = Object.hasOwn(SHELL, name) ? SHELL[name] : undefined
      const op = Object.hasOwn(OPS, name) ? OPS[name] : undefined
      if ((!op && !shell) || req.method !== 'POST') {
        sendJson(res, 404, { error: 'unknown operation' })
        return
      }
      try {
        const body = await readBody(req)
        const repo = body.repo ?? dir
        if (!shell && !known.has(repo)) throw new Error('Open that repository first')
        sendJson(res, 200, { result: (await (shell ? shell(body) : op(repo, body))) ?? null })
      } catch (e) {
        sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) })
      }
      return
    }
    const rel = url.pathname === '/' ? '/index.html' : url.pathname
    const file = join(uiDir, normalize(rel).replace(/^(\.\.[/\\])+/, ''))
    if (!file.startsWith(uiDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    createReadStream(file).pipe(res)
  })
  return server
}
