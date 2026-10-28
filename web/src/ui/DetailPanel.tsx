import type { JSX } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import type { HunkOp } from '../git/backend'
import type { Commit, DiffArea, DiffLine, FileChange, RepoData } from '../git/repo'
import { Avatar, ago, fmtDate, short } from './bits'

export interface FileSel {
  area: DiffArea
  path: string
}

export interface DiffOptions {
  wrap: boolean
  ignoreWs: boolean
}

export interface DetailProps {
  data: RepoData
  commit?: Commit
  commitColor: string
  commitFiles: FileChange[]
  isStash: boolean
  selectedFile?: FileSel
  diff: DiffLine[]
  diffOptions: DiffOptions
  native: boolean
  tree: boolean
  summary: string
  description: string
  amend: boolean
  onDiffOptions: (o: DiffOptions) => void
  onTree: (tree: boolean) => void
  onSummary: (s: string) => void
  onDescription: (s: string) => void
  onAmend: (b: boolean) => void
  onSelectFile: (f: FileSel) => void
  onStage: (files: FileChange[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (files: FileChange[]) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onHunk: (area: DiffArea, path: string, hunk: number, op: HunkOp) => void
  onCommit: () => void
  onCopy: (s: string) => void
  onJump: (oid: string) => void
  onFileMenu: (e: MouseEvent, f: FileChange, area: DiffArea) => void
  onAbort?: () => void
  onContinue?: () => void
}

function kindColor(k: FileChange['kind']): string {
  return k === 'A' || k === '?' ? 'var(--green)' : k === 'D' ? 'var(--red)' : 'var(--yellow)'
}

function Stats({ f }: { f: FileChange }) {
  if (f.added === undefined && f.deleted === undefined) return null
  return (
    <span class="stats">
      {f.added ? <span class="plus">+{f.added}</span> : null}
      {f.deleted ? <span class="minus">−{f.deleted}</span> : null}
    </span>
  )
}

function FileRow({ f, label, depth, selected, onClick, actions, onMenu }: { f: FileChange; label: string; depth: number; selected: boolean; onClick: () => void; actions?: JSX.Element; onMenu: (e: MouseEvent) => void }) {
  const i = f.path.lastIndexOf('/')
  const dir = depth > 0 || i < 0 ? '' : f.path.slice(0, i + 1)
  return (
    <div
      class={`file ${selected ? 'selected' : ''}`}
      style={{ paddingLeft: `${10 + depth * 14}px` }}
      onClick={onClick}
      title={f.path}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e)
      }}
    >
      <span class="k" style={{ color: f.conflict ? 'var(--orange)' : kindColor(f.kind) }}>
        {f.conflict ? '!' : f.kind === '?' ? 'A' : f.kind}
      </span>
      <span class="n">{label}</span>
      {dir && <span class="d">{dir}</span>}
      <Stats f={f} />
      {actions && <span class="acts">{actions}</span>}
    </div>
  )
}

interface TreeNode {
  name: string
  path: string
  children: Map<string, TreeNode>
  file?: FileChange
}

function buildTree(files: FileChange[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() }
  for (const f of files) {
    const parts = f.path.split('/')
    let node = root
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join('/')
      let child = node.children.get(part)
      if (!child) {
        child = { name: part, path, children: new Map() }
        node.children.set(part, child)
      }
      node = child
    })
    node.file = f
  }
  const collapse = (n: TreeNode): TreeNode => {
    for (const [k, c] of n.children) n.children.set(k, collapse(c))
    if (!n.file && n.children.size === 1 && n.path) {
      const only = [...n.children.values()][0]
      if (!only.file) return { ...only, name: `${n.name}/${only.name}` }
    }
    return n
  }
  return collapse(root)
}

