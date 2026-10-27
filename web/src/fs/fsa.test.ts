import { describe, expect, it } from 'vitest'
import { FsaFs } from './fsa'

class FakeFile {
  constructor(public data: Uint8Array = new Uint8Array()) {}
  readonly kind = 'file'
  async getFile() {
    const data = this.data
    return { size: data.length, lastModified: 1, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), text: async () => new TextDecoder().decode(data) }
  }
  async createWritable() {
    return { write: async (d: string | Uint8Array) => (this.data = typeof d === 'string' ? new TextEncoder().encode(d) : d), close: async () => {} }
  }
}

class FakeDir {
  readonly kind = 'directory'
  entries = new Map<string, FakeDir | FakeFile>()
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    let e = this.entries.get(name)
    if (!e && opts?.create) this.entries.set(name, (e = new FakeDir()))
    if (!(e instanceof FakeDir)) throw new DOMException('missing', 'NotFoundError')
    return e
  }
  async getFileHandle(name: string, opts?: { create?: boolean }) {
    let e = this.entries.get(name)
    if (!e && opts?.create) this.entries.set(name, (e = new FakeFile()))
    if (!(e instanceof FakeFile)) throw new DOMException('missing', 'NotFoundError')
    return e
  }
  async removeEntry(name: string) {
    if (!this.entries.delete(name)) throw new DOMException('missing', 'NotFoundError')
  }
  async *keys() {
    yield* this.entries.keys()
  }
}

describe('FsaFs', () => {
  it('writes, reads, lists and survives a directory removed behind its back', async () => {
    const root = new FakeDir()
    const fs = new FsaFs(root as unknown as FileSystemDirectoryHandle)
    await fs.mkdir('/.git/refs/heads/feature')
    await fs.writeFile('/.git/refs/heads/feature/x', 'abc\n')
    expect(await fs.readFile('/.git/refs/heads/feature/x', 'utf8')).toBe('abc\n')
    expect(await fs.readdir('/.git/refs/heads')).toEqual(['feature'])
    expect((await fs.stat('/.git/refs/heads/feature/x')).isFile()).toBe(true)
    await expect(fs.mkdir('/.git/refs/heads/feature')).rejects.toMatchObject({ code: 'EEXIST' })
    const heads = await (await root.getDirectoryHandle('.git')).getDirectoryHandle('refs').then((r) => r.getDirectoryHandle('heads'))
    await heads.removeEntry('feature')
    await fs.mkdir('/.git/refs/heads/feature')
    await fs.writeFile('/.git/refs/heads/feature/y', 'def\n')
    expect(await fs.readFile('/.git/refs/heads/feature/y', 'utf8')).toBe('def\n')
    await expect(fs.readFile('/.git/nope', 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
