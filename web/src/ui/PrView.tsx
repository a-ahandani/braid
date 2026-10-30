import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useState } from 'preact/hooks'
import type { Backend, CheckState, PrChange, PullRequest, PullRequestDetail } from '../git/backend'
import { Icon, PR_ICON, ago, webUrl } from './bits'

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer')
  }
})

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export const markdown = (text: string) => !purify.isSupported ? `<pre>${escape(text)}</pre>` : purify.sanitize(marked.parse(text, { async: false, gfm: true }) as string, { FORBID_TAGS: ['img', 'picture', 'video', 'audio', 'iframe', 'style', 'form', 'button'], FORBID_ATTR: ['style'] })
const when = (iso: string) => ago(Date.parse(iso) / 1000)

const CHECK_ICON: Record<CheckState, string> = { pass: 'pass-filled', fail: 'error', running: 'loading', cancelled: 'circle-slash', skipped: 'dash' }
const STATE_LABEL = { OPEN: 'Open', DRAFT: 'Draft', MERGED: 'Merged', CLOSED: 'Closed' }
const REVIEW: Record<string, string> = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', COMMENTED: 'commented', DISMISSED: 'review dismissed' }
const DECISION: Record<string, Chip> = {
  APPROVED: { cls: 'pass', icon: 'check', text: 'Approved' },
  CHANGES_REQUESTED: { cls: 'fail', icon: 'request-changes', text: 'Changes requested' },
  REVIEW_REQUIRED: { cls: 'warn', icon: 'eye', text: 'Review required' },
}
const BLOCKER: Record<string, Chip> = {
  CLEAN: { cls: 'pass', icon: 'pass', text: 'Ready to merge' },
  BLOCKED: { cls: 'warn', icon: 'warning', text: 'Blocked by branch rules' },
  DIRTY: { cls: 'fail', icon: 'warning', text: 'Has conflicts' },
  BEHIND: { cls: 'warn', icon: 'warning', text: 'Behind the base branch' },
}

type Chip = { cls: string; icon: string; text: string }

function usePrDetail(be: Backend, number: number, active: boolean, stamp: unknown) {
  const [d, setD] = useState<PullRequestDetail>()
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    let live = true
    be.prView!(number).then(
      (x) => live && (setD(x), setFailed(false)),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [active, stamp, tick, number])
  const running = !!d?.checks.some((c) => c.state === 'running')
  useEffect(() => {
    if (!running || !active) return
    const t = setTimeout(() => setTick((n) => n + 1), 15000)
    return () => clearTimeout(t)
  }, [running, active, d])
  return { d, failed }
}

function PrStatus({ d }: { d: PullRequestDetail }) {
  const n = (s: CheckState) => d.checks.filter((c) => c.state === s).length
  const checks: Chip | undefined = !d.checks.length
    ? undefined
    : n('fail')
      ? { cls: 'fail', icon: 'error', text: `${n('fail')} failing ${n('fail') === 1 ? 'check' : 'checks'}` }
      : n('running')
        ? { cls: 'running', icon: 'loading', text: `${n('running')} ${n('running') === 1 ? 'check' : 'checks'} running` }
        : n('pass')
          ? { cls: 'pass', icon: 'pass-filled', text: 'Checks passed' }
          : { cls: '', icon: 'dash', text: 'No checks ran' }
  const chips = [checks, DECISION[d.reviewDecision], d.state === 'OPEN' ? BLOCKER[d.mergeState] : undefined].filter((c): c is Chip => !!c)
  if (!chips.length) return null
  return (
    <div class="pr-status">
      {chips.map((c) => (
        <span key={c.text} class={`pr-chip ${c.cls}`}>
          <Icon name={c.icon} />
          {c.text}
        </span>
      ))}
    </div>
  )
}

export interface PrHandlers {
  busy: boolean
  onMerge?: (pr: PullRequest) => void
  onChange?: (pr: PullRequest, action: PrChange) => void
}