function FileList(p: { files: FileChange[]; tree: boolean; isSelected: (f: FileChange) => boolean; onPick: (f: FileChange) => void; actions?: (f: FileChange) => JSX.Element; onMenu: (e: MouseEvent, f: FileChange) => void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const root = useMemo(() => (p.tree ? buildTree(p.files) : undefined), [p.files, p.tree])
  if (!p.tree) {
    return (
      <>
        {p.files.map((f) => (
          <FileRow key={f.path} f={f} label={f.path.slice(f.path.lastIndexOf('/') + 1)} depth={0} selected={p.isSelected(f)} onClick={() => p.onPick(f)} actions={p.actions?.(f)} onMenu={(e) => p.onMenu(e, f)} />
        ))}
      </>
    )
  }
  const render = (n: TreeNode, depth: number): JSX.Element[] => {
    const out: JSX.Element[] = []
    const dirs = [...n.children.values()].filter((c) => !c.file).sort((a, b) => a.name.localeCompare(b.name))
    const files = [...n.children.values()].filter((c) => c.file).sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirs) {
      const isClosed = closed.has(d.path)
      out.push(
        <div key={d.path} class="file dir" style={{ paddingLeft: `${10 + depth * 14}px` }} onClick={() => setClosed((s) => {
          const next = new Set(s)
          if (next.has(d.path)) next.delete(d.path)
          else next.add(d.path)
          return next
        })}>
          <span class="k">{isClosed ? '▸' : '▾'}</span>
          <span class="n">{d.name}</span>
        </div>,
      )
      if (!isClosed) out.push(...render(d, depth + 1))
    }
    for (const f of files) {
      out.push(<FileRow key={f.path} f={f.file!} label={f.name} depth={depth} selected={p.isSelected(f.file!)} onClick={() => p.onPick(f.file!)} actions={p.actions?.(f.file!)} onMenu={(e) => p.onMenu(e, f.file!)} />)
    }
    return out
  }
  return <>{render(root!, 0)}</>
}

interface Annotated extends DiffLine {
  oldNo?: number
  newNo?: number
  hunk: number
}

function annotate(lines: DiffLine[]): Annotated[] {
  let oldNo = 0
  let newNo = 0
  let hunk = -1
  return lines.map((l) => {
    if (l.type === 'hunk') {
      hunk++
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(l.text)
      oldNo = m ? Number(m[1]) : 0
      newNo = m ? Number(m[2]) : 0
      return { ...l, hunk }
    }
    if (l.type === 'add') return { ...l, hunk, newNo: newNo++ }
    if (l.type === 'del') return { ...l, hunk, oldNo: oldNo++ }
    if (l.type === 'ctx') return { ...l, hunk, oldNo: oldNo++, newNo: newNo++ }
    return { ...l, hunk }
  })
}

