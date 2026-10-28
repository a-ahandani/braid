import type { Extension } from '@codemirror/state'
import { Compartment, EditorState, Text } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { MergeView, getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge'
import { oneDark } from '@codemirror/theme-one-dark'
import { minimalSetup } from 'codemirror'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { applyChunk, type ChunkRange } from '../git/chunk'

export type DiffMode = 'inline' | 'split'

export interface ChunkAction {
  label: string
  danger?: boolean
  into: 'a' | 'b'
  run: (text: string) => void
}

export interface DiffEditorProps {
  oldText: string
  newText: string
  filename: string
  mode: DiffMode
  dark: boolean
  wrap: boolean
  editable: boolean
  dirty: boolean
  actions: ChunkAction[]
  onDirty: (dirty: boolean) => void
  handle?: (h: DiffEditorHandle) => void
}

export interface DiffEditorHandle {
  next: () => void
  prev: () => void
  text: () => string
}

const langCache = new Map<string, Promise<Extension>>()

function languageFor(filename: string): Promise<Extension> | undefined {
  const desc = LanguageDescription.matchFilename(languages, filename)
  if (!desc) return undefined
  let p = langCache.get(desc.name)
  if (!p) {
    p = desc.load().then((s) => s.extension)
    langCache.set(desc.name, p)
  }
  return p
}

interface Control {
  top: number
  chunk: ChunkRange
}

export function DiffEditor(p: DiffEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const [controls, setControls] = useState<Control[]>([])
  const views = useRef<{ main: EditorView; merge?: MergeView; lang: Compartment; wrapC: Compartment; themeC: Compartment } | undefined>(undefined)

  useLayoutEffect(() => {
    const parent = host.current
    if (!parent) return
    const lang = new Compartment()
    const wrapC = new Compartment()
    const themeC = new Compartment()
    const sep = /\r\n/.test(p.newText || p.oldText) ? '\r\n' : '\n'
    const shared = [minimalSetup, lineNumbers(), EditorState.lineSeparator.of(sep), themeC.of(p.dark ? oneDark : []), wrapC.of(p.wrap ? EditorView.lineWrapping : []), lang.of([])]
    let main: EditorView
    let merge: MergeView | undefined
    const measure = () => {
      const chunks = getChunks(main.state)?.chunks ?? []
      const rect = parent.getBoundingClientRect()
      const out: Control[] = []
      for (const c of chunks) {
        const pos = Math.min(c.fromB, main.state.doc.length)
        const coords = main.coordsAtPos(pos)
        if (!coords) continue
        out.push({ top: coords.top - rect.top, chunk: { fromA: c.fromA, toA: c.toA, fromB: c.fromB, toB: c.toB } })
      }
      setControls(out)
    }
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    const listener = EditorView.updateListener.of((u) => {
      if (u.docChanged) p.onDirty(u.state.sliceDoc() !== p.newText)
      if (u.docChanged || u.viewportChanged || u.geometryChanged) schedule()
    })
    const readOnly = EditorState.readOnly.of(!p.editable)
    if (p.mode === 'split') {
      merge = new MergeView({
        parent,
        orientation: 'a-b',
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
        a: { doc: p.oldText, extensions: [...shared, EditorState.readOnly.of(true)] },
        b: { doc: p.newText, extensions: [...shared, readOnly, listener] },
      })
      main = merge.b
    } else {
      main = new EditorView({
        parent,
        doc: p.newText,
        extensions: [
          ...shared,
          readOnly,
          listener,
          unifiedMergeView({ original: Text.of(p.oldText.split(sep)), highlightChanges: true, gutter: true, mergeControls: false, collapseUnchanged: { margin: 3, minSize: 4 } }),
        ],
      })
    }
    views.current = { main, merge, lang, wrapC, themeC }
    languageFor(p.filename)?.then((ext) => {
      if (views.current?.main !== main) return
      main.dispatch({ effects: lang.reconfigure(ext) })
      merge?.a.dispatch({ effects: lang.reconfigure(ext) })
    })
    const scrollers = [main.scrollDOM, merge?.a.scrollDOM, merge?.dom].filter((s): s is HTMLElement => !!s)
    scrollers.forEach((s) => s.addEventListener('scroll', schedule))
    schedule()
    p.handle?.({
      next: () => goToNextChunk({ state: main.state, dispatch: main.dispatch.bind(main) }),
      prev: () => goToPreviousChunk({ state: main.state, dispatch: main.dispatch.bind(main) }),
      text: () => main.state.sliceDoc(),
    })
    return () => {
      cancelAnimationFrame(raf)
      scrollers.forEach((s) => s.removeEventListener('scroll', schedule))
      merge ? merge.destroy() : main.destroy()
      views.current = undefined
    }
  }, [p.oldText, p.newText, p.filename, p.mode, p.editable])

  useEffect(() => {
    const v = views.current
    if (!v) return
    for (const view of [v.main, v.merge?.a]) view?.dispatch({ effects: [v.wrapC.reconfigure(p.wrap ? EditorView.lineWrapping : []), v.themeC.reconfigure(p.dark ? oneDark : [])] })
  }, [p.wrap, p.dark])

  return (
    <div class={`diff-editor ${p.mode}`}>
      <div class="cm-host" ref={host} />
      {p.actions.length > 0 &&
        controls.map((c, i) => (
          <div class="chunk-ctl" key={i} style={{ top: `${c.top}px` }}>
            {p.actions.map((a) => (
              <button
                key={a.label}
                class={a.danger ? 'danger' : ''}
                disabled={p.dirty}
                title={p.dirty ? 'Save or revert your edits first' : undefined}
                onClick={() => {
                  const v = views.current
                  if (!v) return
                  const original = v.merge ? v.merge.a.state.doc : getOriginalDoc(v.main.state)
                  a.run(applyChunk(original, v.main.state.doc, c.chunk, a.into, v.main.state.lineBreak))
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        ))}
    </div>
  )
}
