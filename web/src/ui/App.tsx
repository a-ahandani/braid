import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Backend, PullMode } from '../git/backend'
import { layout, type RowLayout } from '../git/graph'
import { PAGE, type Commit, type DiffArea, type FileChange, type NetSettings, type RepoData } from '../git/repo'
import { Icon, laneColor, short } from './bits'
import { DetailPanel, type FileSel } from './DetailPanel'
import { DiffWindow, tabKey, type DiffOptions, type DiffTab } from './DiffWindow'
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

export type Theme = 'dark' | 'light'

export function loadSettings(): NetSettings {
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

const PULL_MODES: Record<PullMode, string> = { merge: 'Merge', 'ff-only': 'Fast-forward only', rebase: 'Rebase' }

export function App(p: { be: Backend; active: boolean; theme: Theme; onTheme: (t: Theme) => void; onOpenRepo: () => void; onDirty: (dirty: boolean) => void }) {
  const theme = p.theme
  const setTheme = p.onTheme
  const [view, setView] = useState<View>()
  const [sel, setSel] = useState<Sel>()
  const [diffTabs, setDiffTabs] = useState<DiffTab[]>([])
  const [activeDiff, setActiveDiff] = useState<string>()
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [diffOptions, setDiffOptionsState] = useState<DiffOptions>(() => ({ wrap: stored('ramulus.wrap') === '1', mode: stored('ramulus.diff') === 'inline' ? 'inline' : 'split', collapse: stored('ramulus.collapse') === '1' }))
  const setDiffOptions = (o: DiffOptions) => {
    setDiffOptionsState(o)
    localStorage.setItem('ramulus.wrap', o.wrap ? '1' : '0')
    localStorage.setItem('ramulus.diff', o.mode)
    localStorage.setItem('ramulus.collapse', o.collapse ? '1' : '0')
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
  const [scrollTo, setScrollTo] = useState<number>()
  const [updatedAt, setUpdatedAt] = useState<Date>()
  const [settings, setSettings] = useState<NetSettings>(loadSettings)
  const [pullMode, setPullMode] = useState<PullMode>('merge')
  const overlayRef = useRef(false)
  const filterRef = useRef<HTMLInputElement>(null)
  const openPalette = (on: boolean) => {
    overlayRef.current = on
    setPalette(on)
  }
  const viewRef = useRef(view)
  viewRef.current = view

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
      setDiffTabs([])
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

  useEffect(() => {
    openBackend(p.be)
  }, [])

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
    if (!view?.be.subscribe || !p.active) return
    let timer: ReturnType<typeof setTimeout> | undefined
    return view.be.subscribe(() => {
      clearTimeout(timer)
      timer = setTimeout(reload, 150)
    })
  }, [view?.be, reload, p.active])

  useEffect(() => {
    if (p.active) reload()
  }, [p.active])

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
    if (!view) return
    const gone = (t: DiffTab) => {
      if (t.dirty || t.sel.area.kind === 'commit') return false
      const list = t.sel.area.kind === 'staged' ? view.data.status.staged : view.data.status.unstaged
      return !list.some((f) => f.path === t.sel.path)
    }
    setDiffTabs((ts) => (ts.some(gone) ? ts.filter((t) => !gone(t)) : ts))
  }, [view])

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
    if (JSON.stringify(next) !== JSON.stringify(sel)) setSel(next)
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

  const actionsFor = (f: FileSel): ChunkAction[] => {
    const v = view
    if (!v || f.area.kind === 'commit') return []
    const list = f.area.kind === 'staged' ? v.data.status.staged : v.data.status.unstaged
    if (list.find((x) => x.path === f.path)?.kind !== 'M') return []
    if (f.area.kind === 'staged') return [{ label: 'Unstage this change', icon: 'remove', into: 'b', run: (t, base) => run('Unstaging chunk', () => v.be.writeIndex(f.path, t, base), { statusOnly: true }) }]
    return [
      { label: 'Stage this change', icon: 'add', into: 'a', run: (t, base) => run('Staging chunk', () => v.be.writeIndex(f.path, t, base), { statusOnly: true }) },
      {
        label: 'Discard this change',
        icon: 'discard',
        into: 'b',
        run: (t, base) => confirm(`This change in "${f.path}" will be reverted in the working tree. Continue?`, () => run('Discarding chunk', () => v.be.writeWorkdir(f.path, t, base), { statusOnly: true })),
      },
    ]
  }
  const saveFile = (f: FileSel, text: string, base: string, done: () => void) => {
    const v = view
    if (v) run('Saving', () => v.be.writeWorkdir(f.path, text, base), { statusOnly: true, after: done })
  }
  const activeTab = diffTabs.find((t) => t.key === activeDiff) ?? diffTabs[0]
  const fileSel = activeTab?.sel
  const openFile = (f: FileSel) => {
    const key = tabKey(f)
    setDiffTabs((ts) => (ts.some((t) => t.key === key) ? ts : [...ts, { key, sel: f, dirty: false }]))
    setActiveDiff(key)
  }
  const dropTab = (key: string) => {
    const i = diffTabs.findIndex((t) => t.key === key)
    const rest = diffTabs.filter((t) => t.key !== key)
    setDiffTabs((ts) => ts.filter((t) => t.key !== key))
    if (activeTab?.key === key) setActiveDiff(rest[Math.min(i, rest.length - 1)]?.key)
  }
  const closeTab = (key: string) => {
    const t = diffTabs.find((x) => x.key === key)
    if (t?.dirty) confirm(`Unsaved edits to "${t.sel.path}" will be lost. Continue?`, () => dropTab(key))
    else dropTab(key)
  }
  const closeAllTabs = () => {
    const dirtyCount = diffTabs.filter((t) => t.dirty).length
    if (dirtyCount) confirm(`Unsaved edits in ${dirtyCount} file${dirtyCount === 1 ? '' : 's'} will be lost. Continue?`, () => setDiffTabs([]))
    else setDiffTabs([])
  }
  const anyDirty = diffTabs.some((t) => t.dirty)
  useEffect(() => p.onDirty(anyDirty), [anyDirty])
  const setTabDirty = (key: string, d: boolean) => setDiffTabs((ts) => ts.map((t) => (t.key === key && t.dirty !== d ? { ...t, dirty: d } : t)))

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
      ...(v.be.native ? (Object.keys(PULL_MODES) as PullMode[]).map((m) => ({ id: `pullmode:${m}`, group: 'Action', label: `Pull mode: ${PULL_MODES[m]}${m === pullMode ? ' (current)' : ''}`, run: () => setPullMode(m) })) : []),
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
    list.push({ id: 'open', group: 'Action', label: 'Open repository…', run: p.onOpenRepo })
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
    if (!p.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('.diff-window')) return
      const mod = e.metaKey || e.ctrlKey
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable)
      if (mod && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        if (view) openPalette(!palette)
      } else if (mod && e.key === 'f') {
        e.preventDefault()
        filterRef.current?.focus()
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
              <Icon name="git-branch" />
              {head ?? (v.data.headOid ? 'detached HEAD' : 'no commits')}
            </span>
            {cur?.upstream ? (
              <span title={`Compared with ${cur.upstream}`}>
                <Icon name="sync" />
                {cur.behind ?? 0}
                <Icon name="arrow-small-down" />
                {cur.ahead ?? 0}
                <Icon name="arrow-small-up" />
              </span>
            ) : (
              head && <span>no upstream</span>
            )}
            {changes > 0 && (
              <span class="warn" title={`${changes} uncommitted change${changes === 1 ? '' : 's'}`}>
                <Icon name="source-control" />
                {changes}
              </span>
            )}
            {v.data.stashes.length > 0 && (
              <span title={`${v.data.stashes.length} stash${v.data.stashes.length === 1 ? '' : 'es'}`}>
                <Icon name="git-stash" />
                {v.data.stashes.length}
              </span>
            )}
          </>
        )}
        <span class="spacer" />
        {updatedAt && <span title="Last read of the repository">Updated {updatedAt.toLocaleTimeString()}</span>}
        {v && (
          <button onClick={() => openPalette(true)} title="Command palette (⌘⇧P)">
            <Icon name="list-selection" />
            Commands
          </button>
        )}
        <button onClick={() => setShortcuts(true)} title="Keyboard shortcuts (?)">
          <Icon name="keyboard" />
        </button>
        <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
          <Icon name="color-mode" />
        </button>
      </div>
    )
  }

  if (!view) {
    return (
      <div class="app">
        <div class="toolbar" />
        <div class="placeholder">{busy ? `${busy}...` : 'This repository could not be read.'}</div>
        {statusBar()}
        {shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
        {dialog && <Dialogs dialog={dialog} settings={settings} native={p.be.native} onClose={() => setDialog(undefined)} onCreateBranch={() => {}} onCreateTag={() => {}} onRename={() => {}} onStash={() => {}} onReset={() => {}} onSettings={() => {}} />}
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
        <div class="tb-side">
          <span class="repo">{v.data.name}</span>
          <span class="branch">
            <Icon name="git-branch" />
            {v.data.headBranch ?? (v.data.headOid ? `detached at ${v.data.headOid.slice(0, 7)}` : 'no commits')}
          </span>
          {busy && <span class="busy">{busy}...</span>}
        </div>
        <div class="tb-actions" role="toolbar" aria-label="Repository actions">
          <span class="split">
            <button class="tool" disabled={!!busy || !head} onClick={() => net('Pull', () => v.be.pull(pullMode, head!))} title={v.be.native ? `Pull (${PULL_MODES[pullMode]})` : 'Pull'} aria-label="Pull">
              <Icon name="arrow-circle-down" />
            </button>
            {v.be.native && (
              <button
                class="tool pull-mode"
                disabled={!!busy || !head}
                title="How pull integrates changes"
                aria-label="Pull options"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setMenu({ x: r.left - 34, y: r.bottom + 4, items: (Object.keys(PULL_MODES) as PullMode[]).map((m) => ({ label: PULL_MODES[m], checked: m === pullMode, onClick: () => setPullMode(m) })) })
                }}
              >
                <Icon name="chevron-down" />
              </button>
            )}
          </span>
          <button class="tool" disabled={!!busy || !head} onClick={() => net('Push', () => v.be.push(head!))} title="Push the checked-out branch" aria-label="Push">
            <Icon name="arrow-circle-up" />
          </button>
          <button class="tool" disabled={!!busy} onClick={() => net('Fetch', () => v.be.fetchAll())} title="Fetch every remote (⌘L)" aria-label="Fetch">
            <Icon name="cloud-download" />
          </button>
          <span class="sep" />
          <button class="tool" disabled={!!busy || !v.data.headOid} onClick={() => setDialog({ kind: 'branch', at: v.data.headOid! })} title="New branch (⌘B)" aria-label="New branch">
            <Icon name="git-branch-create" />
          </button>
          <span class="sep" />
          <button class="tool" disabled={!!busy || wipCount === 0} onClick={() => setDialog({ kind: 'stash' })} title="Stash everything" aria-label="Stash">
            <Icon name="git-stash" />
          </button>
          <button class="tool" disabled={!!busy || v.data.stashes.length === 0} onClick={() => run('Applying stash', () => v.be.stashApply(0, true))} title="Apply and drop the newest stash" aria-label="Pop stash">
            <Icon name="git-stash-pop" />
          </button>
        </div>
        <div class="tb-side tb-end">
          <span class="search">
            <Icon name="search" />
            <input ref={filterRef} placeholder="Search commits (⌘F)" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
          </span>
          {filter && <span class="busy">{order.length} results</span>}
          <button class={`icon ${showLeft ? 'on' : ''}`} onClick={() => setShowLeft(!showLeft)} title="Toggle left panel (⌘J)">
            <Icon name={showLeft ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
          </button>
          <button class={`icon ${showRight ? 'on' : ''}`} onClick={() => setShowRight(!showRight)} title="Toggle detail panel (⌘K)">
            <Icon name={showRight ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} />
          </button>
          {!v.be.native && (
            <button class="icon" onClick={() => setDialog({ kind: 'settings' })} title="Settings: author and remote access">
              <Icon name="settings-gear" />
            </button>
          )}
          <button class="icon" onClick={() => reload()} title="Refresh">
            <Icon name="refresh" />
          </button>
        </div>
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
          tree={tree}
          summary={summary}
          description={description}
          amend={amend}
          onTree={setTree}
          onSummary={setSummary}
          onDescription={setDescription}
          onAmend={setAmend}
          onSelectFile={openFile}
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
      {activeTab && (
        <DiffWindow
          tabs={diffTabs}
          active={activeTab.key}
          be={v.be}
          stamp={v}
          options={diffOptions}
          dark={theme === 'dark'}
          actionsFor={actionsFor}
          onActivate={setActiveDiff}
          onCloseTab={closeTab}
          onCloseAll={closeAllTabs}
          onOptions={setDiffOptions}
          onDirty={setTabDirty}
          onSave={saveFile}
          onOpen={v.be.openPath ? (f) => v.be.openPath!(f.path).catch((err) => fail('Could not open the file', err)) : undefined}
        />
      )}
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
