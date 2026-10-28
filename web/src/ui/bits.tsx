import { useEffect, useState } from 'preact/hooks'

export const LANES = 10

export function Icon({ name }: { name: string }) {
  return <i class={`codicon codicon-${name}`} aria-hidden="true" />
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
