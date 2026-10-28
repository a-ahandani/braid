import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ResetMode } from '../git/backend'
import type { NetSettings } from '../git/repo'
import { Icon } from './bits'

export type Dialog =
  | { kind: 'branch'; at: string; name?: string }
  | { kind: 'tag'; at: string }
  | { kind: 'rename'; old: string }
  | { kind: 'stash' }
  | { kind: 'reset'; at: string }
  | { kind: 'confirm'; message: string; action: () => void }
  | { kind: 'error'; title: string; message: string }
  | { kind: 'settings' }
  | { kind: 'push-rejected'; branch: string; ahead: number; behind: number; rebase: () => void; merge: () => void; force: () => void }
  | { kind: 'repos'; folder: string; repos: { dir: string; name: string }[]; open: (dirs: string[]) => void }

export interface DialogProps {
  dialog: Dialog
  settings: NetSettings
  native: boolean
  onClose: () => void
  onCreateBranch: (name: string, at: string, checkout: boolean) => void
  onCreateTag: (name: string, at: string, message: string) => void
  onRename: (old: string, name: string) => void
  onStash: (message: string) => void
  onReset: (at: string, mode: ResetMode) => void
  onSettings: (s: NetSettings) => void
  onSuggestBranch?: (at: string) => void
  suggesting?: boolean
}

