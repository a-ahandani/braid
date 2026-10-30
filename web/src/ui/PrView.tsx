import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Backend, CheckState, PrChange, PrConversation, PrNote, PrThread, PullRequest, PullRequestDetail } from '../git/backend'
import { Icon, PR_ICON, ago, webUrl } from './bits'

// GitHub proxies outside images through its own host, so this keeps tracking pixels from reaching the viewer.
// shortcut: GitHub Enterprise media hosts are not listed, so their images are dropped, add the pull request's host if someone needs them.
const MEDIA_HOST = /^(github\.com|([a-z0-9-]+\.)*(githubusercontent|githubassets)\.com)$/

function mediaOk(src: string) {
  try {
    const u = new URL(src)
    return u.protocol === 'https:' && MEDIA_HOST.test(u.hostname)
  } catch {
    return false
  }
}

const purify = DOMPurify(window)
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noreferrer')
  }
  // Classes from a pull request must not pick up the app's own styles.
  const classes = [...node.classList].filter((c) => /^(pl-|markdown-alert|emoji$)/.test(c))
  if (classes.length) node.setAttribute('class', classes.join(' '))
  else node.removeAttribute('class')
  if (node.hasAttribute('src') && !mediaOk(node.getAttribute('src')!)) return node.remove()
  if (node.tagName === 'IMG' || node.tagName === 'VIDEO') node.setAttribute('referrerpolicy', 'no-referrer')
  if (node.tagName === 'VIDEO') {
    node.setAttribute('controls', '')
    node.setAttribute('preload', 'metadata')
  }
})

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export const markdown = (text: string) => !purify.isSupported ? `<pre>${escape(text)}</pre>` : purify.sanitize(marked.parse(text, { async: false, gfm: true }) as string, { FORBID_TAGS: ['img', 'picture', 'video', 'audio', 'iframe', 'style', 'form', 'button'], FORBID_ATTR: ['style'] })

export const githubHtml = (html: string, text: string) =>
  !purify.isSupported
    ? markdown(text)
    : purify.sanitize(html, {
        USE_PROFILES: { html: true },
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ['picture', 'source', 'track', 'audio', 'iframe', 'style', 'form', 'button'],
        FORBID_ATTR: ['style', 'srcset', 'poster', 'background', 'autoplay', 'muted', 'loop'],
      })

export interface HunkLine {
  n: number
  kind: 'add' | 'del' | 'ctx'
  text: string
  target: boolean
}

// GitHub's diff hunk for a comment ends on the commented line, so the code it is about is the tail.
export function hunkLines(hunk: string, span: number, keep = 6): HunkLine[] {
  const [head, ...rest] = hunk.split('\n')
  const start = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(head)
  if (!start) return []
  let oldNo = Number(start[1])
  let newNo = Number(start[2])
  const lines = rest
    .filter((l) => l && !l.startsWith('\\'))
    .map((l): HunkLine => {
      const kind = l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'ctx'
      const n = kind === 'del' ? oldNo : newNo
      if (kind !== 'add') oldNo++
      if (kind !== 'del') newNo++
      return { n, kind, text: l.slice(1), target: false }
    })
  const first = lines.length - span
  return lines.map((l, i) => ({ ...l, target: i >= first })).slice(-Math.max(keep, span))
}

