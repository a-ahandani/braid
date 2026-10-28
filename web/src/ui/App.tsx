import { get, set } from 'idb-keyval'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { FsaFs } from '../fs/fsa'
import type { Backend, FileVersions, PullMode } from '../git/backend'
import { demoRepo } from '../git/demo'
import { layout, type RowLayout } from '../git/graph'
import { httpBackend } from '../git/remote'
import { localBackend, PAGE, type Commit, type Ctx, type DiffArea, type FileChange, type NetSettings, type RepoData } from '../git/repo'
import { laneColor, short } from './bits'
import { DetailPanel, type DiffOptions, type FileSel } from './DetailPanel'
import type { ChunkAction } from './DiffEditor'
import { Dialogs, type Dialog } from './Dialogs'
import { GraphView, type DropInfo, type PillData } from './GraphView'
import { LeftPanel } from './LeftPanel'
import { Menu, type MenuItem, type MenuState } from './Menu'
import { Palette, type Command } from './Palette'
import { Shortcuts } from './Shortcuts'
import { Splitter } from './Splitter'

interface View {
  be: Backend
  data: RepoData
  rows: Commit[]
  layout: RowLayout[]
  maxCol: number
  indexOf: Map<string, number>
  limit: number
}

type Sel = { kind: 'wip' } | { kind: 'commit'; oid: string }

const WIP = '0000000000000000000000000000000000000000'
const SETTINGS_KEY = 'ramulus.net'
const canPick = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const helperToken = typeof location !== 'undefined' && /^#[0-9a-f]{32}$/.test(location.hash) ? location.hash.slice(1) : undefined
const stored = (key: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key))

function buildView(be: Backend, data: RepoData, limit: number): View {
  const rows: Commit[] = [...data.commits]
  if (data.status.staged.length + data.status.unstaged.length > 0) {
    rows.unshift({
      id: WIP,
      parents: data.headOid ? [data.headOid] : [],
      author: '',
      email: '',
      time: Math.floor(Date.now() / 1000),
      summary: '',
      body: '',
      kind: 'wip',
    })
  }
  const l = layout(rows)
  const indexOf = new Map(rows.map((c, i) => [c.id, i]))
  return { be, data, rows, layout: l.rows, maxCol: l.maxCol, indexOf, limit }
}

function loadSettings(): NetSettings {
  const base: NetSettings = { corsProxy: '', username: '', token: '', authorName: '', authorEmail: '' }
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return { ...base, ...saved, token: sessionStorage.getItem(SETTINGS_KEY + '.token') ?? '' }
  } catch {
    return base
  }
}

