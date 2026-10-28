export interface Scheme {
  id: string
  name: string
  dark: boolean
  bg: string
  fg: string
  accent: string
  ansi: string[]
}

const HEX = /^#[0-9a-f]{6}$/i
export const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']

export function schemeSource(link: string): { id: string; url: string } | undefined {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return undefined
  }
  const m = /^\/themes\/([a-z0-9-]+)\/([a-z0-9-]+)\/?$/i.exec(url.pathname)
  if (url.hostname.replace(/^www\./, '') !== 'terminalcolors.com' || !m) return undefined
  const id = `${m[1]}-${m[2]}`.toLowerCase()
  return { id, url: `https://terminalcolors.com/downloads/warp/${id}.yaml` }
}

export function isScheme(s: unknown): s is Scheme {
  const x = s as Scheme
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.name === 'string' &&
    typeof x.dark === 'boolean' &&
    [x.bg, x.fg, x.accent].every((c) => HEX.test(c)) &&
    Array.isArray(x.ansi) &&
    x.ansi.length === 16 &&
    x.ansi.every((c) => HEX.test(c))
  )
}

export function parseScheme(text: string, id: string): Scheme {
  const top: Record<string, string> = {}
  const colors: Record<string, string> = {}
  let section = ''
  for (const line of text.split('\n')) {
    const m = /^(\s*)([a-z_]+):\s*"?([^"]*?)"?\s*$/i.exec(line)
    if (!m) continue
    const [, indent, key, value] = m
    if (!indent) top[key] = value
    else if (!value) section = key
    else colors[`${section}.${key}`] = value
  }
  const ansi = ['normal', 'bright'].flatMap((s) => COLORS.map((c) => colors[`${s}.${c}`]))
  const scheme = { id, name: top.name || id, dark: HEX.test(top.background) && luminance(top.background) < 0.4, bg: top.background, fg: top.foreground, accent: top.accent || ansi[4], ansi }
  if (!isScheme(scheme)) throw new Error('That theme did not come with a complete set of colors')
  return scheme
}

export async function loadScheme(link: string): Promise<Scheme> {
  const src = schemeSource(link)
  if (!src) throw new Error('Paste the link of a theme page, such as https://terminalcolors.com/themes/catppuccin/mocha/')
  const res = await fetch(src.url)
  if (!res.ok) throw new Error(res.status === 404 ? 'No theme was found at that link' : `The theme could not be downloaded (${res.status})`)
  return parseScheme(await res.text(), src.id)
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}

const alpha = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`

export function schemeVars(s: Scheme): Record<string, string> {
  const { bg, fg, accent, ansi: a, dark } = s
  const m = (t: number) => mix(bg, fg, t)
  const vars: Record<string, string> = {
    '--bg': bg,
    '--side': mix(bg, '#000000', dark ? 0.2 : 0.03),
    '--line': m(dark ? 0.1 : 0.12),
    '--widget': m(0.03),
    '--quick': m(0.04),
    '--input': dark ? m(0.1) : bg,
    '--input-border': m(dark ? 0.16 : 0.22),
    '--placeholder': mix(fg, bg, 0.45),
    '--fg': fg,
    '--fg-2': mix(fg, bg, 0.3),
    '--fg-3': mix(fg, bg, 0.5),
    '--fg-bright': dark ? '#ffffff' : '#000000',
    '--focus': accent,
    '--btn': accent,
    '--btn-hover': mix(accent, dark ? '#000000' : '#ffffff', 0.12),
    '--btn-fg': luminance(accent) > 0.5 ? '#000000' : '#ffffff',
    '--btn2-hover': m(0.12),
    '--hover': m(dark ? 0.07 : 0.05),
    '--selected': mix(bg, accent, dark ? 0.3 : 0.2),
    '--selected-fg': fg,
    '--badge': m(0.3),
    '--badge-fg': fg,
    '--menu': bg,
    '--menu-border': m(0.2),
    '--menu-sel': accent,
    '--link': a[dark ? 12 : 4],
    '--error': a[1],
    '--red': a[1],
    '--green': a[2],
    '--yellow': a[3],
    '--orange': mix(a[1], a[3], 0.5),
    '--indent-guide': m(0.3),
    '--git-modified': a[3],
    '--git-added': a[2],
    '--git-untracked': a[10],
    '--git-deleted': a[1],
    '--git-conflict': a[9],
    '--diff-ins-line': alpha(a[2], 0.15),
    '--diff-ins-text': alpha(a[2], 0.3),
    '--diff-del-line': alpha(a[1], 0.15),
    '--diff-del-text': alpha(a[1], 0.3),
  }
  ;[4, 2, 3, 5, 6, 1, 12, 10, 11, 13].forEach((n, i) => (vars[`--lane-${i}`] = a[n]))
  a.forEach((c, i) => (vars[`--ansi-${i}`] = c))
  return vars
}
