import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { Icon } from './bits'
import { fuzzyScore } from './Palette'

export interface RepoSummary {
  branch: string
  changes: number
  ahead: number
  behind: number
  busy: boolean
}

export interface SideTab {
  id: number
  name: string
  title: string
  pinned: boolean
  dirty: boolean
  summary?: RepoSummary
}

export interface SideRecent {
  key: string
  name: string
  title: string
  open: () => void
}

type Row = { kind: 'tab'; tab: SideTab } | { kind: 'recent'; recent: SideRecent }

function highlight(text: string, q: string): JSX.Element | string {
  const at = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

const folderOf = (title: string) => title.replace(/[/\\][^/\\]*$/, '').replace(/^.*[/\\]/, '')

export function Sidebar(p: {
  tabs: SideTab[]
  active?: number
  recent: SideRecent[]
  docked: boolean
  shown: boolean
  focusSearch: number
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onPin: (id: number) => void
  onOpen: () => void
  onMore: (at: DOMRect) => void
  onDock: () => void
  running?: string
  status?: string
  onEnter: () => void
  onLeave: () => void
}) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const q = query.trim()

  useEffect(() => {
    if (!p.focusSearch) return
    input.current?.focus()
    input.current?.select()
  }, [p.focusSearch])

  const rank = (name: string, title: string) => {
    if (!q) return 1
    const x = q.toLowerCase()
    const n = name.toLowerCase()
    if (n.startsWith(x)) return 4
    if (n.includes(x)) return 3
    if (title.toLowerCase().includes(x)) return 2
    return fuzzyScore(x, n) > 0 ? 1 : 0
  }
  const ranked = <T extends { name: string; title: string }>(items: T[]) =>
    items
      .map((item) => ({ item, r: rank(item.name, item.title) }))
      .filter((x) => x.r > 0)
      .sort((a, b) => b.r - a.r)
      .map((x) => x.item)
  const pinned = ranked(p.tabs.filter((t) => t.pinned))
  const open = ranked(p.tabs.filter((t) => !t.pinned))
  const recent = q ? ranked(p.recent) : []
  const rows: Row[] = [...pinned, ...open].map((tab) => ({ kind: 'tab', tab }) as Row).concat(recent.map((r) => ({ kind: 'recent', recent: r })))

  const pick = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === 'tab') p.onActivate(row.tab.id)
    else row.recent.open()
    setQuery('')
    const el = document.activeElement as HTMLElement | null
    if (el === input.current || !p.docked) el?.blur()
  }

  const step = (e: KeyboardEvent) => {
    const mains = [...(list.current?.querySelectorAll<HTMLElement>('.sb-main') ?? [])]
    const i = mains.findIndex((m) => m.parentElement?.contains(document.activeElement))
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = i + (e.key === 'ArrowDown' ? 1 : -1)
      if (next < 0) input.current?.focus()
      else mains[Math.min(next, mains.length - 1)]?.focus()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      input.current?.focus()
    }
  }

  const shared = new Set(p.tabs.filter((t, i) => p.tabs.findIndex((x) => x.name === t.name) !== i).map((t) => t.name))
  const tabRow = (t: SideTab, index: number) => (
    <div
      key={t.id}
      class={`sb-item ${t.id === p.active ? 'active' : ''} ${q && index === 0 ? 'cursor' : ''} ${t.dirty ? 'dirty' : ''}`}
      title={t.title}
      onMouseDown={(e) => {
        if (e.button !== 1) return
        e.preventDefault()
        p.onClose(t.id)
      }}
    >
      <button class="sb-main" aria-current={t.id === p.active ? 'true' : undefined} onClick={() => pick({ kind: 'tab', tab: t })}>
        <span class="text">
          <span class="name">
            {highlight(t.name, q)}
            <span class="dot" title="Unsaved edits">
              <Icon name="circle-filled" />
            </span>
          </span>
          <span class="where">
            {t.summary?.branch && (
              <>
                <Icon name="git-branch" />
                {t.summary.branch}
              </>
            )}
            {shared.has(t.name) && ` · ${folderOf(t.title)}`}
          </span>
        </span>
        {t.summary && (
          <span class="sb-state">
            {t.summary.busy && <Icon name="sync" />}
            {t.summary.changes > 0 && (
              <span class="changes" title={`${t.summary.changes} uncommitted ${t.summary.changes === 1 ? 'change' : 'changes'}`}>
                {t.summary.changes}
              </span>
            )}
            {t.summary.ahead > 0 && <span title={`${t.summary.ahead} to push`}>↑{t.summary.ahead}</span>}
            {t.summary.behind > 0 && <span title={`${t.summary.behind} to pull`}>↓{t.summary.behind}</span>}
          </span>
        )}
      </button>
      <span class="acts">
        <button class="icon" title={t.pinned ? 'Unpin' : 'Pin to the top'} aria-label={t.pinned ? `Unpin ${t.name}` : `Pin ${t.name}`} onClick={() => p.onPin(t.id)}>
          <Icon name={t.pinned ? 'pinned' : 'pin'} />
        </button>
        <button class="icon" title="Close" aria-label={`Close ${t.name}`} onClick={() => p.onClose(t.id)}>
          <Icon name="close" />
        </button>
      </span>
    </div>
  )

  return (
    <aside
      class={`sidebar ${p.docked ? 'docked' : 'floating'} ${p.shown ? 'shown' : ''}`}
      aria-label="Repositories"
      onMouseEnter={p.onEnter}
      onMouseLeave={p.onLeave}
      onFocusOut={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.onLeave()
      }}
    >
      <div class="sb-head">
        <span class="title">Repositories</span>
        <button class="icon" title="Open a repository" aria-label="Open a repository" onClick={p.onOpen}>
          <Icon name="add" />
        </button>
        {p.tabs.length > 0 && (
          <button class="icon" disabled={!!p.running} title="Fetch or pull every repository" aria-label="Fetch or pull every repository" onClick={(e) => p.onMore((e.currentTarget as HTMLElement).getBoundingClientRect())}>
            <Icon name="ellipsis" />
          </button>
        )}
        <button class={`icon ${p.docked ? 'on' : ''}`} title={p.docked ? 'Unpin: slide in from the left edge when needed' : 'Pin the sidebar open'} aria-label={p.docked ? 'Unpin the sidebar' : 'Pin the sidebar open'} aria-pressed={p.docked} onClick={p.onDock}>
          <Icon name={p.docked ? 'pinned' : 'pin'} />
        </button>
      </div>
      {(p.running || p.status) && (
        <div class="sb-status" role="status">
          {p.running && <Icon name="sync" />}
          {p.running ?? p.status}
        </div>
      )}
      <div class="sb-search">
        <Icon name="search" />
        <input
          ref={input}
          placeholder="Search repositories (⌘⇧A)"
          value={query}
          aria-label="Search repositories"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              list.current?.querySelector<HTMLElement>('.sb-main')?.focus()
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (q) pick(rows[0])
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              if (query) setQuery('')
              else input.current?.blur()
            }
          }}
        />
      </div>
      <div class="sb-list" ref={list} onKeyDown={step}>
        {pinned.length > 0 && <div class="sb-section">Pinned</div>}
        {pinned.map((t, i) => tabRow(t, i))}
        {pinned.length > 0 && open.length > 0 && <div class="sb-section">Open</div>}
        {open.map((t, i) => tabRow(t, pinned.length + i))}
        {recent.length > 0 && <div class="sb-section">Recent</div>}
        {recent.map((r, i) => (
          <div key={r.key} class={`sb-item recent ${pinned.length + open.length + i === 0 ? 'cursor' : ''}`} title={r.title}>
            <button class="sb-main" onClick={() => pick({ kind: 'recent', recent: r })}>
              <Icon name="history" />
              <span class="text">
                <span class="name">{highlight(r.name, q)}</span>
                <span class="where">{folderOf(r.title)}</span>
              </span>
            </button>
          </div>
        ))}
        {q && rows.length === 0 && <div class="sb-empty">No repository matches “{q}”</div>}
        {!q && p.tabs.length === 0 && (
          <button class="sb-empty open" onClick={p.onOpen}>
            <Icon name="add" />
            Open a repository
          </button>
        )}
      </div>
    </aside>
  )
}
