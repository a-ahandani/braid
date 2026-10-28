import { get, set } from 'idb-keyval'
import { useEffect, useRef, useState } from 'preact/hooks'
import { FsaFs } from '../fs/fsa'
import type { Backend } from '../git/backend'
import { demoRepo } from '../git/demo'
import { helperShell, httpBackend, type RepoInfo } from '../git/remote'
import { localBackend } from '../git/repo'
import { App, loadSettings, type Theme } from './App'
import { Icon } from './bits'
import { Dialogs, type Dialog } from './Dialogs'
import { Palette, type Command } from './Palette'

interface Tab {
  id: number
  key: string
  name: string
  title: string
  be: Backend
  handle?: FileSystemDirectoryHandle
}

const canPick = typeof window !== 'undefined' && 'showDirectoryPicker' in window
const token = typeof location !== 'undefined' && /^#[0-9a-f]{32}$/.test(location.hash) ? location.hash.slice(1) : undefined
const helper = token ? helperShell(location.origin, token) : undefined
const looksLikePath = /^(~|\/|\.|[A-Za-z]:[\\/]|\\\\)/

let nextId = 1

function initialTheme(): Theme {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('ramulus.theme')
  return saved === 'light' || saved === 'dark' ? saved : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

const fallbackAuthor = () => {
  const s = loadSettings()
  return s.authorName && s.authorEmail ? { name: s.authorName, email: s.authorEmail } : undefined
}

export function Shell() {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [active, setActive] = useState<number>()
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [picker, setPicker] = useState(false)
  const [recentRepos, setRecentRepos] = useState<RepoInfo[]>([])
  const [handles, setHandles] = useState<FileSystemDirectoryHandle[]>([])
  const [dialog, setDialog] = useState<Dialog>()
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const current = tabs.find((t) => t.id === active)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('ramulus.theme', theme)
  }, [theme])
  useEffect(() => {
    document.title = current ? `${current.name} · Ramulus` : 'Ramulus'
  }, [current])
  useEffect(() => {
    if (dirty.size === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [dirty.size])

  const fail = (title: string, e: unknown) => setDialog({ kind: 'error', title, message: e instanceof Error ? e.message : String(e) })

  const add = (tab: Omit<Tab, 'id'>) => {
    const hit = tabsRef.current.find((t) => t.key === tab.key)
    if (hit) return setActive(hit.id)
    const next = { ...tab, id: nextId++ }
    tabsRef.current = [...tabsRef.current, next]
    setTabs(tabsRef.current)
    setActive(next.id)
  }

  const drop = (id: number) => {
    const i = tabsRef.current.findIndex((t) => t.id === id)
    const rest = tabsRef.current.filter((t) => t.id !== id)
    tabsRef.current = rest
    setTabs(rest)
    setDirty((d) => (d.has(id) ? new Set([...d].filter((x) => x !== id)) : d))
    setActive((a) => (a === id ? rest[Math.min(i, rest.length - 1)]?.id : a))
  }

  const close = (id: number) => {
    const t = tabsRef.current.find((x) => x.id === id)
    if (t && dirty.has(id)) setDialog({ kind: 'confirm', message: `Unsaved edits in ${t.name} will be lost. Continue?`, action: () => drop(id) })
    else drop(id)
  }

  const markDirty = (id: number, d: boolean) =>
    setDirty((s) => {
      if (s.has(id) === d) return s
      const next = new Set(s)
      if (d) next.add(id)
      else next.delete(id)
      return next
    })

  const openInfo = (info: RepoInfo) => add({ key: info.dir, name: info.name, title: info.dir, be: httpBackend(location.origin, token!, info.dir) })

  const openPath = async (path: string) => {
    try {
      openInfo(await helper!.openRepo(path))
      setRecentRepos((await helper!.repos()).recent)
    } catch (e) {
      fail('Could not open the repository', e)
    }
  }

  const browse = async () => {
    try {
      const path = await helper!.pickFolder()
      if (path) await openPath(path)
    } catch (e) {
      fail('Could not show a folder picker', e)
    }
  }

  const openHandle = async (handle: FileSystemDirectoryHandle) => {
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return
    const same = await Promise.all(handles.map((h) => h.isSameEntry(handle).catch(() => false)))
    const list = [handle, ...handles.filter((_, i) => !same[i])].slice(0, 10)
    setHandles(list)
    await set('recent', list)
    const open = await Promise.all(tabsRef.current.map((t) => t.handle?.isSameEntry(handle).catch(() => false)))
    const hit = tabsRef.current.find((_, i) => open[i])
    if (hit) return setActive(hit.id)
    add({ key: `fs:${nextId}`, name: handle.name, title: handle.name, handle, be: localBackend({ fs: new FsaFs(handle), dir: '/', cache: {}, fallbackAuthor }, loadSettings) })
  }

  const pickFolder = async () => {
    try {
      await openHandle(await window.showDirectoryPicker({ mode: 'readwrite' }))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail('Could not open the folder', e)
    }
  }

  const openDemo = () =>
    demoRepo()
      .then((ctx) => add({ key: 'demo', name: 'demo', title: 'Demo repository', be: localBackend(ctx, loadSettings) }))
      .catch((e) => fail('Could not build the demo', e))

  useEffect(() => {
    if (helper)
      helper
        .repos()
        .then(({ current, recent }) => {
          openInfo(current)
          setRecentRepos(recent)
        })
        .catch((e) => fail('Could not reach the helper', e))
    else get<FileSystemDirectoryHandle[]>('recent').then((r) => r && setHandles(r))
  }, [])

  const choices: Command[] = helper
    ? [{ id: 'browse', group: 'Open', label: 'Browse for a folder…', run: browse }, ...recentRepos.filter((r) => !tabs.some((t) => t.key === r.dir)).map((r) => ({ id: r.dir, group: 'Recent', label: r.name, hint: r.dir, run: () => openPath(r.dir) }))]
    : [
        ...(canPick ? [{ id: 'pick', group: 'Open', label: 'Open a folder…', run: pickFolder }] : []),
        { id: 'demo', group: 'Open', label: 'Demo repository', run: openDemo },
        ...handles.map((h, i) => ({ id: `h${i}`, group: 'Recent', label: h.name, run: () => openHandle(h).catch((e) => fail('Could not open the folder', e)) })),
      ]
  const typedPath = (q: string): Command[] => (helper && looksLikePath.test(q.trim()) ? [{ id: 'path', group: 'Open', label: q.trim(), hint: 'Open this path', run: () => openPath(q.trim()) }] : [])
  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <div class="shell">
      {tabs.length > 0 && (
        <div class="repo-tabs" role="tablist">
          {tabs.map((t) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              class={`repo-tab ${t.id === active ? 'active' : ''}`}
              title={t.title}
              tabIndex={0}
              onClick={() => setActive(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                setActive(t.id)
              }}
              onMouseDown={(e) => {
                if (e.button !== 1) return
                e.preventDefault()
                close(t.id)
              }}
            >
              <Icon name="repo" />
              <span class="name">{t.name}</span>
              <button
                class="icon close"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation()
                  close(t.id)
                }}
              >
                <Icon name="close" />
              </button>
            </div>
          ))}
          <button class="icon add" title="Open repository…" onClick={() => setPicker(true)}>
            <Icon name="add" />
          </button>
        </div>
      )}
      {tabs.map((t) => (
        <div key={t.id} class="tab-page" hidden={t.id !== active}>
          <App be={t.be} active={t.id === active} theme={theme} onTheme={setTheme} onOpenRepo={() => setPicker(true)} onDirty={(d) => markDirty(t.id, d)} />
        </div>
      ))}
      {tabs.length === 0 && (
        <div class="app">
          <div class="toolbar">
            <span class="repo">Ramulus</span>
          </div>
          <div class="welcome">
            <h1>
              <Icon name="source-control" />
              Ramulus
            </h1>
            <p>Every branch of your repository, in one graph.{helper ? '' : ' Runs entirely in this browser tab.'}</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              {helper ? (
                <button class="primary" onClick={() => setPicker(true)}>
                  Open repository…
                </button>
              ) : (
                <>
                  {canPick && (
                    <button class="primary" onClick={pickFolder}>
                      Open a repository folder
                    </button>
                  )}
                  <button class="secondary" onClick={openDemo}>
                    Try the demo repository
                  </button>
                </>
              )}
            </div>
            {!helper && !canPick && <p class="note">Opening folders needs the File System Access API, which Chrome, Edge and other Chromium browsers provide. Safari and Firefox can only run the demo.</p>}
            {(helper ? recentRepos.length : handles.length) > 0 && (
              <div class="recent">
                <span class="label">Recent</span>
                {helper
                  ? recentRepos.map((r) => (
                      <a key={r.dir} title={r.dir} onClick={() => openPath(r.dir)}>
                        {r.name}
                      </a>
                    ))
                  : handles.map((h, i) => (
                      <a key={i} onClick={() => openHandle(h).catch((e) => fail('Could not open the folder', e))}>
                        {h.name}
                      </a>
                    ))}
              </div>
            )}
            {!helper && (
              <>
                <p class="note">Nothing leaves your machine except avatar lookups on gravatar.com and, when you use them, fetch, pull and push through the CORS proxy you set under Settings.</p>
                <p class="note">
                  For full speed and your SSH keys, run <code>npx ramulus</code> inside a repository instead.
                </p>
              </>
            )}
          </div>
          <div class="statusbar">
            <span class="spacer" />
            <button onClick={toggleTheme} title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
              <Icon name="color-mode" />
            </button>
          </div>
        </div>
      )}
      {picker && <Palette commands={choices} extra={typedPath} placeholder={helper ? 'Type a path, or pick a recent repository' : 'Pick a repository'} onClose={() => setPicker(false)} />}
      {dialog && (
        <Dialogs
          dialog={dialog}
          settings={loadSettings()}
          native={!!helper}
          onClose={() => setDialog(undefined)}
          onCreateBranch={() => {}}
          onCreateTag={() => {}}
          onRename={() => {}}
          onStash={() => {}}
          onReset={() => {}}
          onSettings={() => {}}
        />
      )}
    </div>
  )
}