function saveSettings(s: NetSettings) {
  const { token, ...rest } = s
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(rest))
  sessionStorage.setItem(SETTINGS_KEY + '.token', token)
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function App() {
  const [view, setView] = useState<View>()
  const [sel, setSel] = useState<Sel>()
  const [fileSel, setFileSel] = useState<FileSel>()
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [versions, setVersions] = useState<FileVersions>()
  const [dirty, setDirty] = useState(false)
  const [diffOptions, setDiffOptionsState] = useState<DiffOptions>(() => ({ wrap: stored('ramulus.wrap') === '1', mode: stored('ramulus.diff') === 'split' ? 'split' : 'inline' }))
  const setDiffOptions = (o: DiffOptions) => {
    setDiffOptionsState(o)
    localStorage.setItem('ramulus.wrap', o.wrap ? '1' : '0')
    localStorage.setItem('ramulus.diff', o.mode)
  }
  const [tree, setTreeState] = useState(() => stored('ramulus.tree') === '1')
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [filter, setFilter] = useState('')
  const [solo, setSolo] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<Dialog>()
  const [menu, setMenu] = useState<MenuState>()
  const [palette, setPalette] = useState(false)
  const [shortcuts, setShortcuts] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [showLeft, setShowLeft] = useState(true)
  const [showRight, setShowRight] = useState(true)
  const [widths, setWidths] = useState(() => ({ left: Number(stored('ramulus.left')) || 240, right: Number(stored('ramulus.right')) || 440 }))
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (stored('ramulus.theme') as 'dark' | 'light') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  const [scrollTo, setScrollTo] = useState<number>()
  const [updatedAt, setUpdatedAt] = useState<Date>()
  const [recent, setRecent] = useState<FileSystemDirectoryHandle[]>([])
  const [settings, setSettings] = useState<NetSettings>(loadSettings)
  const [pullMode, setPullMode] = useState<PullMode>('merge')
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const overlayRef = useRef(false)
  const openPalette = (on: boolean) => {
    overlayRef.current = on
    setPalette(on)
  }
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    get<FileSystemDirectoryHandle[]>('recent').then((r) => r && setRecent(r))
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ramulus.theme', theme)
  }, [theme])
  useEffect(() => {
    localStorage.setItem('ramulus.left', String(widths.left))
    localStorage.setItem('ramulus.right', String(widths.right))
  }, [widths])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(undefined), 4000)
    return () => clearTimeout(t)
  }, [toast])
  const setTree = (t: boolean) => {
    setTreeState(t)
    localStorage.setItem('ramulus.tree', t ? '1' : '0')
  }

  const fail = (title: string, e: unknown) => setDialog({ kind: 'error', title, message: e instanceof Error ? e.message : String(e) })

  const applyData = useCallback((be: Backend, data: RepoData, limit: number, fresh: boolean) => {
    const v = buildView(be, data, limit)
    setView(v)
    setUpdatedAt(new Date())
    setSel((cur) => {
      const hasWip = v.rows[0]?.kind === 'wip'
      const keep = !fresh && cur && (cur.kind === 'wip' ? hasWip : v.indexOf.has(cur.oid))
      if (keep) return cur
      return hasWip ? { kind: 'wip' } : data.headOid ? { kind: 'commit', oid: data.headOid } : undefined
    })
    if (fresh) {
      setFileSel(undefined)
      setFilter('')
      setSolo(new Set())
      setSummary('')
      setDescription('')
      setAmend(false)
    }
  }, [])

  const openBackend = async (be: Backend) => {
    setBusy('Reading repository')
    try {
      applyData(be, await be.load(PAGE), PAGE, true)
    } catch (e) {
      fail('Could not read the repository', e)
    } finally {
      setBusy(undefined)
    }
  }

  const openCtx = (ctx: Ctx) => openBackend(localBackend(ctx, () => settingsRef.current))

  useEffect(() => {
    if (helperToken) openBackend(httpBackend(location.origin, helperToken))
  }, [])

  const openHandle = async (handle: FileSystemDirectoryHandle) => {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return
    const fs = new FsaFs(handle)
    const same = await Promise.all(recent.map((h) => h.isSameEntry(handle).catch(() => false)))
    const list = [handle, ...recent.filter((_, i) => !same[i])].slice(0, 10)
    setRecent(list)
    await set('recent', list)
    const fallbackAuthor = () => {
      const s = settingsRef.current
      return s.authorName && s.authorEmail ? { name: s.authorName, email: s.authorEmail } : undefined
    }
    await openCtx({ fs, dir: '/', cache: {}, fallbackAuthor })
  }

  const pickFolder = async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      await openHandle(handle)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail('Could not open the folder', e)
    }
  }

  const reload = useCallback(async () => {
    const v = viewRef.current
    if (!v) return
    try {
      applyData(v.be, await v.be.load(v.limit), v.limit, false)
    } catch (e) {
      fail('Could not read the repository', e)
    }
  }, [applyData])

  useEffect(() => {
    if (!view?.be.subscribe) return
    let timer: ReturnType<typeof setTimeout> | undefined
    return view.be.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
  }, [view?.be, reload])

  const run = async (label: string, fn: () => Promise<unknown>, opts: { after?: (r: unknown) => void; statusOnly?: boolean } = {}) => {
    if (!view || busy) return
    setBusy(label)
    try {
      const r = await fn()
      opts.after?.(r)
    } catch (e) {
      fail('Git could not do that', e)
    } finally {
      setBusy(undefined)
    }
    if (opts.statusOnly) {
      try {
        applyData(view.be, { ...view.data, status: await view.be.status() }, view.limit, false)
      } catch (e) {
        fail('Could not read the repository', e)
      }
    } else {
      await reload()
    }
  }

  useEffect(() => {
    if (!view) return
    if (sel?.kind === 'commit') {
      view.be.commitFiles(sel.oid).then(setCommitFiles).catch(() => setCommitFiles([]))
    } else {
      setCommitFiles([])
    }
  }, [view, sel])

  useEffect(() => {
    setVersions(undefined)
    setDirty(false)
  }, [fileSel])

  useEffect(() => {
    if (!view || !fileSel || dirty) return
    let live = true
    view.be
      .fileVersions(fileSel.area, fileSel.path)
      .then((v) => live && setVersions(v))
      .catch(() => live && setVersions({ old: '', new: '', binary: true }))
    return () => {
      live = false
    }
  }, [view, fileSel, dirty])

  useEffect(() => {
    if (!view || !fileSel) return
    const exists =
      fileSel.area.kind === 'commit'
        ? commitFiles.some((f) => f.path === fileSel.path)
        : (fileSel.area.kind === 'staged' ? view.data.status.staged : view.data.status.unstaged).some((f) => f.path === fileSel.path)
    if (!exists) setFileSel(undefined)
  }, [view, commitFiles, fileSel])

  const soloInfo = useMemo(() => {
    if (!view || solo.size === 0) return undefined
    const tips = new Set<string>()
    for (const b of [...view.data.local, ...view.data.remote]) if (solo.has(b.name)) tips.add(b.oid)
    const parents = new Map(view.rows.map((r) => [r.id, r.parents]))
    const keep = new Set<string>()
    const stack = [...tips]
    while (stack.length) {
      const id = stack.pop()!
      if (keep.has(id) || !parents.has(id)) continue
      keep.add(id)
      for (const p of parents.get(id) ?? []) stack.push(p)
    }
    if (view.data.headOid && keep.has(view.data.headOid)) keep.add(WIP)
    const indices = view.rows.map((_, i) => i).filter((i) => keep.has(view.rows[i].id))
    const l = layout(indices.map((i) => view.rows[i]))
    return { indices, layoutByIndex: new Map(indices.map((i, k) => [i, l.rows[k]])), maxCol: l.maxCol }
  }, [view, solo])

  const order = useMemo(() => {
    if (!view) return []
    const base = soloInfo?.indices ?? view.rows.map((_, i) => i)
    const q = filter.trim().toLowerCase()
    if (!q) return base
    return base.filter((i) => {
      const c = view.rows[i]
      return (
        c.summary.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.id.startsWith(q) ||
        (view.data.refsByOid.get(c.id) ?? []).some((l) => l.name.toLowerCase().includes(q))
      )
    })
  }, [view, filter, soloInfo])

  const selectedIndex = !view || !sel ? -1 : sel.kind === 'wip' ? (view.rows[0]?.kind === 'wip' ? 0 : -1) : (view.indexOf.get(sel.oid) ?? -1)

  const select = (index: number) => {
    if (!view) return
    const c = view.rows[index]
    if (!c) return
    const next: Sel = c.kind === 'wip' ? { kind: 'wip' } : { kind: 'commit', oid: c.id }
    if (JSON.stringify(next) !== JSON.stringify(sel)) {
      setSel(next)
      setFileSel(undefined)
    }
  }

  const jump = (oid: string) => {
    if (!view) return
    const i = view.indexOf.get(oid)
    if (i === undefined) {
      setToast('That commit is not loaded in the graph yet.')
      return
    }
    if (soloInfo && !soloInfo.indices.includes(i)) setSolo(new Set())
    select(i)
    setScrollTo(i)
  }

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => setToast('Copied!'))
  }

  const toggleSolo = (name: string) =>
    setSolo((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const head = view?.data.headBranch
  const confirm = (message: string, action: () => void) => setDialog({ kind: 'confirm', message, action })
  const conflictToast = (r: unknown) => r === 'conflicts' && setToast('There are conflicts to resolve')

  const doCommit = () => {
    if (!view || !summary.trim()) return
    const msg = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
    run('Committing', () => view.be.commit(msg, amend), {
      after: () => {
        setSummary('')
        setDescription('')
        setAmend(false)
      },
    })
  }

  const mergeInto = (name: string) => {
    const v = view!
    return run('Merging', () => v.be.merge(name, head!), {
      after: (r) => {
        if (r === 'up-to-date') setToast(`Already up to date with ${name}`)
        conflictToast(r)
      },
    })
  }

  const rebaseOnto = (target: string) => {
    const v = view!
    return run('Rebasing', () => v.be.rebase!(target), { after: conflictToast })
  }

  const branchItems = (name: string, oid: string, isHead: boolean): MenuItem[] => {
    const v = view!
    const items: MenuItem[] = []
    if (!isHead) {
      items.push({ label: `Switch to ${name}`, onClick: () => run('Switching branch', () => v.be.checkoutBranch(name)) })
      if (head) items.push({ label: `Merge ${name} into ${head}`, onClick: () => mergeInto(name) })
      if (head && v.be.rebase) items.push({ label: `Rebase ${head} onto ${name}`, onClick: () => rebaseOnto(name) })
    }
    items.push({ label: solo.has(name) ? `Stop soloing ${name}` : `Solo ${name}`, onClick: () => toggleSolo(name) })
    items.push({ label: `Rename ${name}`, onClick: () => setDialog({ kind: 'rename', old: name }) })
    items.push({ label: 'New branch from here', onClick: () => setDialog({ kind: 'branch', at: oid }) })
    items.push({ label: 'Copy name', onClick: () => copy(name) })
    if (!isHead) {
      items.push({ sep: true })
      items.push({ label: `Delete ${name}`, danger: true, onClick: () => confirm(`Delete "${name}"? This cannot be undone.`, () => run('Deleting branch', () => v.be.deleteBranch(name))) })
    }
    return items
  }

  const remoteItems = (name: string): MenuItem[] => {
    const v = view!
    return [
      { label: `Switch to ${name}`, onClick: () => run('Switching branch', () => v.be.checkoutRemote(name)) },
      ...(head ? [{ label: `Merge ${name} into ${head}`, onClick: () => mergeInto(name) }] : []),
      ...(head && v.be.rebase ? [{ label: `Rebase ${head} onto ${name}`, onClick: () => rebaseOnto(name) }] : []),
      { label: solo.has(name) ? `Stop soloing ${name}` : `Solo ${name}`, onClick: () => toggleSolo(name) },
      { label: 'Copy name', onClick: () => copy(name) },
    ]
  }

  const tagItems = (name: string, oid: string): MenuItem[] => {
    const v = view!
    return [
      { label: `Check out ${name} (no branch)`, onClick: () => run('Checking out', () => v.be.checkoutCommit(oid)) },
      { label: 'Copy name', onClick: () => copy(name) },
      { sep: true },
      { label: `Delete tag ${name}`, danger: true, onClick: () => confirm(`Delete "${name}"? This cannot be undone.`, () => run('Deleting tag', () => v.be.deleteTag(name))) },
    ]
  }

  const stashItems = (index: number, message: string): MenuItem[] => {
    const v = view!
    return [
      { label: 'Apply (keep stash)', onClick: () => run('Applying stash', () => v.be.stashApply(index, false)) },
      { label: 'Apply and drop', onClick: () => run('Applying stash', () => v.be.stashApply(index, true)) },
      { sep: true },
      { label: 'Drop stash', danger: true, onClick: () => confirm(`Drop the stash "${message}"? This cannot be undone.`, () => run('Dropping stash', () => v.be.stashDrop(index))) },
    ]
  }

  const rowMenu = (e: MouseEvent, index: number) => {
    if (!view) return
    const c = view.rows[index]
    select(index)
    const v = view
    let items: MenuItem[] = []
    if (c.kind === 'wip') {
      items = [
        { label: 'Stash everything', onClick: () => setDialog({ kind: 'stash' }) },
        { label: 'Stage everything', onClick: () => run('Staging', () => v.be.stage(v.data.status.unstaged), { statusOnly: true }) },
        { sep: true },
        {
          label: 'Throw away all changes',
          danger: true,
          onClick: () =>
            confirm('Every staged, unstaged and untracked change in the working tree will be lost. Continue?', () =>
              run(
                'Discarding',
                async () => {
                  if (v.data.status.staged.length) await v.be.unstage(v.data.status.staged.map((f) => f.path))
                  const st = await v.be.status()
                  if (st.unstaged.length) await v.be.discard(st.unstaged)
                },
                { statusOnly: true },
              ),
            ),
        },
      ]
    } else if (view.data.stashes.some((s) => s.oid === c.id)) {
      const s = view.data.stashes.find((s) => s.oid === c.id)!
      items = stashItems(s.index, s.message)
    } else {
      const refs = view.data.refsByOid.get(c.id) ?? []
      const isHead = view.data.headOid === c.id
      for (const l of refs) {
        if (l.kind === 'head') items.push(...branchItems(l.name, c.id, l.current ?? false).filter((i) => i.label !== 'New branch from here'))
        if (l.kind === 'remote') items.push(...remoteItems(l.name))
        if (l.kind === 'tag') items.push(...tagItems(l.name, c.id))
        items.push({ sep: true })
      }
      if (!isHead) items.push({ label: 'Check out here (no branch)', onClick: () => run('Checking out', () => v.be.checkoutCommit(c.id)) })
      items.push({ label: 'New branch from here', onClick: () => setDialog({ kind: 'branch', at: c.id }) })
      items.push({ label: 'New tag here', onClick: () => setDialog({ kind: 'tag', at: c.id }) })
      if (head && !isHead) {
        items.push({ sep: true })
        if (v.be.rebase) items.push({ label: `Rebase ${head} here`, onClick: () => rebaseOnto(c.id) })
        if (v.be.cherryPick) items.push({ label: 'Cherry-pick this commit', onClick: () => run('Cherry-picking', () => v.be.cherryPick!(c.id), { after: conflictToast }) })
        items.push({ label: `Reset ${head} to this commit...`, onClick: () => setDialog({ kind: 'reset', at: c.id }) })
      }
      if (head && v.be.revert) items.push({ label: 'Revert this commit', onClick: () => run('Reverting', () => v.be.revert!(c.id), { after: conflictToast }) })
      items.push({ sep: true })
      items.push({ label: 'Copy full hash', onClick: () => copy(c.id) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const fileMenu = (e: MouseEvent, f: FileChange, area: DiffArea) => {
    const v = view!
    const items: MenuItem[] = []
    if (area.kind === 'unstaged') items.push({ label: 'Stage', onClick: () => run('Staging', () => v.be.stage([f]), { statusOnly: true }) })
    if (area.kind === 'staged') items.push({ label: 'Unstage', onClick: () => run('Unstaging', () => v.be.unstage([f.path]), { statusOnly: true }) })
    if (v.be.openPath && f.kind !== 'D') items.push({ label: 'Open file', onClick: () => v.be.openPath!(f.path).catch((err) => fail('Could not open the file', err)) })
    items.push({ label: 'Copy path', onClick: () => copy(f.path) })
    if (area.kind === 'unstaged') {
      items.push({ sep: true })
      items.push({ label: 'Throw away changes', danger: true, onClick: () => discardFiles([f]) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const discardFiles = (files: FileChange[]) => {
    const v = view!
    const what = files.length === 1 ? `Unstaged edits to "${files[0].path}" will be lost. Continue?` : `Unstaged edits to ${files.length} files will be lost. Continue?`
    confirm(what, () => run('Discarding', () => v.be.discard(files), { statusOnly: true }))
  }

  const chunkActions: ChunkAction[] = (() => {
    const v = view
    const f = fileSel
    if (!v || !f || f.area.kind === 'commit') return []
    const list = f.area.kind === 'staged' ? v.data.status.staged : v.data.status.unstaged
    if (list.find((x) => x.path === f.path)?.kind !== 'M') return []
    if (f.area.kind === 'staged') return [{ label: 'Unstage', into: 'b', run: (t) => run('Unstaging chunk', () => v.be.writeIndex(f.path, t), { statusOnly: true }) }]
    return [
      { label: 'Stage', into: 'a', run: (t) => run('Staging chunk', () => v.be.writeIndex(f.path, t), { statusOnly: true }) },
      {
        label: 'Discard',
        danger: true,
        into: 'b',
        run: (t) => confirm(`This change in "${f.path}" will be reverted in the working tree. Continue?`, () => run('Discarding chunk', () => v.be.writeWorkdir(f.path, t), { statusOnly: true })),
      },
    ]
  })()
  const saveFile = (text: string) => {
    const v = view
    const f = fileSel
    if (!v || !f) return
    run('Saving', () => v.be.writeWorkdir(f.path, text), { statusOnly: true, after: () => setDirty(false) })
  }

  const pillDoubleClick = (pill: PillData) => {
    if (!view) return
    if (pill.local && !pill.current) run('Switching branch', () => view.be.checkoutBranch(pill.local!.name))
    else if (pill.remote && !pill.local) run('Switching branch', () => view.be.checkoutRemote(pill.remote!.name))
  }

  const onDrop = ({ source, rowIndex, x, y }: DropInfo) => {
    const v = view!
    const c = v.rows[rowIndex]
    const refs = v.data.refsByOid.get(c.id) ?? []
    const targetHead = refs.find((l) => l.kind === 'head' && l.current)
    const targetRef = refs.find((l) => l.kind === 'head') ?? refs.find((l) => l.kind === 'remote')
    const targetName = targetRef?.name ?? short(c.id)
    const srcName = source.local?.name ?? source.remote!.name
    const items: MenuItem[] = []
    if (targetHead && srcName !== targetHead.name) items.push({ label: `Merge ${srcName} into ${targetHead.name}`, onClick: () => mergeInto(srcName) })
    if (source.current && head && c.id !== v.data.headOid) {
      if (v.be.rebase) items.push({ label: `Rebase ${head} onto ${targetName}`, onClick: () => rebaseOnto(targetRef?.name ?? c.id) })
      items.push({ label: `Reset ${head} to ${targetName}...`, onClick: () => setDialog({ kind: 'reset', at: c.id }) })
    }
    if (!source.current && !targetHead) items.push({ label: `Switch to ${srcName} first to rebase it, or drop onto ${head ?? 'the checked-out branch'} to merge` })
    setMenu({ x, y, items })
  }

  const commands = useMemo<Command[]>(() => {
    if (!view) return []
    const v = view
    const list: Command[] = [
      { id: 'fetch', group: 'Action', label: 'Fetch every remote', hint: '⌘L', run: () => run('Fetch', () => v.be.fetchAll(), { after: () => setToast('Fetch done') }) },
      { id: 'pull', group: 'Action', label: 'Pull', run: () => head && run('Pull', () => v.be.pull(pullMode, head), { after: () => setToast('Pull done') }) },
      { id: 'push', group: 'Action', label: 'Push', run: () => head && run('Push', () => v.be.push(head), { after: () => setToast('Push done') }) },
      { id: 'branch', group: 'Action', label: 'New branch from HEAD', hint: '⌘B', run: () => v.data.headOid && setDialog({ kind: 'branch', at: v.data.headOid }) },
      { id: 'stash', group: 'Action', label: 'Stash everything', run: () => setDialog({ kind: 'stash' }) },
      { id: 'pop', group: 'Action', label: 'Apply and drop the newest stash', run: () => run('Applying stash', () => v.be.stashApply(0, true)) },
      { id: 'stageall', group: 'Action', label: 'Stage everything', hint: '⌘⇧S', run: () => run('Staging', () => v.be.stage(v.data.status.unstaged), { statusOnly: true }) },
      { id: 'unstageall', group: 'Action', label: 'Unstage everything', hint: '⌘⇧U', run: () => run('Unstaging', () => v.be.unstage(v.data.status.staged.map((f) => f.path)), { statusOnly: true }) },
      { id: 'refresh', group: 'View', label: 'Refresh', run: () => reload() },
      { id: 'left', group: 'View', label: 'Toggle the left panel', hint: '⌘J', run: () => setShowLeft((s) => !s) },
      { id: 'right', group: 'View', label: 'Toggle the detail panel', hint: '⌘K', run: () => setShowRight((s) => !s) },
      { id: 'theme', group: 'View', label: theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme', run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
      { id: 'tree', group: 'View', label: tree ? 'Show files as a flat list' : 'Show files as a tree', run: () => setTree(!tree) },
      { id: 'keys', group: 'View', label: 'Keyboard shortcuts', hint: '?', run: () => setShortcuts(true) },
    ]
    if (solo.size) list.push({ id: 'unsolo', group: 'View', label: 'Show all branches', run: () => setSolo(new Set()) })
    if (canPick && !helperToken) list.push({ id: 'open', group: 'Action', label: 'Open a repository folder', run: pickFolder })
    for (const b of v.data.local) {
      if (!b.isHead) list.push({ id: `sw:${b.name}`, group: 'Branch', label: `Switch to ${b.name}`, run: () => run('Switching branch', () => v.be.checkoutBranch(b.name)) })
      list.push({ id: `solo:${b.name}`, group: 'Branch', label: `Solo ${b.name}`, run: () => toggleSolo(b.name) })
      list.push({ id: `jump:${b.name}`, group: 'Branch', label: `Jump to ${b.name}`, run: () => jump(b.oid) })
    }
    for (const b of v.data.remote) list.push({ id: `swr:${b.name}`, group: 'Remote', label: `Switch to ${b.name}`, run: () => run('Switching branch', () => v.be.checkoutRemote(b.name)) })
    for (const t of v.data.tags) list.push({ id: `tag:${t.name}`, group: 'Tag', label: `Jump to ${t.name}`, run: () => jump(t.oid) })
    return list
  }, [view, head, pullMode, theme, tree, solo])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (mod && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        if (view) openPalette(!palette)
      } else if (mod && e.key === 'f') {
        e.preventDefault()
        document.getElementById('filter')?.focus()
      } else if (mod && e.key === 'b' && view?.data.headOid) {
        e.preventDefault()
        setDialog({ kind: 'branch', at: view.data.headOid })
      } else if (mod && e.key === 'l' && view) {
        e.preventDefault()
        run('Fetch', () => view.be.fetchAll(), { after: () => setToast('Fetch done') })
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        doCommit()
      } else if (mod && e.shiftKey && (e.key === 's' || e.key === 'S') && view) {
        e.preventDefault()
        run('Staging', () => view.be.stage(view.data.status.unstaged), { statusOnly: true })
      } else if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U') && view) {
        e.preventDefault()
        run('Unstaging', () => view.be.unstage(view.data.status.staged.map((f) => f.path)), { statusOnly: true })
      } else if (mod && e.key === 'j') {
        e.preventDefault()
        setShowLeft((s) => !s)
      } else if (mod && e.key === 'k') {
        e.preventDefault()
        setShowRight((s) => !s)
      } else if (e.key === 'Escape') {
        if (palette) openPalette(false)
        else if (shortcuts) setShortcuts(false)
        else if (dialog) setDialog(undefined)
        else if (filter) setFilter('')
        else if (solo.size) setSolo(new Set())
      } else if (!typing && !dialog && !palette && !overlayRef.current) {
        if (e.key === '?') {
          e.preventDefault()
          setShortcuts(true)
        } else if ((e.key === 's' || e.key === 'u') && view && fileSel && fileSel.area.kind !== 'commit') {
          e.preventDefault()
          const list = fileSel.area.kind === 'staged' ? view.data.status.staged : view.data.status.unstaged
          const f = list.find((x) => x.path === fileSel.path)
          if (f && e.key === 's' && fileSel.area.kind === 'unstaged') run('Staging', () => view.be.stage([f]), { statusOnly: true })
          if (f && e.key === 'u' && fileSel.area.kind === 'staged') run('Unstaging', () => view.be.unstage([f.path]), { statusOnly: true })
        } else if (view && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k')) {
          e.preventDefault()
          const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : -1
          const pos = order.indexOf(selectedIndex)
          const next = order[Math.min(order.length - 1, Math.max(0, pos + step))]
          if (next !== undefined) {
            select(next)
            setScrollTo(next)
          }
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const statusBar = (v?: View) => {
    const cur = v?.data.local.find((b) => b.isHead)
    const changes = v ? new Set([...v.data.status.staged, ...v.data.status.unstaged].map((f) => f.path)).size : 0
    return (
      <div class="statusbar">
        {v && (
          <>
            <span>
              {head ?? (v.data.headOid ? 'detached HEAD' : 'no commits')}
              {cur?.upstream ? ` · ↑${cur.ahead ?? 0} ↓${cur.behind ?? 0} vs ${cur.upstream}` : head ? ' · no upstream' : ''}
            </span>
            {changes > 0 && <span class="warn">{changes} uncommitted change{changes === 1 ? '' : 's'}</span>}
            {v.data.stashes.length > 0 && <span>{v.data.stashes.length} stash{v.data.stashes.length === 1 ? '' : 'es'}</span>}
          </>
        )}
        <span class="spacer" />
        {updatedAt && <span title="Last read of the repository">Updated {updatedAt.toLocaleTimeString()}</span>}
        {v && (
          <button onClick={() => openPalette(true)} title="Command palette">
            ⌘⇧P commands
          </button>
        )}
        <button onClick={() => setShortcuts(true)} title="Keyboard shortcuts">
          ? shortcuts
        </button>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Switch theme">
          {theme === 'dark' ? '☀ light' : '☾ dark'}
        </button>
      </div>
    )
  }

  if (!view) {
    return (
      <div class="app">
        <div class="toolbar">
          <span class="repo">Ramulus</span>
        </div>
        <div class="welcome">
          <h1>Ramulus</h1>
          <p>Every branch of your repository, in one graph.{helperToken ? '' : ' Runs entirely in this browser tab.'}</p>
          {busy && <p class="busy">{busy}...</p>}
          {!helperToken && (
            <>
              <div style={{ display: 'flex', gap: '8px' }}>
                {canPick && (
                  <button class="primary" onClick={pickFolder}>
                    Open a repository folder
                  </button>
                )}
                <button onClick={() => demoRepo().then(openCtx).catch((e) => fail('Could not build the demo', e))}>Try the demo repository</button>
              </div>
              {!canPick && <p class="note">Opening folders needs the File System Access API, which Chrome, Edge and other Chromium browsers provide. Safari and Firefox can only run the demo.</p>}
              {recent.length > 0 && (
                <div class="recent">
                  <span class="label">Recent</span>
                  {recent.map((h) => (
                    <a key={h.name} onClick={() => openHandle(h).catch((e) => fail('Could not open the folder', e))}>
                      {h.name}
                    </a>
                  ))}
                </div>
              )}
              <p class="note">Nothing leaves your machine except avatar lookups on gravatar.com and, when you use them, fetch, pull and push through the CORS proxy you set under Settings.</p>
              <p class="note">
                For full speed and your SSH keys, run <code>npx ramulus</code> inside a repository instead.
              </p>
            </>
          )}
        </div>
        {statusBar()}
        {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
        {dialog && (
          <Dialogs
            dialog={dialog}
            settings={settings}
            native={false}
            onClose={() => setDialog(undefined)}
            onCreateBranch={() => {}}
            onCreateTag={() => {}}
            onRename={() => {}}
            onStash={() => {}}
            onReset={() => {}}
            onSettings={(s) => {
              setSettings(s)
              saveSettings(s)
            }}
          />
        )}
      </div>
    )
  }

  const v = view
  const current = sel?.kind === 'commit' ? v.rows[v.indexOf.get(sel.oid) ?? -1] : undefined
  const layoutOf = (i: number) => soloInfo?.layoutByIndex.get(i) ?? v.layout[i]
  const currentColor = current ? laneColor(layoutOf(v.indexOf.get(current.id)!).column) : 'var(--lane-0)'
  const wipCount = new Set([...v.data.status.staged, ...v.data.status.unstaged].map((f) => f.path)).size
  const net = (label: string, fn: () => Promise<unknown>) => run(label, fn, { after: () => setToast(`${label} done`) })

  return (
    <div class="app">
      <div class="toolbar">
        <span class="repo">{v.data.name}</span>
        <span style={{ color: 'var(--text-3)' }}>/</span>
        <span class="branch">{v.data.headBranch ?? (v.data.headOid ? `detached at ${v.data.headOid.slice(0, 7)}` : 'no commits')}</span>
        <button disabled={!!busy || !head} onClick={() => net('Pull', () => v.be.pull(pullMode, head!))} title="Fetch and integrate the upstream branch">
          Pull
        </button>
        {v.be.native && (
          <select value={pullMode} onChange={(e) => setPullMode((e.target as HTMLSelectElement).value as PullMode)} title="How pull integrates changes" style={{ width: 'auto', padding: '4px' }}>
            <option value="merge">merge</option>
            <option value="ff-only">fast-forward only</option>
            <option value="rebase">rebase</option>
          </select>
        )}
        <button disabled={!!busy || !head} onClick={() => net('Push', () => v.be.push(head!))} title="Push the checked-out branch">
          Push
        </button>
        <button disabled={!!busy} onClick={() => net('Fetch', () => v.be.fetchAll())} title="Fetch every remote (⌘L)">
          Fetch
        </button>
        <button disabled={!!busy || !v.data.headOid} onClick={() => setDialog({ kind: 'branch', at: v.data.headOid! })} title="New branch (⌘B)">
          Branch
        </button>
        <button disabled={!!busy || wipCount === 0} onClick={() => setDialog({ kind: 'stash' })} title="Stash everything">
          Stash
        </button>
        <button disabled={!!busy || v.data.stashes.length === 0} onClick={() => run('Applying stash', () => v.be.stashApply(0, true))} title="Apply and drop the newest stash">
          Pop
        </button>
        {busy && <span class="busy">{busy}...</span>}
        <span class="spacer" />
        <input id="filter" placeholder="search commits  ⌘F" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
        {filter && <span class="busy">{order.length} results</span>}
        <button class={showLeft ? 'on' : ''} onClick={() => setShowLeft(!showLeft)} title="Toggle left panel (⌘J)">
          ▤
        </button>
        <button class={showRight ? 'on' : ''} onClick={() => setShowRight(!showRight)} title="Toggle detail panel (⌘K)">
          ▣
        </button>
        {!v.be.native && (
          <button onClick={() => setDialog({ kind: 'settings' })} title="Settings: author and remote access">
            ⚙
          </button>
        )}
        <button onClick={() => reload()} title="Refresh">
          ↻
        </button>
        {canPick && !helperToken && <button onClick={pickFolder}>Open</button>}
      </div>
      <div class={`body ${showLeft ? '' : 'no-left'} ${showRight ? '' : 'no-right'}`} style={{ '--left-w': `${widths.left}px`, '--right-w': `${widths.right}px` }}>
        <LeftPanel
          data={v.data}
          columnOf={(oid) => {
            const i = v.indexOf.get(oid)
            return i === undefined ? undefined : layoutOf(i)?.column
          }}
          selectedOid={sel?.kind === 'commit' ? sel.oid : undefined}
          solo={solo}
          onToggleSolo={toggleSolo}
          onJump={jump}
          onCheckout={(name) => run('Switching branch', () => v.be.checkoutBranch(name))}
          onCheckoutRemote={(name) => run('Switching branch', () => v.be.checkoutRemote(name))}
          onBranchMenu={(e, name, oid, isHead) => setMenu({ x: e.clientX, y: e.clientY, items: branchItems(name, oid, isHead) })}
          onRemoteMenu={(e, name) => setMenu({ x: e.clientX, y: e.clientY, items: remoteItems(name) })}
          onTagMenu={(e, name, oid) => setMenu({ x: e.clientX, y: e.clientY, items: tagItems(name, oid) })}
          onStashMenu={(e, index, message) => setMenu({ x: e.clientX, y: e.clientY, items: stashItems(index, message) })}
        />
        <Splitter onDrag={(dx) => setWidths((w) => ({ ...w, left: clamp(w.left + dx, 160, 520) }))} />
        <GraphView
          rows={v.rows}
          layoutOf={layoutOf}
          maxCol={soloInfo?.maxCol ?? v.maxCol}
          refsByOid={v.data.refsByOid}
          branches={v.data.local}
          order={order}
          showEdges={filter.trim().length === 0}
          selectedIndex={selectedIndex}
          scrollTo={scrollTo}
          wipCount={wipCount}
          hasMore={v.data.hasMore && !soloInfo}
          soloCount={solo.size}
          onSelect={select}
          onContextMenu={rowMenu}
          onPillDoubleClick={pillDoubleClick}
          onDrop={onDrop}
          onLoadMore={() => run('Loading more', async () => applyData(v.be, await v.be.load(v.limit + PAGE), v.limit + PAGE, false))}
          onScrolled={() => setScrollTo(undefined)}
          onClearSolo={() => setSolo(new Set())}
        />
        <Splitter onDrag={(dx) => setWidths((w) => ({ ...w, right: clamp(w.right - dx, 300, 900) }))} />
        <DetailPanel
          data={v.data}
          commit={current}
          commitColor={currentColor}
          commitFiles={commitFiles}
          isStash={!!current && v.data.stashes.some((s) => s.oid === current.id)}
          selectedFile={fileSel}
          versions={versions}
          diffOptions={diffOptions}
          dark={theme === 'dark'}
          chunkActions={chunkActions}
          onSaveFile={saveFile}
          dirty={dirty}
          onDirty={setDirty}
          tree={tree}
          summary={summary}
          description={description}
          amend={amend}
          onDiffOptions={setDiffOptions}
          onTree={setTree}
          onSummary={setSummary}
          onDescription={setDescription}
          onAmend={setAmend}
          onSelectFile={setFileSel}
          onStage={(files) => run('Staging', () => v.be.stage(files), { statusOnly: true })}
          onUnstage={(paths) => run('Unstaging', () => v.be.unstage(paths), { statusOnly: true })}
          onDiscard={discardFiles}
          onStageAll={() => run('Staging', () => v.be.stage(v.data.status.unstaged), { statusOnly: true })}
          onUnstageAll={() => run('Unstaging', () => v.be.unstage(v.data.status.staged.map((f) => f.path)), { statusOnly: true })}
          onCommit={doCommit}
          onCopy={copy}
          onJump={jump}
          onFileMenu={fileMenu}
          onAbort={v.be.abort ? () => run('Aborting', () => v.be.abort!()) : undefined}
          onContinue={v.be.continueOp ? () => run('Continuing', () => v.be.continueOp!()) : undefined}
        />
      </div>
      {statusBar(v)}
      {menu && <Menu menu={menu} onClose={() => setMenu(undefined)} />}
      {palette && <Palette commands={commands} onClose={() => openPalette(false)} />}
      {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
      {dialog && (
        <Dialogs
          dialog={dialog}
          settings={settings}
          native={v.be.native}
          onClose={() => setDialog(undefined)}
          onCreateBranch={(name, at, checkout) => run('Creating branch', () => v.be.createBranch(name, at, checkout))}
          onCreateTag={(name, at, message) => run('Creating tag', () => v.be.createTag(name, at, message))}
          onRename={(old, name) => run('Renaming branch', () => v.be.renameBranch(old, name))}
          onStash={(message) => run('Stashing', () => v.be.stashSave(message))}
          onReset={(at, mode) => head && run('Resetting', () => v.be.reset(head, at, mode))}
          onSettings={(s) => {
            setSettings(s)
            saveSettings(s)
          }}
        />
      )}
      {toast && <div class="toast">{toast}</div>}
    </div>
  )
}