function validRef(name: string): boolean {
  return name.length > 0 && !name.startsWith('-') && !/[\s~^:?*[\\]|\.\.|@\{|\/$|\.$|^\/|\/\/|\.lock$/.test(name) && name !== '@'
}

export function Frame({ title, children, onClose, cls = '' }: { title: string; children: ComponentChildren; onClose: () => void; cls?: string }) {
  return (
    <div class={`overlay ${cls}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export function Buttons({ ok, danger, enabled, onOk, onClose }: { ok: string; danger?: boolean; enabled: boolean; onOk: () => void; onClose: () => void }) {
  return (
    <div class="buttons">
      <button onClick={onClose}>Cancel</button>
      <button class={danger ? 'danger' : 'primary'} disabled={!enabled} onClick={onOk}>
        {ok}
      </button>
    </div>
  )
}

export function Dialogs(p: DialogProps) {
  const d = p.dialog
  const [name, setName] = useState(d.kind === 'rename' ? d.old : '')
  const [message, setMessage] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(d.kind === 'repos' ? d.repos.map((r) => r.dir) : []))
  const [net, setNet] = useState(p.settings)
  const first = useRef<HTMLInputElement>(null)
  useEffect(() => first.current?.focus(), [])
  const suggested = d.kind === 'branch' ? d.name : undefined
  useEffect(() => {
    if (suggested) setName(suggested)
  }, [suggested])
  const submit = (enabled: boolean, fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' && enabled && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault()
      fn()
      p.onClose()
    }
  }
  switch (d.kind) {
    case 'branch': {
      const ok = validRef(name)
      const go = () => p.onCreateBranch(name, d.at, checkout)
      return (
        <Frame title="Name the new branch" onClose={p.onClose}>
          <div class="input-row">
            <input ref={first} placeholder="branch name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={submit(ok, go)} />
            {p.onSuggestBranch && (
              <button
                class={`icon ${p.suggesting ? 'spin' : ''}`}
                title={p.suggesting ? 'Suggesting. Click to stop' : 'Suggest a name with your AI agent'}
                aria-label={p.suggesting ? 'Stop suggesting' : 'Suggest a name with your AI agent'}
                onClick={() => p.onSuggestBranch!(d.at)}
              >
                <Icon name={p.suggesting ? 'loading' : 'sparkle'} />
              </button>
            )}
          </div>
          <label>
            <input type="checkbox" checked={checkout} onChange={(e) => setCheckout((e.target as HTMLInputElement).checked)} /> Switch to it right away
          </label>
          {name && !ok && <div class="error">That is not a valid branch name</div>}
          <Buttons ok="Create" enabled={ok} onOk={() => (go(), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
    }
    case 'tag': {
      const ok = validRef(name)
      const go = () => p.onCreateTag(name, d.at, message)
      return (
        <Frame title="Name the new tag" onClose={p.onClose}>
          <input ref={first} placeholder="tag name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={submit(ok, go)} />
          <textarea placeholder="Message for an annotated tag (optional)" value={message} onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)} />
          {name && !ok && <div class="error">That is not a valid tag name</div>}
          <Buttons ok="Create" enabled={ok} onOk={() => (go(), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
    }
    case 'rename': {
      const ok = validRef(name) && name !== d.old
      const go = () => p.onRename(d.old, name)
      return (
        <Frame title={`Rename '${d.old}' to`} onClose={p.onClose}>
          <input ref={first} placeholder="new name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={submit(ok, go)} />
          <Buttons ok="Rename" enabled={ok} onOk={() => (go(), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
    }
    case 'stash': {
      const go = () => p.onStash(message)
      return (
        <Frame title="Stash everything" onClose={p.onClose}>
          <input ref={first} placeholder="Short note for this stash" value={message} onInput={(e) => setMessage((e.target as HTMLInputElement).value)} onKeyDown={submit(true, go)} />
          <Buttons ok="Stash" enabled={true} onOk={() => (go(), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
    }
    case 'reset':
      return (
        <Frame title={`Reset the branch to ${d.at.slice(0, 7)}`} onClose={p.onClose}>
          <button onClick={() => (p.onReset(d.at, 'soft'), p.onClose())}>Soft: keep everything staged and in the working tree</button>
          {p.native && <button onClick={() => (p.onReset(d.at, 'mixed'), p.onClose())}>Mixed: keep the working tree, clear the index</button>}
          <button class="danger" onClick={() => (p.onReset(d.at, 'hard'), p.onClose())}>
            Hard: drop the index and the working tree
          </button>
          <div class="buttons">
            <button onClick={p.onClose}>Cancel</button>
          </div>
        </Frame>
      )
    case 'confirm':
      return (
        <Frame title="Please confirm" onClose={p.onClose}>
          <div>{d.message}</div>
          <Buttons ok="Yes" danger enabled={true} onOk={() => (d.action(), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
    case 'repos': {
      const n = picked.size
      return (
        <Frame title="Open the repositories in this folder?" onClose={p.onClose}>
          <div>
            <code>{d.folder}</code> is not a git repository. It has {d.repos.length === 1 ? 'one repository' : `${d.repos.length} repositories`} inside, and each one you pick opens in its own tab.
          </div>
          <div class="repo-list">
            {d.repos.map((r, i) => (
              <label key={r.dir} title={r.dir}>
                <input
                  ref={i === 0 ? first : undefined}
                  type="checkbox"
                  checked={picked.has(r.dir)}
                  onChange={() =>
                    setPicked((s) => {
                      const next = new Set(s)
                      if (next.has(r.dir)) next.delete(r.dir)
                      else next.add(r.dir)
                      return next
                    })
                  }
                />
                {r.name}
                <span class="path">{r.dir.slice(d.folder.length).replace(/^[/\\]/, '')}</span>
              </label>
            ))}
          </div>
          <Buttons ok={n === 1 ? 'Open 1 repository' : `Open ${n} repositories`} enabled={n > 0} onOk={() => (d.open(d.repos.filter((r) => picked.has(r.dir)).map((r) => r.dir)), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
    }
    case 'push-rejected': {
      const n = (k: number) => `${k} commit${k === 1 ? '' : 's'}`
      return (
        <Frame title="The remote has commits you don't have" onClose={p.onClose}>
          <div>
            {d.branch} on the remote has {n(d.behind)} you don't have yet, and you have {n(d.ahead)} it doesn't. A normal push would drop theirs, so git refused it.
          </div>
          <button class="choice" onClick={() => (d.rebase(), p.onClose())}>
            <b>Rebase onto theirs, then push</b>
            <span>Puts your {n(d.ahead)} on top of theirs. Keeps history straight. Recommended.</span>
          </button>
          <button class="choice" onClick={() => (d.merge(), p.onClose())}>
            <b>Merge theirs, then push</b>
            <span>Adds a merge commit that joins both sides.</span>
          </button>
          <button class="choice danger" onClick={() => (d.force(), p.onClose())}>
            <b>Force push</b>
            <span>Replaces the remote branch with yours and drops their {n(d.behind)}. Stops if the remote changes again first.</span>
          </button>
          <div class="buttons">
            <button onClick={p.onClose}>Cancel</button>
          </div>
        </Frame>
      )
    }
    case 'error':
      return (
        <Frame title={d.title} onClose={p.onClose}>
          <pre>{d.message}</pre>
          <div class="buttons">
            <button class="primary" onClick={p.onClose}>
              OK
            </button>
          </div>
        </Frame>
      )
    case 'settings':
      return (
        <Frame title="Settings" onClose={p.onClose}>
          <div class="label">Your name and email for commits (used when the repository has no user.name)</div>
          <input ref={first} placeholder="Name" value={net.authorName} onInput={(e) => setNet({ ...net, authorName: (e.target as HTMLInputElement).value })} />
          <input placeholder="Email" value={net.authorEmail} onInput={(e) => setNet({ ...net, authorEmail: (e.target as HTMLInputElement).value })} />
          <div class="label">CORS proxy, required for fetch, pull and push (git hosts block direct browser requests)</div>
          <input placeholder="https://your-proxy.example.com" value={net.corsProxy} onInput={(e) => setNet({ ...net, corsProxy: (e.target as HTMLInputElement).value })} />
          <div class="label">Username (optional, defaults to a token login)</div>
          <input value={net.username} onInput={(e) => setNet({ ...net, username: (e.target as HTMLInputElement).value })} />
          <div class="label">Personal access token (kept only until this tab closes)</div>
          <input type="password" value={net.token} onInput={(e) => setNet({ ...net, token: (e.target as HTMLInputElement).value })} />
          <Buttons ok="Save" enabled={true} onOk={() => (p.onSettings(net), p.onClose())} onClose={p.onClose} />
        </Frame>
      )
  }
}
