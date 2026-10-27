import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import http from 'node:http'
import { extname, join, normalize } from 'node:path'
import * as git from './git.js'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }

const OPS = {
  load: (dir, b) => git.load(dir, b.limit),
  status: (dir) => git.status(dir),
  commitFiles: (dir, b) => git.commitFiles(dir, b.oid),
  diff: (dir, b) => git.diff(dir, b.area, b.path),
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

export function createServer({ dir, uiDir, token }) {
  const clients = new Set()
  let timer
  const notify = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      for (const res of clients) res.write('data: changed\n\n')
    }, 400)
  }
  try {
    watch(dir, { recursive: true }, (_, file) => {
      const f = (file ?? '').toString().replaceAll('\\', '/')
      if (f.includes('.git/objects') || f.endsWith('.lock') || f.includes('node_modules')) return
      notify()
    })
  } catch {
    /* recursive watching is unavailable on this platform; the UI still has a refresh button */
  }

  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? ''
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) {
      res.writeHead(403).end('forbidden host')
      return
    }
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/events') {
      if (url.searchParams.get('token') !== token) {
        res.writeHead(401).end()
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-ramify-token'] !== token) {
        sendJson(res, 401, { error: 'bad token' })
        return
      }
      const op = OPS[url.pathname.slice(5)]
      if (!op || req.method !== 'POST') {
        sendJson(res, 404, { error: 'unknown operation' })
        return
      }
      try {
        const body = await readBody(req)
        sendJson(res, 200, { result: (await op(dir, body)) ?? null })
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
