import { get, set } from 'idb-keyval'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { FsaFs } from '../fs/fsa'
import { demoRepo } from '../git/demo'
import { layout, type RowLayout } from '../git/graph'
import * as repo from '../git/repo'
import type { Commit, Ctx, DiffArea, DiffLine, FileChange, NetSettings, RefLabel, RepoData } from '../git/repo'
import { laneColor } from './bits'
import { DetailPanel, type FileSel } from './DetailPanel'
import { Dialogs, type Dialog } from './Dialogs'
import { GraphView } from './GraphView'
import { LeftPanel } from './LeftPanel'
import { Menu, type MenuItem, type MenuState } from './Menu'

interface View {
  ctx: Ctx
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

function buildView(ctx: Ctx, data: RepoData, limit: number): View {
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
  return { ctx, data, rows, layout: l.rows, maxCol: l.maxCol, indexOf, limit }
}

function loadSettings(): NetSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* no settings yet */
  }
  return { corsProxy: 'https://cors.isomorphic-git.org', username: '', token: '' }
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

  useEffect(() => {
    get<FileSystemDirectoryHandle[]>('recent').then((r) => r && setRecent(r))
  }, [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(undefined), 4000)
    return () => clearTimeout(t)
  }, [toast])

  const fail = (title: string, e: unknown) => setDialog({ kind: 'error', title, message: e instanceof Error ? e.message : String(e) })

  const applyData = useCallback((ctx: Ctx, data: RepoData, limit: number, fresh: boolean) => {
    const v = buildView(ctx, data, limit)
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

  const openCtx = async (ctx: Ctx) => {
    setBusy('Reading repository')
    try {
      applyData(ctx, await repo.load(ctx), repo.PAGE, true)
    } catch (e) {
      fail('This folder is not a git repository', e)
    } finally {
      setBusy(undefined)
    }
  }

  const openHandle = async (handle: FileSystemDirectoryHandle) => {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return
    const fs = new FsaFs(handle)
    const list = [handle, ...recent.filter((h) => h.name !== handle.name)].slice(0, 10)
    setRecent(list)
    await set('recent', list)
    await openCtx({ fs, dir: '/', cache: {}, removeTree: (p) => fs.removeTree(p) })
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
    if (!view) return
    try {
      applyData(view.ctx, await repo.load(view.ctx, view.limit), view.limit, false)
    } catch (e) {
      fail('Could not read the repository', e)
    }
  }, [view, applyData])

  const run = async (label: string, fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    if (!view || busy) return
    setBusy(label)
    try {
      const r = await fn()
      after?.(r)
    } catch (e) {
      fail('Git could not do that', e)
    } finally {
      setBusy(undefined)
    }
    await reload()
  }

  useEffect(() => {
    if (!view) return
    if (sel?.kind === 'commit') {
      repo.commitFiles(view.ctx, sel.oid).then(setCommitFiles).catch(() => setCommitFiles([]))
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
    repo
      .diffLines(view.ctx, fileSel.area, fileSel.path)
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

  const doCommit = () => {
    if (!view || !summary.trim()) return
    const msg = description.trim() ? `${summary.trim()}\n\n${description.trim()}` : summary.trim()
    run('Committing', () => repo.commit(view.ctx, msg, amend), () => {
      setSummary('')
      setDescription('')
      setAmend(false)
    })
  }

  const branchItems = (name: string, oid: string, isHead: boolean): MenuItem[] => {
    const v = view!
    const items: MenuItem[] = []
    if (!isHead) {
      items.push({ label: `Switch to ${name}`, onClick: () => run('Switching branch', () => repo.checkoutBranch(v.ctx, name)) })
      if (head) items.push({ label: `Merge ${name} into ${head}`, onClick: () => run('Merging', () => repo.merge(v.ctx, name, head), (r) => r === 'up-to-date' && setToast(`Already up to date with ${name}`)) })
    }
    items.push({ label: `Rename ${name}`, onClick: () => setDialog({ kind: 'rename', old: name }) })
    items.push({ label: 'New branch from here', onClick: () => setDialog({ kind: 'branch', at: oid }) })
    items.push({ label: 'Copy name', onClick: () => copy(name) })
    if (!isHead) {
      items.push({ sep: true })
      items.push({ label: `Delete ${name}`, danger: true, onClick: () => confirm(`Delete "${name}"? This cannot be undone.`, () => run('Deleting branch', () => repo.deleteBranch(v.ctx, name))) })
    }
    return items
  }

  const stashItems = (index: number, message: string): MenuItem[] => {
    const v = view!
    return [
      { label: 'Apply (keep stash)', onClick: () => run('Applying stash', () => repo.stashApply(v.ctx, index, false)) },
      { label: 'Apply and drop', onClick: () => run('Applying stash', () => repo.stashApply(v.ctx, index, true)) },
      { sep: true },
      { label: 'Drop stash', danger: true, onClick: () => confirm(`Drop the stash "${message}"? This cannot be undone.`, () => run('Dropping stash', () => repo.stashDrop(v.ctx, index))) },
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
        { label: 'Stage everything', onClick: () => run('Staging', () => repo.stage(v.ctx, v.data.status.unstaged)) },
        { sep: true },
        {
          label: 'Throw away all changes',
          danger: true,
          onClick: () =>
            confirm('Every staged, unstaged and untracked change in the working tree will be lost. Continue?', () =>
              run('Discarding', async () => {
                await repo.unstage(v.ctx, v.data.status.staged.map((f) => f.path))
                const st = await repo.status(v.ctx)
                await repo.discard(v.ctx, st.unstaged)
              }),
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
        if (l.kind === 'head' && !l.current) items.push({ label: `Switch to ${l.name}`, onClick: () => run('Switching branch', () => repo.checkoutBranch(v.ctx, l.name)) })
        if (l.kind === 'remote') items.push({ label: `Switch to ${l.name}`, onClick: () => run('Switching branch', () => repo.checkoutRemote(v.ctx, l.name)) })
      }
      if (!isHead) items.push({ label: 'Check out here (no branch)', onClick: () => run('Checking out', () => repo.checkoutCommit(v.ctx, c.id)) })
      items.push({ label: 'New branch from here', onClick: () => setDialog({ kind: 'branch', at: c.id }) })
      items.push({ label: 'New tag here', onClick: () => setDialog({ kind: 'tag', at: c.id }) })
      items.push({ sep: true })
      if (head) {
        for (const l of refs) {
          if ((l.kind === 'head' && !l.current) || l.kind === 'remote') {
            items.push({ label: `Merge ${l.name} into ${head}`, onClick: () => run('Merging', () => repo.merge(v.ctx, l.name, head), (r) => r === 'up-to-date' && setToast(`Already up to date with ${l.name}`)) })
          }
        }
        if (!isHead) items.push({ label: `Reset ${head} to this commit...`, onClick: () => setDialog({ kind: 'reset', at: c.id }) })
      }
      items.push({ sep: true })
      for (const l of refs) {
        if (l.kind === 'head' && !l.current) {
          items.push({ label: `Rename ${l.name}`, onClick: () => setDialog({ kind: 'rename', old: l.name }) })
          items.push({ label: `Delete ${l.name}`, danger: true, onClick: () => confirm(`Delete "${l.name}"? This cannot be undone.`, () => run('Deleting branch', () => repo.deleteBranch(v.ctx, l.name))) })
        }
        if (l.kind === 'tag') items.push({ label: `Delete tag ${l.name}`, danger: true, onClick: () => confirm(`Delete "${l.name}"? This cannot be undone.`, () => run('Deleting tag', () => repo.deleteTag(v.ctx, l.name))) })
      }
      items.push({ label: 'Copy full hash', onClick: () => copy(c.id) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const fileMenu = (e: MouseEvent, f: FileChange, area: DiffArea) => {
    const v = view!
    const items: MenuItem[] = []
    if (area.kind === 'unstaged') items.push({ label: 'Stage', onClick: () => run('Staging', () => repo.stage(v.ctx, [f])) })
    if (area.kind === 'staged') items.push({ label: 'Unstage', onClick: () => run('Unstaging', () => repo.unstage(v.ctx, [f.path])) })
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
    confirm(what, () => run('Discarding', () => repo.discard(v.ctx, files)))
  }

  const pillDoubleClick = (l: RefLabel) => {
    if (!view) return
    if (l.kind === 'head' && !l.current) run('Switching branch', () => repo.checkoutBranch(view.ctx, l.name))
    if (l.kind === 'remote') run('Switching branch', () => repo.checkoutRemote(view.ctx, l.name))
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
          <p>Every branch of your repository, in one graph. Runs entirely in this browser tab.</p>
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
          <p class="note">Nothing leaves your machine except avatar lookups on gravatar.com and, when you use them, fetch, pull and push through the CORS proxy set in Remote access.</p>
          {busy && <p class="busy">{busy}...</p>}
        </div>
        {dialog && <Dialogs dialog={dialog} settings={settings} onClose={() => setDialog(undefined)} onCreateBranch={() => {}} onCreateTag={() => {}} onRename={() => {}} onStash={() => {}} onReset={() => {}} onSettings={setSettings} />}
      </div>
    )
  }

  const v = view
  const current = sel?.kind === 'commit' ? v.rows[v.indexOf.get(sel.oid) ?? -1] : undefined
  const currentColor = current ? laneColor(v.layout[v.indexOf.get(current.id)!].column) : 'var(--lane-0)'
  const wipCount = v.data.status.staged.length + v.data.status.unstaged.length
  const dirty = wipCount > 0
  const net = (label: string, fn: () => Promise<unknown>) => run(label, fn, () => setToast(`${label} done`))

  return (
    <div class="app">
      <div class="toolbar">
        <span class="repo">{v.data.name}</span>
        <span style={{ color: 'var(--text-3)' }}>/</span>
        <span class="branch">{v.data.headBranch ?? (v.data.headOid ? `detached at ${v.data.headOid.slice(0, 7)}` : 'no commits')}</span>
        <button disabled={!!busy || !head} onClick={() => net('Pull', () => repo.pull(v.ctx, settings, head!))} title="Fetch and merge the upstream branch">
          Pull
        </button>
        <button disabled={!!busy || !head} onClick={() => net('Push', () => repo.push(v.ctx, settings, head!))} title="Push the checked-out branch">
          Push
        </button>
        <button disabled={!!busy} onClick={() => net('Fetch', () => repo.fetchAll(v.ctx, settings))} title="Fetch every remote">
          Fetch
        </button>
        <button disabled={!!busy || !v.data.headOid} onClick={() => setDialog({ kind: 'branch', at: v.data.headOid! })} title="New branch (⌘B)">
          Branch
        </button>
        <button disabled={!!busy || !dirty} onClick={() => setDialog({ kind: 'stash' })} title="Stash everything">
          Stash
        </button>
        <button disabled={!!busy || v.data.stashes.length === 0} onClick={() => run('Applying stash', () => repo.stashApply(v.ctx, 0, true))} title="Apply and drop the newest stash">
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
        <button onClick={() => setDialog({ kind: 'settings' })} title="Remote access settings">
          ⚙
        </button>
        <button onClick={() => reload()} title="Refresh">
          ↻
        </button>
        {canPick && <button onClick={pickFolder}>Open</button>}
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
          onCheckout={(name) => run('Switching branch', () => repo.checkoutBranch(v.ctx, name))}
          onCheckoutRemote={(name) => run('Switching branch', () => repo.checkoutRemote(v.ctx, name))}
          onBranchMenu={(e, name, oid, isHead) => setMenu({ x: e.clientX, y: e.clientY, items: branchItems(name, oid, isHead) })}
          onRemoteMenu={(e, name) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: `Switch to ${name}`, onClick: () => run('Switching branch', () => repo.checkoutRemote(v.ctx, name)) },
                ...(head ? [{ label: `Merge ${name} into ${head}`, onClick: () => run('Merging', () => repo.merge(v.ctx, name, head)) }] : []),
                { label: 'Copy name', onClick: () => copy(name) },
              ],
            })
          }
          onTagMenu={(e, name, oid) =>
            setMenu({
              x: e.clientX,
              y: e.clientY,
              items: [
                { label: `Check out ${name} (no branch)`, onClick: () => run('Checking out', () => repo.checkoutCommit(v.ctx, oid)) },
                { label: 'Copy name', onClick: () => copy(name) },
                { sep: true },
                { label: `Delete tag ${name}`, danger: true, onClick: () => confirm(`Delete "${name}"? This cannot be undone.`, () => run('Deleting tag', () => repo.deleteTag(v.ctx, name))) },
              ],
            })
          }
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
          onLoadMore={() => run('Loading more', async () => applyData(v.ctx, await repo.load(v.ctx, v.limit + repo.PAGE), v.limit + repo.PAGE, false))}
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
          onStage={(files) => run('Staging', () => repo.stage(v.ctx, files))}
          onUnstage={(paths) => run('Unstaging', () => repo.unstage(v.ctx, paths))}
          onDiscard={discardFiles}
          onStageAll={() => run('Staging', () => repo.stage(v.ctx, v.data.status.unstaged))}
          onUnstageAll={() => run('Unstaging', () => repo.unstage(v.ctx, v.data.status.staged.map((f) => f.path)))}
          onCommit={doCommit}
          onCopy={copy}
          onJump={jump}
          onFileMenu={fileMenu}
        />
      </div>
      {menu && <Menu menu={menu} onClose={() => setMenu(undefined)} />}
      {dialog && (
        <Dialogs
          dialog={dialog}
          settings={settings}
          onClose={() => setDialog(undefined)}
          onCreateBranch={(name, at, checkout) => run('Creating branch', () => repo.createBranch(v.ctx, name, at, checkout))}
          onCreateTag={(name, at, message) => run('Creating tag', () => repo.createTag(v.ctx, name, at, message))}
          onRename={(old, name) => run('Renaming branch', () => repo.renameBranch(v.ctx, old, name))}
          onStash={(message) => run('Stashing', () => repo.stashSave(v.ctx, message))}
          onReset={(at, hard) => head && run('Resetting', () => repo.reset(v.ctx, head, at, hard))}
          onSettings={(s) => {
            setSettings(s)
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
          }}
        />
      )}
      {toast && <div class="toast">{toast}</div>}
    </div>
  )
}
