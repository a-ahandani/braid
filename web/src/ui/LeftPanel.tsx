import { useState } from 'preact/hooks'
import type { RepoData } from '../git/repo'
import { Icon, laneColor } from './bits'

export interface LeftProps {
  data: RepoData
  columnOf: (oid: string) => number | undefined
  selectedOid?: string
  solo: Set<string>
  onToggleSolo: (refName: string) => void
  onJump: (oid: string) => void
  onCheckout: (name: string) => void
  onCheckoutRemote: (name: string) => void
  onBranchMenu: (e: MouseEvent, name: string, oid: string, isHead: boolean) => void
  onRemoteMenu: (e: MouseEvent, name: string) => void
  onTagMenu: (e: MouseEvent, name: string, oid: string) => void
  onStashMenu: (e: MouseEvent, index: number, message: string) => void
}

function Section({ title, count, open, onToggle }: { title: string; count: number; open: boolean; onToggle: () => void }) {
  return (
    <div class="section" onClick={onToggle}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} />
      {title}
      <span class="count">{count}</span>
    </div>
  )
}

export function LeftPanel(p: LeftProps) {
  const [open, setOpen] = useState({ local: true, remote: true, tags: true, stashes: true })
  const [filter, setFilter] = useState('')
  const toggle = (k: keyof typeof open) => setOpen({ ...open, [k]: !open[k] })
  const q = filter.trim().toLowerCase()
  const show = (name: string) => !q || name.toLowerCase().includes(q)
  const dot = (oid: string) => {
    const col = p.columnOf(oid)
    return <span class="dot" style={{ background: col === undefined ? 'var(--text-3)' : laneColor(col) }} />
  }
  const soloBtn = (name: string) => (
    <button
      class={`solo ${p.solo.has(name) ? 'on' : ''}`}
      title={p.solo.has(name) ? 'Stop soloing' : 'Solo: show only this branch in the graph'}
      onClick={(e) => {
        e.stopPropagation()
        p.onToggleSolo(name)
      }}
    >
      <Icon name="eye" />
    </button>
  )
  const byRemote = new Map<string, typeof p.data.remote>()
  for (const b of p.data.remote) {
    if (!show(b.name)) continue
    const r = b.name.split('/')[0]
    byRemote.set(r, [...(byRemote.get(r) ?? []), b])
  }
  const local = p.data.local.filter((b) => show(b.name))
  const tags = p.data.tags.filter((t) => show(t.name))
  const stashes = p.data.stashes.filter((s) => show(s.message))
  return (
    <div class="left">
      <div class="left-filter">
        <input placeholder="Filter branches and tags" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      </div>
      <Section title="LOCAL" count={local.length} open={open.local} onToggle={() => toggle('local')} />
      {open.local &&
        local.map((b) => (
          <div
            key={b.name}
            class={`item ${b.isHead ? 'strong' : ''} ${p.selectedOid === b.oid ? 'selected' : ''} ${p.solo.has(b.name) ? 'soloed' : ''}`}
            onClick={() => p.onJump(b.oid)}
            onDblClick={() => !b.isHead && p.onCheckout(b.name)}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onBranchMenu(e, b.name, b.oid, b.isHead)
            }}
            title={b.upstream ? `Upstream: ${b.upstream}${b.gone ? ' (gone)' : ''}` : 'No upstream'}
          >
            {dot(b.oid)}
            <span class="name">{b.name}</span>
            {soloBtn(b.name)}
            {!!(b.ahead || b.behind) && (
              <span class="meta">
                {b.ahead ? <><Icon name="arrow-small-up" />{b.ahead}</> : null}
                {b.behind ? <><Icon name="arrow-small-down" />{b.behind}</> : null}
              </span>
            )}
            {b.gone && <span class="meta">gone</span>}
            {b.isHead && <span class="meta" style={{ color: 'var(--green)' }}><Icon name="check" /></span>}
          </div>
        ))}
      {open.local && local.length === 0 && <div class="empty">{q ? 'No matching branches' : 'No branches yet'}</div>}

      <Section title="REMOTE" count={p.data.remote.length} open={open.remote} onToggle={() => toggle('remote')} />
      {open.remote &&
        [...byRemote].map(([remote, branches]) => (
          <div key={remote}>
            <div class="remote-name">{remote}</div>
            {branches.map((b) => (
              <div
                key={b.name}
                class={`item indent ${p.selectedOid === b.oid ? 'selected' : ''} ${p.solo.has(b.name) ? 'soloed' : ''}`}
                onClick={() => p.onJump(b.oid)}
                onDblClick={() => p.onCheckoutRemote(b.name)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  p.onRemoteMenu(e, b.name)
                }}
              >
                {dot(b.oid)}
                <span class="name">{b.name.slice(remote.length + 1)}</span>
                {soloBtn(b.name)}
              </div>
            ))}
          </div>
        ))}
      {open.remote && p.data.remote.length === 0 && <div class="empty">Nothing from remotes yet. Fetch to load them.</div>}

      <Section title="TAGS" count={tags.length} open={open.tags} onToggle={() => toggle('tags')} />
      {open.tags &&
        tags.map((t) => (
          <div
            key={t.name}
            class={`item ${p.selectedOid === t.oid ? 'selected' : ''}`}
            onClick={() => p.onJump(t.oid)}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onTagMenu(e, t.name, t.oid)
            }}
          >
            {dot(t.oid)}
            <span class="name">{t.name}</span>
          </div>
        ))}

      <Section title="STASHES" count={stashes.length} open={open.stashes} onToggle={() => toggle('stashes')} />
      {open.stashes &&
        stashes.map((s) => (
          <div
            key={s.oid}
            class={`item ${p.selectedOid === s.oid ? 'selected' : ''}`}
            title={s.message}
            onClick={() => p.onJump(s.oid)}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onStashMenu(e, s.index, s.message)
            }}
          >
            {dot(s.oid)}
            <span class="name">{s.message}</span>
          </div>
        ))}
    </div>
  )
}
