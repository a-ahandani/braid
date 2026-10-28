import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { RowLayout } from '../git/graph'
import type { BranchInfo, Commit, RefLabel } from '../git/repo'
import { ago, Avatar, fmtDate, Icon, laneColor, short } from './bits'

export const ROW_H = 30
const COL_W = 24
const GUTTER = 22
const NODE_R = 11
const MERGE_R = 5.5

export interface PillData {
  key: string
  name: string
  local?: RefLabel
  remote?: RefLabel
  tag?: RefLabel
  current: boolean
  ahead?: number
  behind?: number
}

export interface DropInfo {
  source: PillData
  rowIndex: number
  x: number
  y: number
}

export interface GraphProps {
  rows: Commit[]
  layoutOf: (index: number) => RowLayout
  maxCol: number
  refsByOid: Map<string, RefLabel[]>
  branches: BranchInfo[]
  order: number[]
  showEdges: boolean
  selectedIndex: number
  scrollTo?: number
  wipCount: number
  hasMore: boolean
  soloCount: number
  onSelect: (index: number) => void
  onContextMenu: (e: MouseEvent, index: number) => void
  onPillDoubleClick: (pill: PillData) => void
  onDrop: (info: DropInfo) => void
  onLoadMore: () => void
  onScrolled: () => void
  onClearSolo: () => void
}

function laneX(col: number): number {
  return 3 + GUTTER + col * COL_W + COL_W / 2
}

export function groupPills(refs: RefLabel[], branches: BranchInfo[]): PillData[] {
  const byName = new Map<string, PillData>()
  const get = (key: string, name: string) => {
    let p = byName.get(key)
    if (!p) {
      p = { key, name, current: false }
      byName.set(key, p)
    }
    return p
  }
  for (const l of refs) {
    if (l.kind === 'head') {
      const p = get(`b:${l.name}`, l.name)
      p.local = l
      p.current = !!l.current
      const b = branches.find((x) => x.name === l.name)
      if (b?.upstream) {
        p.ahead = b.ahead
        p.behind = b.behind
      }
    } else if (l.kind === 'remote') {
      const bare = l.name.slice(l.name.indexOf('/') + 1)
      const localHere = refs.some((r) => r.kind === 'head' && r.name === bare && branches.find((x) => x.name === bare)?.upstream === l.name)
      const p = localHere ? get(`b:${bare}`, bare) : get(`r:${l.name}`, l.name)
      p.remote = l
    } else {
      const p = get(`t:${l.name}`, l.name)
      p.tag = l
    }
  }
  return [...byName.values()].sort((a, b) => rank(a) - rank(b))
}

function rank(p: PillData): number {
  if (p.current) return 0
  if (p.local) return 1
  if (p.remote) return 2
  return 3
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
        <rect x={nx - 8} y={mid - 8} width={16} height={16} rx={3} fill="var(--app-bg)" stroke={color} stroke-width={2} />
        <text x={nx} y={mid + 4} text-anchor="middle" font-size={12} fill={color}>
          ≡
        </text>
      </g>
    )
  else if (kind === 'wip')
    node = (
      <g>
        <circle cx={nx} cy={mid} r={NODE_R} fill="var(--app-bg)" stroke={color} stroke-width={2} stroke-dasharray="3 2.5" />
        <circle cx={nx} cy={mid} r={4} fill={color} />
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
        <span style={{ position: 'absolute', left: `${nx - 9}px`, top: `${mid - 9}px` }}>
          <Avatar name={author} email={email} color={color} size={18} />
        </span>
      )}
    </div>
  )
}

export function Pill({ pill, color, onDoubleClick, onPointerDown }: { pill: PillData; color: string; onDoubleClick?: () => void; onPointerDown?: (e: PointerEvent) => void }) {
  const bg = pill.current ? `color-mix(in srgb, ${color} 45%, transparent)` : `color-mix(in srgb, ${color} 25%, transparent)`
  const parts: string[] = []
  if (pill.local) parts.push(pill.current ? 'Checked out' : 'Local branch. Double-click to switch, drag onto a commit to merge or rebase.')
  if (pill.remote) parts.push(`Remote: ${pill.remote.name}`)
  if (pill.tag) parts.push('Tag')
  if (pill.ahead || pill.behind) parts.push(`${pill.ahead ?? 0} ahead, ${pill.behind ?? 0} behind its upstream`)
  const draggable = !!(pill.local || pill.remote)
  return (
    <span
      class={`pill ${pill.current ? 'current' : ''}`}
      style={{ background: bg, color, outline: pill.current ? `1px solid ${color}` : undefined }}
      title={`${pill.name}\n${parts.join('\n')}`}
      onDblClick={onDoubleClick}
      data-draggable={draggable ? '1' : undefined}
      onPointerDown={(e) => draggable && e.button === 0 && onPointerDown?.(e)}
    >
      {pill.current && <Icon name="target" />}
      {pill.local && !pill.current && <Icon name="git-branch" />}
      {pill.remote && <Icon name="cloud" />}
      {pill.tag && <Icon name="tag" />}
      {pill.name}
      {!!(pill.ahead || pill.behind) && (
        <span class="track">
          {pill.ahead ? <><Icon name="arrow-small-up" />{pill.ahead}</> : null}
          {pill.behind ? <><Icon name="arrow-small-down" />{pill.behind}</> : null}
        </span>
      )}
    </span>
  )
}

