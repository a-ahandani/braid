type Dir = FileSystemDirectoryHandle

function fsError(code: string, path: string): Error & { code: string } {
  const e = new Error(`${code}: ${path}`) as Error & { code: string }
  e.code = code
  return e
}

function split(path: string): string[] {
  return path.split('/').filter((p) => p.length > 0 && p !== '.')
}

function statOf(kind: 'file' | 'dir', size: number, mtimeMs: number) {
  const mode = kind === 'file' ? 0o100644 : 0o40000
  return {
    type: kind,
    mode,
    size,
    ino: 0,
    dev: 0,
    uid: 0,
    gid: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    mtime: new Date(mtimeMs),
    ctime: new Date(mtimeMs),
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => false,
  }
}

export class FsaFs {
  private dirs = new Map<string, Dir>()
  private root: Dir
  readonly promises

  constructor(root: Dir) {
    this.root = root
    this.dirs.set('', root)
    this.promises = {
      readFile: (p: string, o?: { encoding?: string } | string) => this.readFile(p, o),
      writeFile: (p: string, d: string | Uint8Array) => this.writeFile(p, d),
      unlink: (p: string) => this.unlink(p),
      readdir: (p: string) => this.readdir(p),
      mkdir: (p: string) => this.mkdir(p),
      rmdir: (p: string) => this.rmdir(p),
      stat: (p: string) => this.stat(p),
      lstat: (p: string) => this.stat(p),
      readlink: (p: string) => Promise.reject(fsError('ENOSYS', p)),
      symlink: (p: string) => Promise.reject(fsError('ENOSYS', p)),
    }
  }

  private async dir(parts: string[], create = false): Promise<Dir> {
    const key = parts.join('/')
    const hit = this.dirs.get(key)
    if (hit) return hit
    let d = this.root
    for (let i = 0; i < parts.length; i++) {
      const sub = parts.slice(0, i + 1).join('/')
      const cached = this.dirs.get(sub)
      if (cached) {
        d = cached
        continue
      }
      try {
        d = await d.getDirectoryHandle(parts[i], { create })
      } catch {
        throw fsError('ENOENT', sub)
      }
      this.dirs.set(sub, d)
    }
    return d
  }

  private async parentAndName(path: string, create = false): Promise<[Dir, string]> {
    const parts = split(path)
    const name = parts.pop()
    if (name === undefined) throw fsError('EINVAL', path)
    return [await this.dir(parts, create), name]
  }

  async readFile(path: string, opts?: { encoding?: string } | string): Promise<Uint8Array | string> {
    const [d, name] = await this.parentAndName(path)
    let file: File
    try {
      file = await (await d.getFileHandle(name)).getFile()
    } catch {
      throw fsError('ENOENT', path)
    }
    const encoding = typeof opts === 'string' ? opts : opts?.encoding
    if (encoding === 'utf8' || encoding === 'utf-8') return await file.text()
    return new Uint8Array(await file.arrayBuffer())
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const [d, name] = await this.parentAndName(path, true)
    const handle = await d.getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    await w.write(data as FileSystemWriteChunkType)
    await w.close()
  }

  async unlink(path: string): Promise<void> {
    const [d, name] = await this.parentAndName(path)
    try {
      await d.removeEntry(name)
    } catch {
      throw fsError('ENOENT', path)
    }
  }

  async readdir(path: string): Promise<string[]> {
    const d = await this.dir(split(path))
    const names: string[] = []
    for await (const name of d.keys()) names.push(name)
    return names
  }

  async mkdir(path: string): Promise<void> {
    const parts = split(path)
    if (this.dirs.has(parts.join('/'))) throw fsError('EEXIST', path)
    const [d, name] = await this.parentAndName(path)
    let existed = true
    try {
      await d.getDirectoryHandle(name)
    } catch {
      existed = false
    }
    const h = await d.getDirectoryHandle(name, { create: true })
    this.dirs.set(parts.join('/'), h)
    if (existed) throw fsError('EEXIST', path)
  }

  async rmdir(path: string): Promise<void> {
    const parts = split(path)
    const [d, name] = await this.parentAndName(path)
    try {
      await d.removeEntry(name)
    } catch {
      throw fsError('ENOTEMPTY', path)
    }
    for (const key of [...this.dirs.keys()]) {
      if (key === parts.join('/') || key.startsWith(parts.join('/') + '/')) this.dirs.delete(key)
    }
  }

  async stat(path: string) {
    const parts = split(path)
    if (parts.length === 0) return statOf('dir', 0, 0)
    const [d, name] = await this.parentAndName(path)
    try {
      const f = await (await d.getFileHandle(name)).getFile()
      return statOf('file', f.size, f.lastModified)
    } catch {
      try {
        await d.getDirectoryHandle(name)
        return statOf('dir', 0, 0)
      } catch {
        throw fsError('ENOENT', path)
      }
    }
  }

  async removeTree(path: string): Promise<void> {
    const [d, name] = await this.parentAndName(path)
    await d.removeEntry(name, { recursive: true })
    for (const key of [...this.dirs.keys()]) {
      if (key === split(path).join('/') || key.startsWith(split(path).join('/') + '/')) this.dirs.delete(key)
    }
  }
}
