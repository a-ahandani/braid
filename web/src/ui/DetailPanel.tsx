import type { JSX } from 'preact'
import type { Commit, DiffArea, DiffLine, FileChange, RepoData } from '../git/repo'
import { Avatar, ago, fmtDate, short } from './bits'

export interface FileSel {
  area: DiffArea
  path: string
}

export interface DetailProps {
  data: RepoData
  commit?: Commit
  commitColor: string
  commitFiles: FileChange[]
  isStash: boolean
  selectedFile?: FileSel
  diff: DiffLine[]
  summary: string
  description: string
  amend: boolean
  onSummary: (s: string) => void
  onDescription: (s: string) => void
  onAmend: (b: boolean) => void
  onSelectFile: (f: FileSel) => void
  onStage: (files: FileChange[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (files: FileChange[]) => void
  onStageAll: () => void
  onUnstageAll: () => void
  onCommit: () => void
  onCopy: (s: string) => void
  onJump: (oid: string) => void
  onFileMenu: (e: MouseEvent, f: FileChange, area: DiffArea) => void
}

function kindColor(k: FileChange['kind']): string {
  return k === 'A' || k === '?' ? 'var(--green)' : k === 'D' ? 'var(--red)' : 'var(--yellow)'
}

function FileRow({ f, selected, onClick, actions, onMenu }: { f: FileChange; selected: boolean; onClick: () => void; actions?: JSX.Element; onMenu: (e: MouseEvent) => void }) {
  const i = f.path.lastIndexOf('/')
  const name = i < 0 ? f.path : f.path.slice(i + 1)
  const dir = i < 0 ? '' : f.path.slice(0, i + 1)
  return (
    <div
      class={`file ${selected ? 'selected' : ''}`}
      onClick={onClick}
      title={f.path}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e)
      }}
    >
      <span class="k" style={{ color: kindColor(f.kind) }}>
        {f.kind === '?' ? 'A' : f.kind}
      </span>
      <span class="n">{name}</span>
      {dir && <span class="d">{dir}</span>}
      {actions && <span class="acts">{actions}</span>}
    </div>
  )
}

function Diff({ sel, lines }: { sel?: FileSel; lines: DiffLine[] }) {
  if (!sel) return <div class="placeholder">Pick a file to see its diff</div>
  return (
    <div class="diff">
      <div class="path">{sel.path}</div>
      {lines.length === 0 && <div class="note">No text changes to show (binary or identical).</div>}
      {lines.map((l, i) => (
        <div class={`line ${l.type}`} key={i}>
          {l.text}
        </div>
      ))}
    </div>
  )
}

export function DetailPanel(p: DetailProps) {
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
        </div>
        <div class="files">
          {p.commitFiles.map((f) => (
            <FileRow
              key={f.path}
              f={f}
              selected={p.selectedFile?.path === f.path}
              onClick={() => p.onSelectFile({ area: { kind: 'commit', oid: c.id }, path: f.path })}
              onMenu={(e) => p.onFileMenu(e, f, { kind: 'commit', oid: c.id })}
            />
          ))}
        </div>
        <div class="hr" />
        <Diff sel={p.selectedFile} lines={p.diff} />
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
  return (
    <div class="right">
      <div class="files staging">
        <div class="fhead">
          Unstaged ({s.unstaged.length}){s.unstaged.length > 0 && <button onClick={p.onStageAll}>Stage everything</button>}
        </div>
        {s.unstaged.map((f) => (
          <FileRow
            key={'u' + f.path}
            f={f}
            selected={isSel('unstaged', f.path)}
            onClick={() => p.onSelectFile({ area: { kind: 'unstaged' }, path: f.path })}
            onMenu={(e) => p.onFileMenu(e, f, { kind: 'unstaged' })}
            actions={
              <>
                <button onClick={(e) => (e.stopPropagation(), p.onStage([f]))}>Stage</button>
                <button onClick={(e) => (e.stopPropagation(), p.onDiscard([f]))}>Discard</button>
              </>
            }
          />
        ))}
        <div class="gap" />
        <div class="fhead">
          Staged ({s.staged.length}){s.staged.length > 0 && <button onClick={p.onUnstageAll}>Unstage everything</button>}
        </div>
        {s.staged.map((f) => (
          <FileRow
            key={'s' + f.path}
            f={f}
            selected={isSel('staged', f.path)}
            onClick={() => p.onSelectFile({ area: { kind: 'staged' }, path: f.path })}
            onMenu={(e) => p.onFileMenu(e, f, { kind: 'staged' })}
            actions={<button onClick={(e) => (e.stopPropagation(), p.onUnstage([f.path]))}>Unstage</button>}
          />
        ))}
      </div>
      <div class="hr" />
      <Diff sel={p.selectedFile} lines={p.diff} />
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