export function GraphView(p: GraphProps) {
  const box = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const [dropRow, setDropRow] = useState<number>()
  const dragging = useRef<PillData | undefined>(undefined)
  const startDrag = (pill: PillData, e: PointerEvent) => {
    const sx = e.clientX
    const sy = e.clientY
    let active = false
    let over: number | undefined
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return
      if (!active) {
        active = true
        dragging.current = pill
        document.body.style.cursor = 'grabbing'
      }
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('.row[data-idx]')
      const idx = row ? Number(row.dataset.idx) : undefined
      const c = idx === undefined ? undefined : p.rows[idx]
      over = c && c.kind !== 'wip' ? idx : undefined
      setDropRow(over)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      setDropRow(undefined)
      if (active && over !== undefined) p.onDrop({ source: pill, rowIndex: over, x: ev.clientX, y: ev.clientY })
      dragging.current = undefined
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
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
    const pos = p.order.indexOf(p.scrollTo)
    if (pos >= 0) box.current.scrollTop = Math.max(0, pos * ROW_H - height / 2 + ROW_H / 2)
    p.onScrolled()
  }, [p.scrollTo])
  const count = p.order.length + (p.hasMore && p.showEdges ? 1 : 0)
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5)
  const end = Math.min(count, Math.ceil((scrollTop + height) / ROW_H) + 5)
  const graphW = Math.min(420, Math.max(56, 3 + GUTTER + (p.maxCol + 1) * COL_W + 6))
  const cols = `minmax(150px, 22%) ${graphW}px 1fr 40px 120px 72px`
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
    const lay = p.layoutOf(idx)
    const color = laneColor(lay.column)
    const pills = c.kind === 'wip' ? [] : groupPills(p.refsByOid.get(c.id) ?? [], p.branches)
    items.push(
      <div
        key={c.id}
        class={`row ${idx === p.selectedIndex ? 'selected' : ''} ${dropRow === idx ? 'drop' : ''}`}
        style={{ top: `${top}px`, '--cols': cols }}
        data-idx={idx}
        onClick={() => !dragging.current && p.onSelect(idx)}
        onContextMenu={(e) => {
          e.preventDefault()
          p.onContextMenu(e, idx)
        }}
        title={c.body ? `${c.summary}\n\n${c.body}` : undefined}
      >
        <div class="refs">
          {pills.map((pill) => (
            <Pill
              key={pill.key}
              pill={pill}
              color={color}
              onDoubleClick={() => p.onPillDoubleClick(pill)}
              onPointerDown={(e) => startDrag(pill, e)}
            />
          ))}
        </div>
        <Lanes lay={lay} kind={c.kind} author={c.author} email={c.email} drawEdges={p.showEdges} />
        <div class={`msg ${c.kind}`}>{c.kind === 'wip' ? `Uncommitted changes · ${p.wipCount} file${p.wipCount === 1 ? '' : 's'}` : c.summary}</div>
        <div class="author">{c.kind !== 'wip' && <Avatar name={c.author} email={c.email} color={color} size={24} />}</div>
        <div class="date" title={c.kind !== 'wip' ? fmtDate(c.time) : undefined}>
          {c.kind !== 'wip' && ago(c.time)}
        </div>
        <div class="sha">{c.kind !== 'wip' && short(c.id)}</div>
      </div>,
    )
  }
  return (
    <div class="graph">
      <div class="graph-header" style={{ '--cols': cols }}>
        <div>REFS</div>
        <div>GRAPH</div>
        <div>
          MESSAGE
          {p.soloCount > 0 && (
            <span class="chip" onClick={p.onClearSolo} title="Show every branch again">
              Soloing {p.soloCount} branch{p.soloCount === 1 ? '' : 'es'} · show all
            </span>
          )}
        </div>
        <div></div>
        <div>WHEN</div>
        <div>SHA</div>
      </div>
      <div class="rows" ref={box} onScroll={(e) => setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)}>
        <div style={{ height: `${count * ROW_H}px`, position: 'relative' }}>{items}</div>
        {p.rows.length === 0 && <div class="placeholder">No commits yet</div>}
      </div>
    </div>
  )
}
