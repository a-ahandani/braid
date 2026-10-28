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

export function createTerminals() {
  const sessions = new Map()
  const send = (s, event, data) => {
    for (const res of s.clients) res.write(`${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`)
  }

  const stop = (repo) => {
    const s = sessions.get(repo)
    if (!s) return
    sessions.delete(repo)
    s.proc.kill()
  }

  return {
    async start(repo, agentId, cols, rows, env = process.env) {
      const c = size(cols, 20, 500, 80)
      const r = size(rows, 5, 200, 24)
      const old = sessions.get(repo)
      if (old) {
        old.proc.resize(c, Math.max(5, r - 1))
        old.proc.resize(c, r)
        return { agent: old.agent, fresh: false }
      }
      const agent = AGENTS.find((a) => a.id === agentId)
      const bin = agent && findBin(agent.bin, env)
      if (!bin) throw new Error('That AI agent is not installed')
      const pty = await loadPty()
      if (!pty) throw new Error('The agent terminal is not available on this system')
      const opts = { name: 'xterm-256color', cols: c, rows: r, cwd: repo, env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } }
      const proc = WIN ? pty.spawn(env.ComSpec || 'cmd.exe', ['/d', '/c', bin], opts) : pty.spawn(bin, [], opts)
      const s = { proc, agent: agentId, buf: '', clients: new Set() }
      sessions.set(repo, s)
      proc.onData((d) => {
        s.buf = trimTail(s.buf + d, KEEP)
        send(s, '', d)
      })
      proc.onExit(({ exitCode }) => {
        if (sessions.get(repo) === s) sessions.delete(repo)
        send(s, 'exit', exitCode)
      })
      return { agent: agentId, fresh: true }
    },
    attach(repo, res) {
      const s = sessions.get(repo)
      if (!s) {
        res.write('event: exit\ndata: null\n\n')
        return () => {}
      }
      if (s.buf) res.write(`data: ${JSON.stringify(s.buf)}\n\n`)
      s.clients.add(res)
      return () => s.clients.delete(res)
    },
    write(repo, data) {
      sessions.get(repo)?.proc.write(String(data))
    },
    resize(repo, cols, rows) {
      sessions.get(repo)?.proc.resize(size(cols, 20, 500, 80), size(rows, 5, 200, 24))
    },
    stop,
    stopAll() {
      for (const repo of [...sessions.keys()]) stop(repo)
    },
  }
}
