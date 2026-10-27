#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toplevel } from '../lib/git.js'
import { createServer } from '../lib/server.js'

const args = process.argv.slice(2)
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: ramify [path] [--port N] [--no-open]\n\nServes the Ramify UI for the repository at path (default: current directory).')
  process.exit(0)
}
const portArg = args.indexOf('--port')
const port = portArg >= 0 ? Number(args[portArg + 1]) : 0
const noOpen = args.includes('--no-open')
const pathArg = args.find((a, i) => !a.startsWith('-') && args[i - 1] !== '--port') ?? '.'

let dir
try {
  dir = await toplevel(resolve(pathArg))
} catch (e) {
  console.error(`Not a git repository: ${resolve(pathArg)}\n${e.message}`)
  process.exit(1)
}

const uiDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'ui')
if (!existsSync(join(uiDir, 'index.html'))) {
  console.error('The UI build is missing. Run `npm run build` in the cli folder first.')
  process.exit(1)
}

const token = randomBytes(16).toString('hex')
const server = createServer({ dir, uiDir, token })
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/#${token}`
  console.log(`Ramify is serving ${dir}\n${url}\nPress Ctrl+C to stop.`)
  if (!noOpen) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
  }
})
