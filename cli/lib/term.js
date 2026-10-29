import { AGENTS, findBin } from './ai.js'

const WIN = process.platform === 'win32'
const KEEP = 200000

let ptyModule
const loadPty = () => (ptyModule ??= import('@lydell/node-pty').then((m) => m.default ?? m, () => null))

export function trimTail(buf, keep) {
  if (buf.length <= keep) return buf
  const cut = buf.indexOf('\n', buf.length - keep)
  return buf.slice(cut < 0 ? buf.length - keep : cut + 1)
}

const size = (n, min, max, fallback) => (Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback)

const MAX_PER_REPO = 8

export function createTerminals() {
  const sessions = new Map()
  const key = (repo, id) => `${repo}\n${id}`
  const send = (s, event, data) => {
    for (const res of s.clients) res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)
  }

  const stopKey = (k) => {
    const s = sessions.get(k)
    if (!s) return
    sessions.delete(k)
    s.proc.kill()
  }

  const command = (kind, agentId, env) => {
    if (kind === 'shell') return WIN ? [env.ComSpec || 'cmd.exe', []] : [env.SHELL || '/bin/sh', []]
    const agent = AGENTS.find((a) => a.id === agentId)
    const bin = agent && findBin(agent.bin, env)
    if (!bin) throw new Error('That AI agent is not installed')
    return WIN ? [env.ComSpec || 'cmd.exe', ['/d', '/c', bin]] : [bin, []]
  }

  return {
    async start(repo, id, kind, agentId, cols, rows, env = process.env) {
      const c = size(cols, 20, 500, 80)
      const r = size(rows, 5, 200, 24)
      const k = key(repo, id)
      const old = sessions.get(k)
      if (old) {
        old.proc.resize(c, Math.max(5, r - 1))
        old.proc.resize(c, r)
        return { agent: old.agent, fresh: false }
      }
      if ([...sessions.keys()].filter((x) => x.startsWith(`${repo}\n`)).length >= MAX_PER_REPO) throw new Error('Close a terminal tab before opening another')
      const [file, args] = command(kind, agentId, env)
      const pty = await loadPty()
      if (!pty) throw new Error('The terminal is not available on this system')
      const proc = pty.spawn(file, args, { name: 'xterm-256color', cols: c, rows: r, cwd: repo, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } })
      const agent = kind === 'shell' ? undefined : agentId
      const s = { proc, kind, agent, buf: '', clients: new Set() }
      sessions.set(k, s)
      proc.onData((d) => {
        s.buf = trimTail(s.buf + d, KEEP)
        send(s, '', d)
      })
      proc.onExit(({ exitCode }) => {
        if (sessions.get(k) === s) sessions.delete(k)
        send(s, 'exit', exitCode)
      })
      return { agent, fresh: true }
    },
    list(repo) {
      const prefix = key(repo, '')
      return [...sessions].filter(([k]) => k.startsWith(prefix)).map(([k, s]) => ({ id: k.slice(prefix.length), kind: s.kind, agent: s.agent }))
    },
    attach(repo, id, res) {
      const s = sessions.get(key(repo, id))
      if (!s) {
        res.write('event: exit\ndata: null\n\n')
        return () => {}
      }
      if (s.buf) res.write(`data: ${JSON.stringify(s.buf)}\n\n`)
      s.clients.add(res)
      return () => s.clients.delete(res)
    },
    write(repo, id, data) {
      sessions.get(key(repo, id))?.proc.write(String(data))
    },
    resize(repo, id, cols, rows) {
      sessions.get(key(repo, id))?.proc.resize(size(cols, 20, 500, 80), size(rows, 5, 200, 24))
    },
    stop(repo, id) {
      if (id !== undefined) return stopKey(key(repo, id))
      for (const k of [...sessions.keys()]) if (k.startsWith(`${repo}\n`)) stopKey(k)
    },
    stopAll() {
      for (const k of [...sessions.keys()]) stopKey(k)
    },
  }
}
