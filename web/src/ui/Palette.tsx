import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

export interface Command {
  id: string
  label: string
  hint?: string
  group: string
  run: () => void
}

export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.includes(q)) return 100 - t.indexOf(q)
  let ti = 0
  let score = 0
  for (const ch of q) {
    const at = t.indexOf(ch, ti)
    if (at < 0) return 0
    score += at === ti ? 3 : 1
    ti = at + 1
  }
  return score
}

export function Palette({ commands, onClose, placeholder = 'Type a command, a branch, or a file', extra }: { commands: Command[]; onClose: () => void; placeholder?: string; extra?: (query: string) => Command[] }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const matches = useMemo(() => {
    const scored = commands.map((c) => ({ c, s: fuzzyScore(query, `${c.group} ${c.label}`) })).filter((x) => x.s > 0)
    scored.sort((a, b) => b.s - a.s)
    return [...(extra?.(query) ?? []), ...scored.slice(0, 40).map((x) => x.c)]
  }, [commands, query, extra])
  useEffect(() => setCursor(0), [query])
  const pick = (c: Command) => {
    onClose()
    c.run()
  }
  return (
    <div class="overlay top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div class="palette">
        <input
          ref={input}
          placeholder={placeholder}
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(matches.length - 1, c + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(0, c - 1))
            } else if (e.key === 'Enter' && matches[cursor]) {
              e.preventDefault()
              pick(matches[cursor])
            } else if (e.key === 'Escape') {
              e.stopPropagation()
              onClose()
            }
          }}
        />
        <div class="list">
          {matches.map((c, i) => (
            <div key={c.id} class={`cmd ${i === cursor ? 'active' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => pick(c)}>
              <span class="group">{c.group}</span>
              <span class="label">{c.label}</span>
              {c.hint && <span class="hint">{c.hint}</span>}
            </div>
          ))}
          {matches.length === 0 && <div class="cmd empty">Nothing matches</div>}
        </div>
      </div>
    </div>
  )
}
