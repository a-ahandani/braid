import { useState } from 'preact/hooks'
import type { RepoData } from '../git/repo'
import { laneColor } from './bits'

export interface LeftProps {
  data: RepoData
  columnOf: (oid: string) => number | undefined
  selectedOid?: string
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
      <span class="arrow">{open ? '▾' : '▸'}</span>
      {title}
      <span class="count">{count}</span>
    </div>
  )
}

export function LeftPanel(p: LeftProps) {
  const [open, setOpen] = useState({ local: true, remote: true, tags: true, stashes: true })
  const toggle = (k: keyof typeof open) => setOpen({ ...open, [k]: !open[k] })
  const dot = (oid: string) => {
    const col = p.columnOf(oid)
    return <span class="dot" style={{ background: col === undefined ? 'var(--text-3)' : laneColor(col) }} />
  }
  const byRemote = new Map<string, typeof p.data.remote>()
  for (const b of p.data.remote) {
    const r = b.name.split('/')[0]
    byRemote.set(r, [...(byRemote.get(r) ?? []), b])
  }
  return (
    <div class="left">
      <Section title="LOCAL" count={p.data.local.length} open={open.local} onToggle={() => toggle('local')} />
      {open.local &&
        p.data.local.map((b) => (
          <div
            key={b.name}
            class={`item ${b.isHead ? 'strong' : ''} ${p.selectedOid === b.oid ? 'selected' : ''}`}
            onClick={() => p.onJump(b.oid)}
            onDblClick={() => !b.isHead && p.onCheckout(b.name)}
            onContextMenu={(e) => {
              e.preventDefault()
              p.onBranchMenu(e, b.name, b.oid, b.isHead)
            }}
          >
            {dot(b.oid)}
            <span class="name">{b.name}</span>
            {b.isHead && <span class="meta" style={{ color: 'var(--green)' }}>✓</span>}
          </div>
        ))}
      {open.local && p.data.local.length === 0 && <div class="empty">No branches yet</div>}

      <Section title="REMOTE" count={p.data.remote.length} open={open.remote} onToggle={() => toggle('remote')} />
      {open.remote &&
        [...byRemote].map(([remote, branches]) => (
          <div key={remote}>
            <div class="remote-name">{remote}</div>
            {branches.map((b) => (
              <div
                key={b.name}
                class={`item indent ${p.selectedOid === b.oid ? 'selected' : ''}`}
                onClick={() => p.onJump(b.oid)}
                onDblClick={() => p.onCheckoutRemote(b.name)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  p.onRemoteMenu(e, b.name)
                }}
              >
                {dot(b.oid)}
                <span class="name">{b.name.slice(remote.length + 1)}</span>
              </div>
            ))}
          </div>
        ))}
      {open.remote && p.data.remote.length === 0 && <div class="empty">Nothing from remotes yet. Fetch to load them.</div>}

      <Section title="TAGS" count={p.data.tags.length} open={open.tags} onToggle={() => toggle('tags')} />
      {open.tags &&
        p.data.tags.map((t) => (
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

      <Section title="STASHES" count={p.data.stashes.length} open={open.stashes} onToggle={() => toggle('stashes')} />
      {open.stashes &&
        p.data.stashes.map((s) => (
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
