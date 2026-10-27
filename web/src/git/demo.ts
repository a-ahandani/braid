import LightningFS from '@isomorphic-git/lightning-fs'
import git from 'isomorphic-git'
import type { Ctx } from './repo'

export async function demoRepo(): Promise<Ctx> {
  const fs = new LightningFS('ramify-demo', { wipe: true } as never)
  const dir = '/demo'
  const author = { name: 'Sam Rivera', email: 'sam@example.com' }
  let t = Math.floor(Date.now() / 1000) - 3600 * 24 * 30
  const tick = () => (t += 3600 * 7)
  const write = (p: string, s: string) => fs.promises.writeFile(`${dir}/${p}`, s)
  const save = async (message: string, who = author) => {
    const ts = tick()
    return git.commit({ fs, dir, message, author: { ...who, timestamp: ts }, committer: { ...who, timestamp: ts } })
  }
  await fs.promises.mkdir(dir)
  await git.init({ fs, dir, defaultBranch: 'main' })
  await git.setConfig({ fs, dir, path: 'user.name', value: author.name })
  await git.setConfig({ fs, dir, path: 'user.email', value: author.email })
  await write('README.md', '# Demo project\n\nA small repository to try Ramify.\n')
  await git.add({ fs, dir, filepath: 'README.md' })
  await save('Initial commit')
  await write('src.js', 'export const answer = 42\n')
  await git.add({ fs, dir, filepath: 'src.js' })
  await save('Add the first module')
  await git.branch({ fs, dir, ref: 'feature/login', checkout: true })
  await write('login.js', 'export function login() {}\n')
  await git.add({ fs, dir, filepath: 'login.js' })
  await save('Start the login form', { name: 'Ana Kim', email: 'ana@example.com' })
  await write('login.js', 'export function login(user) {\n  return user\n}\n')
  await git.add({ fs, dir, filepath: 'login.js' })
  await save('Accept a user in login', { name: 'Ana Kim', email: 'ana@example.com' })
  await git.checkout({ fs, dir, ref: 'main' })
  await write('src.js', 'export const answer = 42\nexport const greeting = "hi"\n')
  await git.add({ fs, dir, filepath: 'src.js' })
  await save('Add a greeting')
  const ts = tick()
  await git.merge({ fs, dir, ours: 'main', theirs: 'feature/login', author: { ...author, timestamp: ts }, message: 'Merge feature/login into main' })
  await git.checkout({ fs, dir, ref: 'main' })
  await git.tag({ fs, dir, ref: 'v1.0' })
  await git.branch({ fs, dir, ref: 'experiment/cache', checkout: true })
  await write('cache.js', 'export const cache = new Map()\n')
  await git.add({ fs, dir, filepath: 'cache.js' })
  await save('Sketch a cache', { name: 'Ana Kim', email: 'ana@example.com' })
  await git.checkout({ fs, dir, ref: 'main' })
  await write('README.md', '# Demo project\n\nA small repository to try Ramify.\n\nEdit me, stage me, commit me.\n')
  await write('notes.txt', 'untracked scratch file\n')
  return { fs, dir, cache: {} }
}
