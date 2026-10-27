import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { RowLayout } from '../git/graph'
import type { Commit, RefLabel } from '../git/repo'
import { Avatar, fmtDate, laneColor, short } from './bits'

export const ROW_H = 26
const COL_W = 20
const GUTTER = 22
const NODE_R = 9.5
const MERGE_R = 5.5

export interface GraphProps {
  rows: Commit[]
  layout: RowLayout[]
  maxCol: number
  refsByOid: Map<string, RefLabel[]>
  order: number[]
  filtered: boolean
  selectedIndex: number
  scrollTo?: number
  wipCount: number
  hasMore: boolean
  onSelect: (index: number) => void
  onContextMenu: (e: MouseEvent, index: number) => void
  onPillDoubleClick: (label: RefLabel) => void
  onLoadMore: () => void
  onScrolled: () => void
}

function laneX(col: number): number {
  return 3 + GUTTER + col * COL_W + COL_W / 2
}

function Lanes({ lay, kind, author, email, drawEdges }: { lay: RowLayout; kind: Commit['kind']; author: string; email: string; drawEdges: boolean }) {
  const w = 3 + GUTTER + (Math.max(...lay.edges.keys(), lay.column) + 1) * COL_W + 6
  const mid = ROW_H / 2
  const nx = laneX(lay.column)
  const color = laneColor(lay.column)
  const shapes: JSX.Element[] = []
  if (drawEdges) {
    for (const [col, e] of lay.edges) {
      const x = laneX(col)
      const c = laneColor(col)
      const dash = (k: Commit['kind']) => (k === 'wip' ? '4 3' : undefined)
      if (e.pass) shapes.push(<line x1={x} y1={0} x2={x} y2={ROW_H} stroke={c} stroke-width={2} stroke-dasharray={dash(e.pass.kind)} />)
      if (e.ending) {
        if (col === lay.column) shapes.push(<line x1={x} y1={0} x2={x} y2={mid} stroke={c} stroke-width={2} stroke-dasharray={dash(e.ending.kind)} />)
        else shapes.push(<path d={`M${x} 0 C${x} ${mid} ${x} ${mid} ${nx} ${mid}`} fill="none" stroke={c} stroke-width={2} />)
      }
      if (e.starting) {
        if (col === lay.column) shapes.push(<line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={c} stroke-width={2} />)
        else shapes.push(<path d={`M${nx} ${mid} C${x} ${mid} ${x} ${mid} ${x} ${ROW_H}`} fill="none" stroke={c} stroke-width={2} />)
      }
    }
  } else {
    shapes.push(<line x1={nx} y1={0} x2={nx} y2={ROW_H} stroke={color} stroke-width={2} opacity={0.3} />)
  }
  let node: JSX.Element
  if (kind === 'merge') node = <circle cx={nx} cy={mid} r={MERGE_R} fill={color} />
  else if (kind === 'stash')
    node = (
      <g>
        <rect x={nx - 7} y={mid - 7} width={14} height={14} rx={2} fill="var(--app-bg)" stroke={color} stroke-width={2} />
        <text x={nx} y={mid + 4} text-anchor="middle" font-size={11} fill={color}>
          ≡
        </text>
      </g>
    )
  else if (kind === 'wip')
    node = (
      <g>
        <circle cx={nx} cy={mid} r={NODE_R} fill="var(--app-bg)" stroke={color} stroke-width={2} stroke-dasharray="3 2.5" />
        <circle cx={nx} cy={mid} r={3} fill={color} />
      </g>
    )
  else node = <circle cx={nx} cy={mid} r={NODE_R} fill="var(--app-bg)" stroke={color} stroke-width={2} />
  return (
    <div class="lanes" style={{ position: 'relative' }}>
      <svg width={w} height={ROW_H}>
        {shapes}
        {node}
      </svg>
      {kind === 'commit' && (
        <span style={{ position: 'absolute', left: `${nx - 7.5}px`, top: `${mid - 7.5}px` }}>
          <Avatar name={author} email={email} color={color} size={15} />
        </span>
      )}
    </div>
  )
}

