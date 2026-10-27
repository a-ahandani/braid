import { get, set } from 'idb-keyval'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { FsaFs } from '../fs/fsa'
import type { Backend, PullMode } from '../git/backend'
import { demoRepo } from '../git/demo'
import { layout, type RowLayout } from '../git/graph'
import { httpBackend } from '../git/remote'
import { localBackend, PAGE, type Commit, type Ctx, type DiffArea, type DiffLine, type FileChange, type NetSettings, type RefLabel, type RepoData } from '../git/repo'
import { laneColor } from './bits'
import { DetailPanel, type FileSel } from './DetailPanel'
import { Dialogs, type Dialog } from './Dialogs'
import { GraphView } from './GraphView'
import { LeftPanel } from './LeftPanel'
import { Menu, type MenuItem, type MenuState } from './Menu'

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
const SETTINGS_KEY = 'ramify.net'
const canPick = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const helperToken = typeof location !== 'undefined' && /^#[0-9a-f]{32}$/.test(location.hash) ? location.hash.slice(1) : undefined

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

export function App() {
  const [view, setView] = useState<View>()
  const [sel, setSel] = useState<Sel>()
  const [fileSel, setFileSel] = useState<FileSel>()
  const [commitFiles, setCommitFiles] = useState<FileChange[]>([])
  const [diff, setDiff] = useState<DiffLine[]>([])
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [amend, setAmend] = useState(false)
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<Dialog>()
  const [menu, setMenu] = useState<MenuState>()
  const [busy, setBusy] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [showLeft, setShowLeft] = useState(true)
  const [showRight, setShowRight] = useState(true)
  const [scrollTo, setScrollTo] = useState<number>()
  const [recent, setRecent] = useState<FileSystemDirectoryHandle[]>([])
  const [settings, setSettings] = useState<NetSettings>(loadSettings)
  const [pullMode, setPullMode] = useState<PullMode>('merge')
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    get<FileSystemDirectoryHandle[]>('recent').then((r) => r && setRecent(r))
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(undefined), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const fail = (title: string, e: unknown) => setDialog({ kind: 'error', title, message: e instanceof Error ? e.message : String(e) })

  const applyData = useCallback((be: Backend, data: RepoData, limit: number, fresh: boolean) => {
    const v = buildView(be, data, limit)
    setView(v)
    setSel((cur) => {
      const hasWip = v.rows[0]?.kind === 'wip'
      const keep = !fresh && cur && (cur.kind === 'wip' ? hasWip : v.indexOf.has(cur.oid))
      if (keep) return cur
      return hasWip ? { kind: 'wip' } : data.headOid ? { kind: 'commit', oid: data.headOid } : undefined
    })
    if (fresh) {
      setFileSel(undefined)
      setFilter('')
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
    if (!view || !fileSel) {
      setDiff([])
      return
    }
    let live = true
    view.be
      .diffLines(fileSel.area, fileSel.path)
      .then((d) => live && setDiff(d))
      .catch(() => live && setDiff([]))
    return () => {
      live = false
    }
  }, [view, fileSel])

  useEffect(() => {
    if (!view || !fileSel) return
    const exists =
      fileSel.area.kind === 'commit'
        ? commitFiles.some((f) => f.path === fileSel.path)
        : (fileSel.area.kind === 'staged' ? view.data.status.staged : view.data.status.unstaged).some((f) => f.path === fileSel.path)
    if (!exists) setFileSel(undefined)
  }, [view, commitFiles, fileSel])

  const order = useMemo(() => {
    if (!view) return []
    const all = view.rows.map((_, i) => i)
    const q = filter.trim().toLowerCase()
    if (!q) return all
    return all.filter((i) => {
      const c = view.rows[i]
      return (
        c.summary.toLowerCase().includes(q) ||
        c.author.toLowerCase().includes(q) ||
        c.id.startsWith(q) ||
        (view.data.refsByOid.get(c.id) ?? []).some((l) => l.name.toLowerCase().includes(q))
      )
    })
  }, [view, filter])

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
    select(i)
    setScrollTo(i)
  }

  const copy = (s: string) => {
    navigator.clipboard.writeText(s).then(() => setToast('Copied!'))
  }

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

  const branchItems = (name: string, oid: string, isHead: boolean): MenuItem[] => {
    const v = view!
    const items: MenuItem[] = []
    if (!isHead) {
      items.push({ label: `Switch to ${name}`, onClick: () => run('Switching branch', () => v.be.checkoutBranch(name)) })
      if (head) items.push({ label: `Merge ${name} into ${head}`, onClick: () => mergeInto(name) })
      if (head && v.be.rebase) items.push({ label: `Rebase ${head} onto ${name}`, onClick: () => run('Rebasing', () => v.be.rebase!(name), { after: conflictToast }) })
    }
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
      ...(head && v.be.rebase ? [{ label: `Rebase ${head} onto ${name}`, onClick: () => run('Rebasing', () => v.be.rebase!(name), { after: conflictToast }) }] : []),
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
        if (v.be.rebase) items.push({ label: `Rebase ${head} here`, onClick: () => run('Rebasing', () => v.be.rebase!(c.id), { after: conflictToast }) })
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

  const pillDoubleClick = (l: RefLabel) => {
    if (!view) return
    if (l.kind === 'head' && !l.current) run('Switching branch', () => view.be.checkoutBranch(l.name))
    if (l.kind === 'remote') run('Switching branch', () => view.be.checkoutRemote(l.name))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
      if (mod && e.key === 'f') {
        e.preventDefault()
        document.getElementById('filter')?.focus()
      } else if (mod && e.key === 'b' && view?.data.headOid) {
        e.preventDefault()
        setDialog({ kind: 'branch', at: view.data.headOid })
      } else if (mod && e.key === 'Enter') {
        e.preventDefault()
        doCommit()
      } else if (mod && e.key === 'j') {
        e.preventDefault()
        setShowLeft((s) => !s)
      } else if (mod && e.key === 'k') {
        e.preventDefault()
        setShowRight((s) => !s)
      } else if (e.key === 'Escape') {
        if (dialog) setDialog(undefined)
        else if (filter) setFilter('')
      } else if (!typing && !dialog && view && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'j' || e.key === 'k')) {
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!view) {
    return (
      <div class="app">
        <div class="toolbar">
          <span class="repo">Ramify</span>
        </div>
        <div class="welcome">
          <h1>Ramify</h1>
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
                For full speed and your SSH keys, run <code>npx ramify-git</code> inside a repository instead.
              </p>
            </>
          )}
        </div>
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
  const currentColor = current ? laneColor(v.layout[v.indexOf.get(current.id)!].column) : 'var(--lane-0)'
  const wipCount = v.data.status.staged.length + v.data.status.unstaged.length
  const dirty = wipCount > 0
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
        <button disabled={!!busy} onClick={() => net('Fetch', () => v.be.fetchAll())} title="Fetch every remote">
          Fetch
        </button>
        <button disabled={!!busy || !v.data.headOid} onClick={() => setDialog({ kind: 'branch', at: v.data.headOid! })} title="New branch (⌘B)">
          Branch
        </button>
        <button disabled={!!busy || !dirty} onClick={() => setDialog({ kind: 'stash' })} title="Stash everything">
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
      <div class={`body ${showLeft ? '' : 'no-left'} ${showRight ? '' : 'no-right'}`}>
        <LeftPanel
          data={v.data}
          columnOf={(oid) => {
            const i = v.indexOf.get(oid)
            return i === undefined ? undefined : v.layout[i].column
          }}
          selectedOid={sel?.kind === 'commit' ? sel.oid : undefined}
          onJump={jump}
          onCheckout={(name) => run('Switching branch', () => v.be.checkoutBranch(name))}
          onCheckoutRemote={(name) => run('Switching branch', () => v.be.checkoutRemote(name))}
          onBranchMenu={(e, name, oid, isHead) => setMenu({ x: e.clientX, y: e.clientY, items: branchItems(name, oid, isHead) })}
          onRemoteMenu={(e, name) => setMenu({ x: e.clientX, y: e.clientY, items: remoteItems(name) })}
          onTagMenu={(e, name, oid) => setMenu({ x: e.clientX, y: e.clientY, items: tagItems(name, oid) })}
          onStashMenu={(e, index, message) => setMenu({ x: e.clientX, y: e.clientY, items: stashItems(index, message) })}
        />
        <GraphView
          rows={v.rows}
          layout={v.layout}
          maxCol={v.maxCol}
          refsByOid={v.data.refsByOid}
          order={order}
          filtered={filter.trim().length > 0}
          selectedIndex={selectedIndex}
          scrollTo={scrollTo}
          wipCount={wipCount}
          hasMore={v.data.hasMore}
          onSelect={select}
          onContextMenu={rowMenu}
          onPillDoubleClick={pillDoubleClick}
          onLoadMore={() => run('Loading more', async () => applyData(v.be, await v.be.load(v.limit + PAGE), v.limit + PAGE, false))}
          onScrolled={() => setScrollTo(undefined)}
        />
        <DetailPanel
          data={v.data}
          commit={current}
          commitColor={currentColor}
          commitFiles={commitFiles}
          isStash={!!current && v.data.stashes.some((s) => s.oid === current.id)}
          selectedFile={fileSel}
          diff={diff}
          summary={summary}
          description={description}
          amend={amend}
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
      {menu && <Menu menu={menu} onClose={() => setMenu(undefined)} />}
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
