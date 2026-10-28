import { Chunk } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { applyChunk } from './chunk'

const doc = (s: string, sep: string) => Text.of(s.split(sep))

describe('applyChunk', () => {
  it('moves one chunk and keeps CRLF line endings', () => {
    const a = doc('1\r\n2\r\n3\r\n4\r\n', '\r\n')
    const b = doc('X\r\n2\r\n3\r\nY\r\n', '\r\n')
    const [first, last] = Chunk.build(a, b)
    expect(applyChunk(a, b, first, 'a', '\r\n')).toBe('X\r\n2\r\n3\r\n4\r\n')
    expect(applyChunk(a, b, last, 'b', '\r\n')).toBe('X\r\n2\r\n3\r\n4\r\n')
  })

  it('handles a changed last line without a trailing newline', () => {
    const a = doc('x\ny', '\n')
    const b = doc('x\nz', '\n')
    const [c] = Chunk.build(a, b)
    expect(applyChunk(a, b, c, 'a', '\n')).toBe('x\nz')
    expect(applyChunk(a, b, c, 'b', '\n')).toBe('x\ny')
  })
})