export function Pill({ label, color, onDoubleClick }: { label: RefLabel; color: string; onDoubleClick?: () => void }) {
  const bg = label.current ? `color-mix(in srgb, ${color} 45%, transparent)` : `color-mix(in srgb, ${color} 25%, transparent)`
  const title =
    label.kind === 'head' ? (label.current ? `${label.name} (checked out)` : `Branch ${label.name}. Double-click to switch.`) : label.kind === 'remote' ? `Remote branch ${label.name}` : `Tag ${label.name}`
  return (
    <span class={`pill ${label.current ? 'current' : ''}`} style={{ background: bg, outline: label.current ? `1px solid ${color}` : undefined }} title={title} onDblClick={onDoubleClick}>
      <span class={`ic ${label.kind}`} style={{ background: color, color }} />
      {label.name}
    </span>
  )
}

export function GraphView(p: GraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    if (p.scrollTo === undefined || !box.current) return
    const pos = p.filtered ? p.order.indexOf(p.scrollTo) : p.scrollTo
    if (pos >= 0) box.current.scrollTop = Math.max(0, pos * ROW_H - height / 2 + ROW_H / 2)
    p.onScrolled()
  }, [p.scrollTo])
  const count = p.order.length + (p.hasMore && !p.filtered ? 1 : 0)
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5)
  const end = Math.min(count, Math.ceil((scrollTop + height) / ROW_H) + 5)
  const graphW = Math.min(420, Math.max(56, 3 + GUTTER + (p.maxCol + 1) * COL_W + 6))
  const cols = `minmax(150px, 22%) ${graphW}px 1fr 40px 150px 72px`
  const items: JSX.Element[] = []
  for (let i = start; i < end; i++) {
    const top = i * ROW_H
    if (i >= p.order.length) {
      items.push(
        <div class="more" style={{ top: `${top}px` }} key="more">
          Showing {p.rows.length} commits.<a onClick={p.onLoadMore}>Load more</a>
        </div>,
      )
      continue
    }
    const idx = p.order[i]
    const c = p.rows[idx]
    const lay = p.layout[idx]
    const color = laneColor(lay.column)
    const refs = c.kind === 'wip' ? [] : (p.refsByOid.get(c.id) ?? [])
    const sorted = [...refs].sort((a, b) => rank(a) - rank(b))
    items.push(
      <div
        key={c.id}
        class={`row ${idx === p.selectedIndex ? 'selected' : ''}`}
        style={{ top: `${top}px`, '--cols': cols }}
        onClick={() => p.onSelect(idx)}
        onContextMenu={(e) => {
          e.preventDefault()
          p.onContextMenu(e, idx)
        }}
        title={c.body ? `${c.summary}\n\n${c.body}` : undefined}
      >
        <div class="refs">
          {sorted.map((l) => (
            <Pill key={l.kind + l.name} label={l} color={color} onDoubleClick={() => p.onPillDoubleClick(l)} />
          ))}
        </div>
        <Lanes lay={lay} kind={c.kind} author={c.author} email={c.email} drawEdges={!p.filtered} />
        <div class={`msg ${c.kind}`}>{c.kind === 'wip' ? `Uncommitted changes · ${p.wipCount} file${p.wipCount === 1 ? '' : 's'}` : c.summary}</div>
        <div class="author">{c.kind !== 'wip' && <Avatar name={c.author} email={c.email} color={color} />}</div>
        <div class="date">{c.kind !== 'wip' && fmtDate(c.time)}</div>
        <div class="sha">{c.kind !== 'wip' && short(c.id)}</div>
      </div>,
    )
  }
  return (
    <div class="graph">
      <div class="graph-header" style={{ '--cols': cols }}>
        <div>REFS</div>
        <div>GRAPH</div>
        <div>MESSAGE</div>
        <div></div>
        <div>DATE</div>
        <div>SHA</div>
      </div>
      <div class="rows" ref={box} onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}>
        <div style={{ height: `${count * ROW_H}px`, position: 'relative' }}>{items}</div>
        {p.rows.length === 0 && <div class="placeholder">No commits yet</div>}
      </div>
    </div>
  )
}

function rank(l: RefLabel): number {
  if (l.kind === 'head') return l.current ? 0 : 1
  return l.kind === 'remote' ? 2 : 3
}
