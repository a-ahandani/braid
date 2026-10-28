import { useEffect, useRef, useState } from 'preact/hooks'
import type { Backend, FileVersions } from '../git/backend'
import { mixedEol } from '../git/chunk'
import { Icon, short } from './bits'
import type { FileSel } from './DetailPanel'
import { DiffEditor, type ChunkAction, type DiffEditorHandle, type DiffMode } from './DiffEditor'

export interface DiffOptions {
  wrap: boolean
  mode: DiffMode
  collapse: boolean
}

export interface DiffTab {
  key: string
  sel: FileSel
  dirty: boolean
}

interface Geo {
  x: number
  y: number
  w: number
  h: number
}

type PaneHandle = DiffEditorHandle & { save: () => void }

const GEO_KEY = 'ramulus.diffwin'
const MIN_W = 420
const MIN_H = 240
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export const tabKey = (s: FileSel) => `${s.area.kind}:${s.area.kind === 'commit' ? s.area.oid : ''}:${s.path}`

function fit(g: Geo): Geo {
  const w = Math.min(Math.max(g.w, MIN_W), innerWidth - 16)
  const h = Math.min(Math.max(g.h, MIN_H), innerHeight - 16)
  return { w, h, x: Math.min(Math.max(g.x, 120 - w), innerWidth - 120), y: Math.min(Math.max(g.y, 0), innerHeight - 40) }
}

function initialGeo(): Geo {
  try {
    const saved = JSON.parse(localStorage.getItem(GEO_KEY) ?? 'null')
    if (saved && [saved.x, saved.y, saved.w, saved.h].every(Number.isFinite)) return fit(saved)
  } catch {
    localStorage.removeItem(GEO_KEY)
  }
  return fit({ x: 60, y: 90, w: innerWidth - 560, h: innerHeight - 140 })
}

function describe(sel: FileSel): string {
  return sel.area.kind === 'unstaged' ? 'Working Tree' : sel.area.kind === 'staged' ? 'Index' : short(sel.area.oid)
}

function DiffPane(p: {
  tab: DiffTab
  be: Backend
  stamp: unknown
  active: boolean
  options: DiffOptions
  look: string
  actions: ChunkAction[]
  onDirty: (dirty: boolean) => void
  onSave: (text: string, base: string, done: () => void) => void
  handle: (h: PaneHandle) => void
  onGone: () => void
}) {
  const [versions, setVersions] = useState<FileVersions>()
  const { sel, dirty } = p.tab
  const settled = sel.area.kind === 'commit' && !!versions
  useEffect(() => {
    if (dirty || !p.active || settled) return
    let live = true
    p.be
      .fileVersions(sel.area, sel.path)
      .then((v) => live && setVersions(v))
      .catch(() => live && setVersions({ old: '', new: '', binary: true }))
    return () => {
      live = false
    }
  }, [p.be, p.stamp, dirty, p.active])
  const ref = useRef<DiffEditorHandle | undefined>(undefined)
  const latest = useRef({ p, versions })
  latest.current = { p, versions }
  useEffect(() => () => latest.current.p.onGone(), [])
  const mixed = !!versions && (mixedEol(versions.old) || mixedEol(versions.new))
  const save = () => {
    const { p: cur, versions: v } = latest.current
    if (!ref.current || !v || sel.area.kind !== 'unstaged' || mixedEol(v.new)) return
    const text = ref.current.text()
    cur.onSave(text, v.new, () => {
      setVersions((x) => x && { ...x, new: text })
      latest.current.p.onDirty(ref.current?.text() !== text)
    })
  }
  return (
    <div class="diff-pane" hidden={!p.active}>
      {mixed && <div class="pane-note">This file mixes line ending styles, so editing and block staging are off here. Stage or discard the whole file from the list.</div>}
      {!versions ? (
        <div class="placeholder">Loading…</div>
      ) : versions.binary ? (
        <div class="placeholder">Binary or very large file</div>
      ) : (
        <DiffEditor
          oldText={versions.old}
          newText={versions.new}
          filename={sel.path}
          mode={p.options.mode}
          look={p.look}
          wrap={p.options.wrap}
          collapse={p.options.collapse}
          editable={sel.area.kind === 'unstaged' && !mixed}
          dirty={dirty}
          actions={mixed ? [] : p.actions}
          onDirty={p.onDirty}
          onSave={save}
          handle={(h) => {
            ref.current = h
            p.handle({ ...h, save })
          }}
        />
      )}
    </div>
  )
}