function Diff(p: { sel?: FileSel; lines: DiffLine[]; options: DiffOptions; native: boolean; onOptions: (o: DiffOptions) => void; onHunk: (hunk: number, op: HunkOp) => void }) {
  const [cursor, setCursor] = useState(0)
  const rows = useMemo(() => annotate(p.lines), [p.lines])
  const hunks = rows.filter((r) => r.type === 'hunk').length
  if (!p.sel) return <div class="placeholder">Pick a file to see its diff</div>
  const area = p.sel.area.kind
  const hunkOps: [HunkOp, string][] = area === 'unstaged' ? [['stage', 'Stage hunk'], ['discard', 'Discard hunk']] : area === 'staged' ? [['unstage', 'Unstage hunk']] : []
  const go = (dir: 1 | -1) => {
    const next = Math.max(0, Math.min(hunks - 1, cursor + dir))
    setCursor(next)
    document.getElementById(`hunk-${next}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  return (
    <div class="diff-wrap">
      <div class="diff-bar">
        <span class="path" title={p.sel.path}>
          {p.sel.path}
        </span>
        <span class="spacer" />
        {hunks > 1 && (
          <>
            <button class="ghost" title="Previous change" onClick={() => go(-1)}>
              ↑
            </button>
            <span class="count">
              {Math.min(cursor + 1, hunks)} / {hunks}
            </span>
            <button class="ghost" title="Next change" onClick={() => go(1)}>
              ↓
            </button>
          </>
        )}
        <button class={`ghost ${p.options.wrap ? 'on' : ''}`} title="Wrap long lines" onClick={() => p.onOptions({ ...p.options, wrap: !p.options.wrap })}>
          ⤶
        </button>
        {p.native && (
          <button class={`ghost ${p.options.ignoreWs ? 'on' : ''}`} title="Ignore whitespace changes" onClick={() => p.onOptions({ ...p.options, ignoreWs: !p.options.ignoreWs })}>
            ␣
          </button>
        )}
      </div>
      <div class={`diff ${p.options.wrap ? 'wrap' : ''}`}>
        {rows.length === 0 && <div class="note">No text changes to show (binary or identical).</div>}
        {rows.map((l, i) =>
          l.type === 'hunk' ? (
            <div class="line hunk" id={`hunk-${l.hunk}`} key={i}>
              <span class="no" />
              <span class="no" />
              <span class="t">{l.text}</span>
              {p.native && hunkOps.length > 0 && (
                <span class="hunk-acts">
                  {hunkOps.map(([op, label]) => (
                    <button key={op} class={op === 'discard' ? 'danger' : ''} onClick={() => p.onHunk(l.hunk, op)}>
                      {label}
                    </button>
                  ))}
                </span>
              )}
            </div>
          ) : (
            <div class={`line ${l.type}`} key={i}>
              <span class="no">{l.oldNo ?? ''}</span>
              <span class="no">{l.newNo ?? ''}</span>
              <span class="t">{l.text}</span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

export function DetailPanel(p: DetailProps) {
  const treeToggle = (
    <button class="ghost small" title={p.tree ? 'Show as a flat list' : 'Show as a tree'} onClick={() => p.onTree(!p.tree)}>
      {p.tree ? '☰' : '🌲'}
    </button>
  )
  const hunk = (hunkIdx: number, op: HunkOp) => p.selectedFile && p.onHunk(p.selectedFile.area, p.selectedFile.path, hunkIdx, op)
  if (p.commit) {
    const c = p.commit
    return (
      <div class="right">
        <div class="detail-head">
          <h2>{c.summary}</h2>
          <div class="who">
            <Avatar name={c.author} email={c.email} color={p.commitColor} size={26} />
            <div>
              <div title={c.email}>{c.author}</div>
              <div class="when">
                {fmtDate(c.time)} · {ago(c.time)}
              </div>
            </div>
          </div>
          <div class="hashes">
            <button title="Copy full hash" onClick={() => p.onCopy(c.id)}>
              {short(c.id)}
            </button>
            {c.parents.map((pid) => (
              <button class="ghost" key={pid} onClick={() => p.onJump(pid)}>
                parent {short(pid)}
              </button>
            ))}
          </div>
          {c.body && <div class="body">{c.body}</div>}
        </div>
        <div class="hr" />
        <div class="fhead">
          {p.commitFiles.length} file change{p.commitFiles.length === 1 ? '' : 's'}
          {p.isStash ? ' in stash' : ''}
          <span class="spacer" />
          {treeToggle}
        </div>
        <div class="files">
          <FileList files={p.commitFiles} tree={p.tree} isSelected={(f) => p.selectedFile?.path === f.path} onPick={(f) => p.onSelectFile({ area: { kind: 'commit', oid: c.id }, path: f.path })} onMenu={(e, f) => p.onFileMenu(e, f, { kind: 'commit', oid: c.id })} />
        </div>
        <div class="hr" />
        <Diff sel={p.selectedFile} lines={p.diff} options={p.diffOptions} native={p.native} onOptions={p.onDiffOptions} onHunk={hunk} />
      </div>
    )
  }
  const s = p.data.status
  const canCommit = (s.staged.length > 0 || p.amend) && p.summary.trim().length > 0
  const label = p.amend
    ? 'Amend last commit'
    : s.staged.length === 0
      ? 'Stage something first'
      : p.summary.trim().length === 0
        ? 'Add a summary first'
        : `Commit ${s.staged.length} file${s.staged.length === 1 ? '' : 's'}`
  const isSel = (area: DiffArea['kind'], path: string) => p.selectedFile?.area.kind === area && p.selectedFile.path === path
  const state = s.state
  const conflicts = s.unstaged.filter((f) => f.conflict).length
  return (
    <div class="right">
      {state && (
        <div class="banner">
          <span>
            {state === 'merge' ? 'Merge' : state === 'rebase' ? 'Rebase' : state === 'cherry-pick' ? 'Cherry-pick' : 'Revert'} in progress
            {conflicts > 0 ? `, ${conflicts} conflicted file${conflicts === 1 ? '' : 's'} to resolve and stage` : ''}
          </span>
          {p.onContinue && (
            <button disabled={conflicts > 0} onClick={p.onContinue}>
              Continue
            </button>
          )}
          {p.onAbort && (
            <button class="danger" onClick={p.onAbort}>
              Abort
            </button>
          )}
        </div>
      )}
      <div class="files staging">
        <div class="fhead">
          Unstaged ({s.unstaged.length})
          <span class="spacer" />
          {treeToggle}
          {s.unstaged.length > 0 && <button onClick={p.onStageAll}>Stage everything</button>}
        </div>
        <FileList
          files={s.unstaged}
          tree={p.tree}
          isSelected={(f) => isSel('unstaged', f.path)}
          onPick={(f) => p.onSelectFile({ area: { kind: 'unstaged' }, path: f.path })}
          onMenu={(e, f) => p.onFileMenu(e, f, { kind: 'unstaged' })}
          actions={(f) => (
            <>
              <button onClick={(e) => (e.stopPropagation(), p.onStage([f]))}>Stage</button>
              <button onClick={(e) => (e.stopPropagation(), p.onDiscard([f]))}>Discard</button>
            </>
          )}
        />
        <div class="gap" />
        <div class="fhead">
          Staged ({s.staged.length})
          <span class="spacer" />
          {s.staged.length > 0 && <button onClick={p.onUnstageAll}>Unstage everything</button>}
        </div>
        <FileList
          files={s.staged}
          tree={p.tree}
          isSelected={(f) => isSel('staged', f.path)}
          onPick={(f) => p.onSelectFile({ area: { kind: 'staged' }, path: f.path })}
          onMenu={(e, f) => p.onFileMenu(e, f, { kind: 'staged' })}
          actions={(f) => <button onClick={(e) => (e.stopPropagation(), p.onUnstage([f.path]))}>Unstage</button>}
        />
      </div>
      <div class="hr" />
      <Diff sel={p.selectedFile} lines={p.diff} options={p.diffOptions} native={p.native} onOptions={p.onDiffOptions} onHunk={hunk} />
      <div class="commit-box">
        {!p.data.headBranch && p.data.headOid && <div class="warn">Not on a branch (detached HEAD)</div>}
        <div class="label">Message</div>
        <input placeholder="Summary" value={p.summary} onInput={(e) => p.onSummary((e.target as HTMLInputElement).value)} />
        <textarea placeholder="Description" value={p.description} onInput={(e) => p.onDescription((e.target as HTMLTextAreaElement).value)} />
        {p.summary.length > 72 && <div class="warn">Keep the summary under 72 characters so other tools show it in full.</div>}
        <div class="actions">
          <label>
            <input type="checkbox" checked={p.amend} onChange={(e) => p.onAmend((e.target as HTMLInputElement).checked)} style={{ width: 'auto' }} /> Amend
          </label>
          <span class="right" />
          <button class={canCommit ? 'success' : ''} disabled={!canCommit} onClick={p.onCommit} title="⌘⏎">
            {label}
          </button>
        </div>
      </div>
    </div>
  )
}
