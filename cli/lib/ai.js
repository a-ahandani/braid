import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export const AGENTS = [
  { id: 'claude', name: 'Claude Code', bin: 'claude', args: () => ['-p', '--output-format', 'text', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--disable-slash-commands'] },
  { id: 'codex', name: 'Codex', bin: 'codex', args: (out) => ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--output-last-message', out, '-'] },
  { id: 'gemini', name: 'Gemini CLI', bin: 'gemini', args: () => [] },
  { id: 'opencode', name: 'opencode', bin: 'opencode', args: () => ['run', '--agent', 'plan'] },
]

export const PROMPT_TASKS = ['commit', 'branch', 'conflict']

const WIN = process.platform === 'win32'
const running = new Set()

export function killAll() {
  for (const kill of running) kill()
}

export function findBin(bin, env = process.env) {
  const exts = WIN ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';') : ['']
  for (const dir of (env.PATH || '').split(delimiter)) {
    for (const ext of exts) {
      const file = dir && join(dir, bin + ext)
      if (file && existsSync(file) && statSync(file).isFile()) return file
    }
  }
  return undefined
}

export function detect(env = process.env) {
  return AGENTS.filter((a) => findBin(a.bin, env)).map(({ id, name }) => ({ id, name }))
}

export function cleanSettings(s) {
  const prompts = Object.entries(s?.prompts ?? {}).filter(([k, v]) => PROMPT_TASKS.includes(k) && typeof v === 'string' && v.trim())
  return {
    ...(typeof s?.enabled === 'boolean' ? { enabled: s.enabled } : {}),
    ...(AGENTS.some((a) => a.id === s?.agent) ? { agent: s.agent } : {}),
    prompts: Object.fromEntries(prompts.map(([k, v]) => [k, v.slice(0, 4000)])),
  }
}

function reason(stderr, name) {
  const line = stderr.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter((l) => l.trim()).pop() ?? ''
  const message = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(line)?.[1] ?? line.trim()
  return message ? `${name}: ${message.slice(0, 500)}` : `${name} stopped without a reply`
}

export async function ask(id, prompt, { signal, env = process.env, timeout = 300000 } = {}) {
  const agent = AGENTS.find((a) => a.id === id)
  const bin = agent && findBin(agent.bin, env)
  if (!bin) throw new Error('That AI agent is not installed')
  const tmp = await mkdtemp(join(tmpdir(), 'ramulus-ai-'))
  const out = join(tmp, 'reply.txt')
  const args = agent.args(out)
  try {
    const { code, stdout, stderr } = await new Promise((resolve, reject) => {
      const child = spawn(WIN ? `"${bin}"` : bin, WIN ? args.map((a) => `"${a}"`) : args, { cwd: tmp, env, shell: WIN, detached: !WIN, windowsHide: true })
      let stdout = ''
      let stderr = ''
      const kill = () => {
        try {
          if (WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
          else process.kill(-child.pid, 'SIGTERM')
        } catch {}
      }
      running.add(kill)
      const stop = (message) => {
        kill()
        reject(new Error(message))
      }
      const onAbort = () => stop('Stopped')
      const timer = setTimeout(() => stop(`${agent.name} did not answer within ${Math.round(timeout / 60000)} minutes`), timeout)
      if (signal?.aborted) onAbort()
      signal?.addEventListener('abort', onAbort)
      child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d))
      child.stderr.setEncoding('utf8').on('data', (d) => (stderr = (stderr + d).slice(-8000)))
      child.on('error', reject)
      child.on('close', (code) => {
        running.delete(kill)
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve({ code, stdout, stderr })
      })
      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    })
    const reply = (await readFile(out, 'utf8').catch(() => stdout)).trim()
    if (code !== 0 || !reply) throw new Error(reason(stderr, agent.name))
    return reply
  } finally {
    rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {})
  }
}
