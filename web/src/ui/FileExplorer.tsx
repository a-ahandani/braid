import type { JSX } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { ChangeKind, WorkStatus } from '../git/repo'
import { Icon } from './bits'
import { buildTree, kindColor, type TreeNode } from './DetailPanel'

type Entry = { path: string; kind?: ChangeKind }

const LIMIT = 500

export function changedDirs(entries: Entry[]): Map<string, ChangeKind> {
  const kinds = new Map<string, ChangeKind>()
  for (const e of entries) {
    if (!e.kind) continue
    const parts = e.path.split('/')
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/')
      const had = kinds.get(dir)
      kinds.set(dir, had && had !== e.kind ? 'M' : e.kind)
    }
  }
  return kinds
}

export function FileExplorer(p: { load: () => Promise<string[]>; status: WorkStatus; stamp: unknown; selected?: string; onOpen: (path: string) => void }) {
  const [tracked, setTracked] = useState<string[]>()
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let live = true
    p.load().then(
      (f) => live && (setTracked(f), setFailed(false)),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [p.stamp])

  const entries = useMemo(() => {
    const kinds = new Map<string, ChangeKind>()
    for (const f of [...p.status.staged, ...p.status.unstaged]) kinds.set(f.path, f.kind)
    return [...new Set([...(tracked ?? []), ...kinds.keys()])].sort().map((path): Entry => ({ path, kind: kinds.get(path) }))
  }, [tracked, p.status])
  const root = useMemo(() => buildTree(entries), [entries])
  const dirKinds = useMemo(() => changedDirs(entries), [entries])
  const q = filter.trim().toLowerCase()
  const matches = q ? entries.filter((e) => e.path.toLowerCase().includes(q)) : []

  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const row = (e: Entry, label: string, depth: number) => (
    <div key={e.path} class={`file ${p.selected === e.path ? 'selected' : ''}`} style={{ paddingLeft: `${10 + depth * 14}px` }} title={e.path} onClick={() => p.onOpen(e.path)}>
      <Icon name="file" />
      <span class="n" style={e.kind ? { color: kindColor(e.kind) } : undefined}>
        {label}
      </span>
      <span class="spacer" />
      {e.kind && (
        <span class="k" style={{ color: kindColor(e.kind) }}>
          {e.kind === '?' ? 'U' : e.kind}
        </span>
      )}
    </div>
  )

  const render = (n: TreeNode<Entry>, depth: number): JSX.Element[] => {
    const kids = [...n.children.values()]
    const out: JSX.Element[] = []
    for (const d of kids.filter((c) => !c.file).sort((a, b) => a.name.localeCompare(b.name))) {
      const shown = open.has(d.path)
      const kind = dirKinds.get(d.path)
      out.push(
        <div key={d.path} class="file dir" style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={() => toggle(d.path)} title={kind ? 'Has changes' : undefined}>
          <Icon name={shown ? 'chevron-down' : 'chevron-right'} />
          <span class="n" style={kind ? { color: kindColor(kind) } : undefined}>
            {d.name}
          </span>
          <span class="spacer" />
          {kind && <span class="change-dot" style={{ background: kindColor(kind) }} />}
        </div>,
      )
      if (shown) out.push(...render(d, depth + 1))
    }
    for (const f of kids.filter((c) => c.file).sort((a, b) => a.name.localeCompare(b.name))) out.push(row(f.file!, f.name, depth))
    return out
  }

  return (
    <>
      <div class="left-filter">
        <input placeholder="Filter files" value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
      </div>
      <div class="files-body">
        {failed ? (
          <div class="empty">Could not list the files.</div>
        ) : !tracked ? (
          <div class="empty">Reading files...</div>
        ) : q ? (
          <>
            {matches.slice(0, LIMIT).map((e) => row(e, e.path, 0))}
            {matches.length === 0 && <div class="empty">No matching files</div>}
            {matches.length > LIMIT && <div class="empty">Showing the first {LIMIT}. Type more to narrow it down.</div>}
          </>
        ) : (
          render(root, 0)
        )}
      </div>
    </>
  )
}