export const firstLine = (text: string) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[#*_`>|]/g, '').trim())
    .find((l) => /\w/.test(l)) ?? ''

const when = (iso: string) => ago(Date.parse(iso) / 1000)

const CHECK_ICON: Record<CheckState, string> = { pass: 'pass-filled', fail: 'error', running: 'loading', cancelled: 'circle-slash', skipped: 'dash' }
const STATE_LABEL = { OPEN: 'Open', DRAFT: 'Draft', MERGED: 'Merged', CLOSED: 'Closed' }
const REVIEW: Record<string, Chip> = {
  APPROVED: { cls: 'pass', icon: 'pass-filled', text: 'approved' },
  CHANGES_REQUESTED: { cls: 'fail', icon: 'request-changes', text: 'requested changes' },
  COMMENTED: { cls: '', icon: 'comment', text: 'reviewed' },
  DISMISSED: { cls: '', icon: 'circle-slash', text: 'had a review dismissed' },
}
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

function usePrConversation(be: Backend, number: number, active: boolean, stamp: unknown) {
  const [talk, setTalk] = useState<PrConversation & { epoch: number }>()
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const epoch = useRef(0)
  const renewed = useRef(0)
  useEffect(() => {
    if (!active) return
    let live = true
    const e = epoch.current
    be.prConversation!(number).then(
      (x) => live && (setTalk({ ...x, epoch: e }), setFailed(false)),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [active, stamp, tick, number])
  // Media URLs are signed for five minutes, so a video played later fails until it gets a new one.
  const renew = () => {
    if (Date.now() - renewed.current < 60000) return
    renewed.current = Date.now()
    epoch.current++
    setTick((n) => n + 1)
  }
  return { talk, failed, renew }
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

function Md(p: { text: string; html: string; epoch: number }) {
  // Every read signs the media URLs anew, so unchanged text keeps its HTML or images would reload and videos restart.
  const html = useMemo(() => githubHtml(p.html, p.text), [p.text, p.epoch])
  return <div class="md" dangerouslySetInnerHTML={{ __html: html }} />
}

function Face({ name, url }: { name: string; url: string }) {
  return (
    <span class="avatar pr-face" title={name} style={{ '--c': 'var(--link)' }}>
      {url ? <img src={url} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  )
}

const Time = ({ n }: { n: PrNote }) => (
  <a class="dim" href={webUrl(n.url)} target="_blank" rel="noreferrer" title="Open on GitHub">
    {when(n.at)}
  </a>
)

function Note({ n, epoch, verb }: { n: PrNote; epoch: number; verb?: string }) {
  return (
    <div class="pr-note">
      <div class="pr-note-head">
        <Face name={n.author} url={n.avatar} />
        <b>{n.author}</b>
        {verb && <span class="dim">{verb}</span>}
        <Time n={n} />
      </div>
      <Md text={n.text} html={n.html} epoch={epoch} />
    </div>
  )
}

function BotNote({ n, epoch }: { n: PrNote; epoch: number }) {
  return (
    <details class="pr-fold">
      <summary>
        <Icon name="chevron-right" />
        <b>{n.author}</b>
        <span class="dim excerpt">{firstLine(n.text)}</span>
        <Time n={n} />
      </summary>
      <Md text={n.text} html={n.html} epoch={epoch} />
    </details>
  )
}

function Thread({ t, epoch }: { t: PrThread; epoch: number }) {
  const span = t.line && t.startLine ? t.line - t.startLine + 1 : 1
  const lines = hunkLines(t.hunk, span)
  const cut = t.path.lastIndexOf('/') + 1
  const replies = t.notes.length - 1
  return (
    <details class={`pr-thread ${t.resolved ? 'resolved' : ''}`} open={!t.resolved}>
      <summary>
        <Icon name="chevron-right" />
        <span class="path" title={t.path}>
          <span class="dir">{t.path.slice(0, cut)}</span>
          <span class="file">{t.path.slice(cut)}</span>
        </span>
        {t.line && <span class="dim">{span > 1 ? `lines ${t.startLine}–${t.line}` : `line ${t.line}`}</span>}
        <span class="spacer" />
        {replies > 0 && <span class="dim">{replies === 1 ? '1 reply' : `${replies} replies`}</span>}
        {t.outdated && <span class="pr-chip warn">Outdated</span>}
        {t.resolved && <span class="pr-chip pass">Resolved</span>}
      </summary>
      {lines.length > 0 && (
        <div class="pr-hunk">
          {lines.map((l, i) => (
            <div key={i} class={`${l.kind} ${l.target ? 'target' : ''}`}>
              <span class="n">{l.n}</span>
              <span class="t">{l.text}</span>
            </div>
          ))}
        </div>
      )}
      <div class="pr-notes">
        {t.notes.map((n) => (
          <Note key={n.id} n={n} epoch={epoch} />
        ))}
      </div>
    </details>
  )
}

function Conversation({ talk }: { talk: PrConversation & { epoch: number } }) {
  const { comments, reviews, threads, epoch } = talk
  const open = threads.filter((t) => !t.resolved).length
  const said = comments.filter((c) => !c.bot).length
  const entries = [
    ...comments.map((c) => ({ at: c.at, key: c.id, dot: 'comment', cls: '', el: c.bot ? <BotNote n={c} epoch={epoch} /> : <Note n={c} epoch={epoch} /> })),
    ...threads.map((t) => ({ at: t.notes[0].at, key: t.id, dot: 'comment-discussion', cls: t.resolved ? 'pass' : '', el: <Thread t={t} epoch={epoch} /> })),
    ...reviews.map((r) => {
      const review = REVIEW[r.state] ?? { cls: '', icon: 'eye', text: r.state.toLowerCase() }
      const el = r.bot && r.text.trim() ? <BotNote n={r} epoch={epoch} /> : r.text.trim() ? <Note n={r} epoch={epoch} verb={review.text} /> : (
        <div class="pr-event">
          <b>{r.author}</b> <span class="dim">{review.text}</span> <Time n={r} />
        </div>
      )
      return { at: r.at, key: r.id, dot: review.icon, cls: review.cls, el }
    }),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return (
    <>
      <h2 class="pr-section">
        Conversation
        <span class="dim">{[said && `${said} ${said === 1 ? 'comment' : 'comments'}`, threads.length && (open ? `${open} of ${threads.length} ${threads.length === 1 ? 'thread' : 'threads'} open` : `${threads.length} resolved`)].filter(Boolean).join(' · ')}</span>
      </h2>
      {entries.length === 0 ? (
        <div class="dim">No comments yet.</div>
      ) : (
        <div class="pr-timeline">
          {entries.map((e) => (
            <div key={e.key} class="pr-entry">
              <span class={`pr-dot ${e.cls}`}>
                <Icon name={e.dot} />
              </span>
              <div class="pr-entry-main">{e.el}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function Zoom({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null)
  useEffect(() => box.current?.showModal(), [])
  return (
    <dialog ref={box} class="pr-zoom" aria-label="Image" onClose={onClose} onClick={onClose}>
      <img src={src} alt={alt} referrerpolicy="no-referrer" />
    </dialog>
  )
}

export function PrView(p: PrHandlers & { be: Backend; pr: PullRequest; active: boolean; stamp: unknown }) {
  const { d, failed } = usePrDetail(p.be, p.pr.number, p.active, p.stamp)
  const { talk, failed: talkFailed, renew } = usePrConversation(p.be, p.pr.number, p.active, p.stamp)
  const [zoom, setZoom] = useState<{ src: string; alt: string }>()
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!p.active) root.current?.querySelectorAll('video').forEach((v) => v.pause())
  }, [p.active])
  if (!d) return <div class="placeholder">{failed ? 'Could not read this pull request from GitHub.' : 'Loading…'}</div>
  const showImage = (e: MouseEvent) => {
    const img = (e.target as Element).closest<HTMLImageElement>('.md img:not(.emoji)')
    if (!img) return
    e.preventDefault()
    setZoom({ src: img.src, alt: img.alt })
  }
  return (
    <div class="pr-view" ref={root} onClick={showImage} onErrorCapture={(e) => (e.target as Element).closest('.md') && renew()}>
      <div class="pr-inner">
        <h1>
          {d.title} <span class="num">#{d.number}</span>
        </h1>
        <div class="pr-meta">
          <span class={`pr-state ${d.state.toLowerCase()}`}>
            <Icon name={PR_ICON[d.state]} />
            {STATE_LABEL[d.state]}
          </span>
          <Face name={d.author} url={talk?.avatar ?? ''} />
          <b>{d.author}</b>
          <span class="dim">{when(d.createdAt)}</span>
          <span class="pr-branches">
            <code>{d.head}</code>
            <Icon name="arrow-right" />
            <code>{d.base}</code>
          </span>
          <a class="pr-open" href={webUrl(d.url)} target="_blank" rel="noreferrer" title="Open on GitHub">
            <Icon name="link-external" />
            GitHub
          </a>
        </div>
        <div class="pr-bar">
          <PrStatus d={d} />
          <PrActions d={d} pr={p.pr} busy={p.busy} onMerge={p.onMerge} onChange={p.onChange} />
        </div>

        {d.checks.length > 0 && (
          <details class="pr-checks" open={d.checks.some((c) => c.state === 'fail')}>
            <summary>
              <Icon name="chevron-right" />
              Checks <span class="dim">{d.checks.length}</span>
            </summary>
            {d.checks.map((c, i) => (
              <a key={i} class={`check ${c.state}`} href={webUrl(c.url)} target="_blank" rel="noreferrer">
                <Icon name={CHECK_ICON[c.state]} />
                <span class="name">{c.workflow ? `${c.workflow} / ${c.name}` : c.name}</span>
                <span class="dim">{c.state}</span>
              </a>
            ))}
          </details>
        )}

        <div class="pr-desc">{!d.body.trim() ? <div class="dim">No description.</div> : talk ? <Md text={talk.text} html={talk.html} epoch={talk.epoch} /> : <div class="md" dangerouslySetInnerHTML={{ __html: markdown(d.body) }} />}</div>

        {talk ? <Conversation talk={talk} /> : <div class="pr-section dim">{talkFailed ? 'Could not load the comments from GitHub.' : 'Loading comments…'}</div>}
      </div>
      {zoom && <Zoom {...zoom} onClose={() => setZoom(undefined)} />}
    </div>
  )
}
