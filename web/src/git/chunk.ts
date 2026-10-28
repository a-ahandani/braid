export interface LineChange {
  originalStartLineNumber: number
  originalEndLineNumber: number
  modifiedStartLineNumber: number
  modifiedEndLineNumber: number
}

const span = (start: number, end: number): [number, number] => (end === 0 ? [start, start] : [start - 1, end])

export function applyChange(a: string[], b: string[], c: LineChange, into: 'a' | 'b', eol: string): string {
  const [af, at] = span(c.originalStartLineNumber, c.originalEndLineNumber)
  const [bf, bt] = span(c.modifiedStartLineNumber, c.modifiedEndLineNumber)
  const lines = into === 'a' ? [...a.slice(0, af), ...b.slice(bf, bt), ...a.slice(at)] : [...b.slice(0, bf), ...a.slice(af, at), ...b.slice(bt)]
  return lines.join(eol)
}

const BOM = '﻿'

export const withBom = (raw: string, text: string) => (raw.startsWith(BOM) && !text.startsWith(BOM) ? BOM + text : text)

export const mixedEol = (text: string) => /\r(?!\n)/.test(text) || (/\r\n/.test(text) && /(?<!\r)\n/.test(text))
