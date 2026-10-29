import { useEffect, useState } from 'preact/hooks'

export const LANES = 10

export function Laptop() {
  return (
    <svg class="codicon laptop" width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
      <rect x="3" y="3.5" width="10" height="7" rx="1" />
      <path d="M1.5 12.5h13" stroke-linecap="round" />
    </svg>
  )
}

export function Icon({ name }: { name: string }) {
  return <i class={`codicon codicon-${name}`} aria-hidden="true" />
}

export async function settleLimited<T>(tasks: (() => Promise<T>)[], limit: number, onSettled: (done: number) => void): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = []
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]().then(
        (value) => ({ status: 'fulfilled', value }) as const,
        (reason) => ({ status: 'rejected', reason }) as const,
      )
      onSettled(++done)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

export function BrandMark() {
  return <span class="brand-mark" aria-hidden="true" />
}

export function BrandLinks() {
  return (
    <>
      <span class="sep" />
      <a class="tb-link" href="https://a-ahandani.github.io/ramulus/" target="_blank" rel="noreferrer" title="Ramulus website" aria-label="Ramulus website">
        <Icon name="globe" />
      </a>
      <a class="tb-link" href="https://github.com/a-ahandani/ramulus" target="_blank" rel="noreferrer" title="Ramulus on GitHub" aria-label="Ramulus on GitHub">
        <Icon name="github" />
      </a>
    </>
  )
}

export function laneColor(col: number): string {
  return `var(--lane-${col % LANES})`
}

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const a = parts[0]?.[0] ?? '?'
  const b = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (a + b).toUpperCase()
}

export function short(oid: string): string {
  return oid.slice(0, 7)
}

export function fmtDate(t: number): string {
  return new Date(t * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function ago(t: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - t)
  const units: [number, string][] = [
    [365 * 86400, 'year'],
    [30 * 86400, 'month'],
    [7 * 86400, 'week'],
    [86400, 'day'],
    [3600, 'hour'],
  ]
  for (const [len, name] of units) {
    if (s >= len) {
      const n = Math.floor(s / len)
      return `${n} ${name}${n === 1 ? '' : 's'} ago`
    }
  }
  return 'less than an hour ago'
}

const hashes = new Map<string, string>()

async function emailHash(email: string): Promise<string> {
  const key = email.trim().toLowerCase()
  const hit = hashes.get(key)
  if (hit) return hit
  const data = new TextEncoder().encode(key)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  hashes.set(key, hex)
  return hex
}

export function Avatar({ name, email, color, size = 20 }: { name: string; email: string; color: string; size?: number }) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    if (!email || !crypto.subtle) {
      setUrl(undefined)
      return
    }
    emailHash(email).then((h) => live && setUrl(`https://www.gravatar.com/avatar/${h}?s=64&d=404`))
    return () => {
      live = false
    }
  }, [email])
  const photo = !!url && !failed
  const letters = size < 20 ? initials(name).slice(0, 1) : initials(name)
  return (
    <span class="avatar" style={{ '--c': color, width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * (letters.length > 1 ? 0.4 : 0.5))}px` }} title={name}>
      {photo ? <img src={url} alt="" onError={() => setFailed(true)} /> : letters}
    </span>
  )
}