export function DiffWindow(p: {
  tabs: DiffTab[]
  active: string
  be: Backend
  stamp: unknown
  options: DiffOptions
  look: string
  actionsFor: (sel: FileSel) => ChunkAction[]
  onActivate: (key: string) => void
  onCloseTab: (key: string) => void
  onCloseAll: () => void
  onOptions: (o: DiffOptions) => void
  onDirty: (key: string, dirty: boolean) => void
  onSave: (sel: FileSel, text: string, base: string, done: () => void) => void
  onOpen?: (sel: FileSel) => void
}) {
  const [geo, setGeo] = useState<Geo>(initialGeo)
  const [max, setMax] = useState(false)
  const handles = useRef(new Map<string, PaneHandle>())
  const dragged = useRef(false)
  const strip = useRef<HTMLDivElement>(null)
  const current = p.tabs.find((t) => t.key === p.active) ?? p.tabs[0]
  const h = () => handles.current.get(current.key)

  useEffect(() => {
    localStorage.setItem(GEO_KEY, JSON.stringify(geo))
  }, [geo])
  useEffect(() => {
    strip.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current.key])
  useEffect(() => {
    const onResize = () => setGeo((g) => fit(g))
    addEventListener('resize', onResize)
    return () => removeEventListener('resize', onResize)
  }, [])

  const track = (e: PointerEvent, apply: (dx: number, dy: number, start: Geo) => Geo) => {
    dragged.current = false
    if (e.button !== 0 || max) return
    const sx = e.clientX
    const sy = e.clientY
    const start = geo
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx
      const dy = ev.clientY - sy
      if (!dragged.current && Math.hypot(dx, dy) < 4) return
      dragged.current = true
      document.body.classList.add('dragging')
      setGeo(apply(dx, dy, start))
    }
    const up = () => {
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
      document.body.classList.remove('dragging')
      setGeo((g) => fit(g))
    }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
  }

  const moveFrom = (e: PointerEvent) => {
    if ((e.target as Element).closest('button')) return
    track(e, (dx, dy, s) => ({ ...s, x: s.x + dx, y: s.y + dy }))
  }

  const resizeFrom = (edge: string) => (e: PointerEvent) => {
    e.preventDefault()
    track(e, (dx, dy, s) => {
      const g = { ...s }
      if (edge.includes('e')) g.w = Math.max(MIN_W, s.w + dx)
      if (edge.includes('s')) g.h = Math.max(MIN_H, s.h + dy)
      if (edge.includes('w')) {
        g.w = Math.max(MIN_W, s.w - dx)
        g.x = s.x + s.w - g.w
      }
      if (edge.includes('n')) {
        g.h = Math.max(MIN_H, s.h - dy)
        g.y = s.y + s.h - g.h
      }
      return g
    })
  }

  const toggle = (k: 'wrap' | 'collapse') => p.onOptions({ ...p.options, [k]: !p.options[k] })
  const parts = current.sel.path.split('/')
  const style = max ? undefined : { left: `${geo.x}px`, top: `${geo.y}px`, width: `${geo.w}px`, height: `${geo.h}px` }

  return (
    <div class={`diff-window ${max ? 'max' : ''}`} style={style} role="dialog" aria-label="Diff">
      <div class="diff-tabs" onPointerDown={moveFrom} onDblClick={(e) => !(e.target as Element).closest('button, .tab') && setMax(!max)}>
        <div class="tab-strip" ref={strip}>
          {p.tabs.map((t) => {
            const name = t.sel.path.slice(t.sel.path.lastIndexOf('/') + 1)
            return (
              <div
                key={t.key}
                class={`tab ${t.key === current.key ? 'active' : ''} ${t.dirty ? 'dirty' : ''}`}
                title={`${t.sel.path} (${describe(t.sel)})`}
                role="tab"
                tabIndex={0}
                aria-selected={t.key === current.key}
                onClick={() => !dragged.current && p.onActivate(t.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  p.onActivate(t.key)
                }}
                onMouseDown={(e) => {
                  if (e.button !== 1) return
                  e.preventDefault()
                  p.onCloseTab(t.key)
                }}
              >
                <Icon name="diff" />
                <span class="name">{name}</span>
                <span class="desc">({describe(t.sel)})</span>
                <button
                  class="icon close"
                  title={t.dirty ? 'Unsaved edits. Close' : 'Close'}
                  onClick={(e) => {
                    e.stopPropagation()
                    p.onCloseTab(t.key)
                  }}
                >
                  <span class="dot">
                    <Icon name="circle-filled" />
                  </span>
                  <span class="x">
                    <Icon name="close" />
                  </span>
                </button>
              </div>
            )
          })}
        </div>
        <div class="actions">
          {current.dirty && (
            <button class="icon" title="Save (⌘S)" onClick={() => h()?.save()}>
              <Icon name="save" />
            </button>
          )}
          {p.onOpen && current.sel.area.kind !== 'commit' && (
            <button class="icon" title="Open File" onClick={() => p.onOpen!(current.sel)}>
              <Icon name="go-to-file" />
            </button>
          )}
          <button class="icon" title="Previous Change" onClick={() => h()?.prev()}>
            <Icon name="arrow-up" />
          </button>
          <button class="icon" title="Next Change" onClick={() => h()?.next()}>
            <Icon name="arrow-down" />
          </button>
          <button class={`icon ${p.options.collapse ? 'on' : ''}`} title="Collapse Unchanged Regions" onClick={() => toggle('collapse')}>
            <Icon name="fold" />
          </button>
          <button class={`icon ${p.options.mode === 'inline' ? 'on' : ''}`} title="Toggle Inline View" onClick={() => p.onOptions({ ...p.options, mode: p.options.mode === 'split' ? 'inline' : 'split' })}>
            <Icon name="diff-single" />
          </button>
          <button class={`icon ${p.options.wrap ? 'on' : ''}`} title="Toggle Word Wrap" onClick={() => toggle('wrap')}>
            <Icon name="word-wrap" />
          </button>
          <span class="sep" />
          <button class="icon" title={max ? 'Restore' : 'Maximize'} onClick={() => setMax(!max)}>
            <Icon name={max ? 'screen-normal' : 'screen-full'} />
          </button>
          <button class="icon" title="Close all" onClick={p.onCloseAll}>
            <Icon name="close" />
          </button>
        </div>
      </div>
      <div class="breadcrumbs">
        {parts.map((s, i) => (
          <span key={i} class="crumb">
            {i > 0 && <Icon name="chevron-right" />}
            {i === parts.length - 1 && <Icon name="file" />}
            {s}
          </span>
        ))}
      </div>
      {p.tabs.map((t) => (
        <DiffPane
          key={t.key}
          tab={t}
          be={p.be}
          stamp={p.stamp}
          active={t.key === current.key}
          options={p.options}
          look={p.look}
          actions={p.actionsFor(t.sel)}
          onDirty={(d) => p.onDirty(t.key, d)}
          onSave={(text, base, done) => p.onSave(t.sel, text, base, done)}
          handle={(x) => handles.current.set(t.key, x)}
          onGone={() => handles.current.delete(t.key)}
        />
      ))}
      {!max && EDGES.map((edge) => <div key={edge} class={`edge ${edge}`} onPointerDown={resizeFrom(edge)} />)}
    </div>
  )
}