function PrActions({ d, pr, busy, onMerge, onChange }: PrHandlers & { d: PullRequestDetail; pr: PullRequest }) {
  if (d.state === 'MERGED' || (!onMerge && !onChange)) return null
  const change = (action: PrChange) => () => onChange?.(pr, action)
  return (
    <div class="pr-actions">
      {d.state === 'OPEN' && onMerge && (
        <button class="primary" disabled={busy} onClick={() => onMerge(pr)}>
          <Icon name="git-merge" />
          Merge
        </button>
      )}
      {d.state === 'DRAFT' && onChange && (
        <button class="primary" disabled={busy} onClick={change('ready')}>
          <Icon name="eye" />
          Ready for review
        </button>
      )}
      {d.state === 'OPEN' && onChange && (
        <button disabled={busy} onClick={change('draft')}>
          <Icon name="git-pull-request-draft" />
          Mark as draft
        </button>
      )}
      {(d.state === 'OPEN' || d.state === 'DRAFT') && onChange && (
        <button disabled={busy} onClick={change('close')}>
          <Icon name="git-pull-request-closed" />
          Close
        </button>
      )}
      {d.state === 'CLOSED' && onChange && (
        <button disabled={busy} onClick={change('reopen')}>
          <Icon name="git-pull-request" />
          Reopen
        </button>
      )}
    </div>
  )
}

export function PrCard(p: PrHandlers & { be: Backend; pr: PullRequest; active: boolean; stamp: unknown; onOpen: (pr: PullRequest) => void }) {
  const { d, failed } = usePrDetail(p.be, p.pr.number, p.active, p.stamp)
  const state = d?.state ?? p.pr.state
  return (
    <div class="pr-mini">
      <button class={`pr-mini-title ${state.toLowerCase()}`} onClick={() => p.onOpen(p.pr)} title="Open the pull request">
        <Icon name={PR_ICON[state]} />
        <span class="num">#{p.pr.number}</span>
        <span class="name">{p.pr.title}</span>
        <Icon name="chevron-right" />
      </button>
      {d && <PrStatus d={d} />}
      {d && <PrActions d={d} pr={p.pr} busy={p.busy} onMerge={p.onMerge} onChange={p.onChange} />}
      {!d && failed && <div class="pr-mini-note">Could not load the details from GitHub.</div>}
    </div>
  )
}

export function PrView(p: PrHandlers & { be: Backend; pr: PullRequest; active: boolean; stamp: unknown }) {
  const { d, failed } = usePrDetail(p.be, p.pr.number, p.active, p.stamp)
  if (!d) return <div class="placeholder">{failed ? 'Could not read this pull request from GitHub.' : 'Loading…'}</div>
  return (
    <div class="pr-view">
      <div class="pr-inner">
        <h1>
          {d.title} <span class="num">#{d.number}</span>
        </h1>
        <div class="pr-meta">
          <span class={`pr-state ${d.state.toLowerCase()}`}>
            <Icon name={PR_ICON[d.state]} />
            {STATE_LABEL[d.state]}
          </span>
          <span class="dim">
            <b>{d.author}</b> {d.state === 'MERGED' ? 'merged' : 'wants to merge'} <code>{d.head}</code> into <code>{d.base}</code>
          </span>
          <a class="pr-open" href={webUrl(d.url)} target="_blank" rel="noreferrer" title="Open on GitHub">
            <Icon name="link-external" />
            GitHub
          </a>
        </div>
        <PrStatus d={d} />
        <PrActions d={d} pr={p.pr} busy={p.busy} onMerge={p.onMerge} onChange={p.onChange} />

        {d.checks.length > 0 && (
          <div class="pr-checks">
            <div class="pr-checks-head">Checks</div>
            {d.checks.map((c, i) => (
              <a key={i} class={`check ${c.state}`} href={webUrl(c.url)} target="_blank" rel="noreferrer">
                <Icon name={CHECK_ICON[c.state]} />
                <span class="name">{c.workflow ? `${c.workflow} / ${c.name}` : c.name}</span>
                <span class="dim">{c.state}</span>
              </a>
            ))}
          </div>
        )}

        <div class="pr-card">
          <div class="pr-card-head">
            <b>{d.author}</b> <span class="dim">opened this {when(d.createdAt)}</span>
          </div>
          {d.body.trim() ? <div class="md" dangerouslySetInnerHTML={{ __html: markdown(d.body) }} /> : <div class="md dim">No description.</div>}
        </div>

        {d.reviews.map((r, i) => (
          <div key={`r${i}`} class="pr-card">
            <div class="pr-card-head">
              <b>{r.author}</b> {REVIEW[r.state] ?? r.state.toLowerCase()} <span class="dim">{when(r.at)}</span>
            </div>
            {r.body.trim() && <div class="md" dangerouslySetInnerHTML={{ __html: markdown(r.body) }} />}
          </div>
        ))}

        {d.comments.map((c, i) => (
          <div key={`c${i}`} class="pr-card">
            <div class="pr-card-head">
              <b>{c.author}</b> <span class="dim">{when(c.at)}</span>
            </div>
            <div class="md" dangerouslySetInnerHTML={{ __html: markdown(c.body) }} />
          </div>
        ))}
      </div>
    </div>
  )
}
