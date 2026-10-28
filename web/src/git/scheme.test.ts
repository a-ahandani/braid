import { describe, expect, it } from 'vitest'
import { isScheme, mix, parseScheme, schemeSource, schemeVars } from './scheme'

const MOCHA = `name: Catppuccin Mocha
accent: "#b4befe"
cursor: "#b4befe"
background: "#1e1e2e"
foreground: "#cdd6f4"
details: darker
terminal_colors:
  bright:
    black: "#585b70"
    blue: "#74a8fc"
    cyan: "#6bd7ca"
    green: "#89d88b"
    magenta: "#f2aede"
    red: "#f37799"
    white: "#bac2de"
    yellow: "#ebd391"
  normal:
    black: "#45475a"
    blue: "#89b4fa"
    cyan: "#94e2d5"
    green: "#a6e3a1"
    magenta: "#f5c2e7"
    red: "#f38ba8"
    white: "#a6adc8"
    yellow: "#f9e2af"
`

describe('color schemes from share links', () => {
  it('turns a theme page link into its download', () => {
    expect(schemeSource('https://terminalcolors.com/themes/catppuccin/mocha/')).toEqual({ id: 'catppuccin-mocha', url: 'https://terminalcolors.com/downloads/warp/catppuccin-mocha.yaml' })
    expect(schemeSource(' https://www.terminalcolors.com/themes/dracula/default?x=1 ')?.id).toBe('dracula-default')
    expect(schemeSource('https://example.com/themes/catppuccin/mocha/')).toBeUndefined()
    expect(schemeSource('not a link')).toBeUndefined()
  })

  it('reads the 16 colors in terminal order whatever order the file lists them in', () => {
    const s = parseScheme(MOCHA, 'catppuccin-mocha')
    expect(s).toMatchObject({ name: 'Catppuccin Mocha', dark: true, bg: '#1e1e2e', fg: '#cdd6f4', accent: '#b4befe' })
    expect(s.ansi.slice(0, 2)).toEqual(['#45475a', '#f38ba8'])
    expect(s.ansi[12]).toBe('#74a8fc')
    expect(isScheme(s)).toBe(true)
    expect(() => parseScheme('name: Broken\nbackground: "#000000"', 'x')).toThrow(/complete set of colors/)
  })

  it('derives every interface color from the scheme', () => {
    const vars = schemeVars(parseScheme(MOCHA, 'catppuccin-mocha'))
    expect(vars['--bg']).toBe('#1e1e2e')
    expect(vars['--git-added']).toBe('#a6e3a1')
    expect(vars['--lane-0']).toBe('#89b4fa')
    expect(vars['--btn-fg']).toBe('#000000')
    expect(Object.values(vars).every((v) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(v))).toBe(true)
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})
