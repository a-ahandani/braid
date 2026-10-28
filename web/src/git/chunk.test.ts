import { describe, expect, it } from 'vitest'
import { applyChange, mixedEol, withBom } from './chunk'

const lines = (s: string, eol: string) => s.split(eol)

describe('applyChange', () => {
  const a = lines('1\r\n2\r\n3\r\n4\r\n', '\r\n')
  const b = lines('X\r\n2\r\n3\r\n4\r\nY\r\n', '\r\n')
  const first = { originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }
  const added = { originalStartLineNumber: 4, originalEndLineNumber: 0, modifiedStartLineNumber: 5, modifiedEndLineNumber: 5 }

  it('stages one modified block and keeps CRLF', () => {
    expect(applyChange(a, b, first, 'a', '\r\n')).toBe('X\r\n2\r\n3\r\n4\r\n')
  })

  it('reverts an inserted block in the working tree', () => {
    expect(applyChange(a, b, added, 'b', '\r\n')).toBe('X\r\n2\r\n3\r\n4\r\n')
  })

  it('stages a deletion', () => {
    const del = { originalStartLineNumber: 2, originalEndLineNumber: 3, modifiedStartLineNumber: 1, modifiedEndLineNumber: 0 }
    expect(applyChange(lines('x\ny\nz\nw', '\n'), lines('x\nw', '\n'), del, 'a', '\n')).toBe('x\nw')
  })

  it('handles a changed last line without a trailing newline', () => {
    const c = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 }
    expect(applyChange(['x', 'y'], ['x', 'z'], c, 'a', '\n')).toBe('x\nz')
    expect(applyChange(['x', 'y'], ['x', 'z'], c, 'b', '\n')).toBe('x\ny')
  })

  it('keeps a byte order mark and spots mixed line endings', () => {
    const raw = '\uFEFFone\r\ntwo\r\n'
    const c = { originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 }
    expect(withBom(raw, applyChange(['one', 'two', ''], ['ONE', 'two', ''], c, 'a', '\r\n'))).toBe('\uFEFFONE\r\ntwo\r\n')
    expect(mixedEol(raw)).toBe(false)
    expect(mixedEol('a\r\nb\nc')).toBe(true)
    expect(mixedEol('a\r\nb\rc')).toBe(true)
    expect(mixedEol('a\nb\n')).toBe(false)
    expect(mixedEol('a\nb\rc\n')).toBe(true)
    expect(mixedEol('a\rb\r')).toBe(true)
  })
})
