import type { Text } from '@codemirror/state'

export interface ChunkRange {
  fromA: number
  toA: number
  fromB: number
  toB: number
}

export function applyChunk(a: Text, b: Text, c: ChunkRange, into: 'a' | 'b', sep: string): string {
  return into === 'a'
    ? a.sliceString(0, c.fromA, sep) + b.sliceString(c.fromB, c.toB, sep) + a.sliceString(c.toA, a.length, sep)
    : b.sliceString(0, c.fromB, sep) + a.sliceString(c.fromA, c.toA, sep) + b.sliceString(c.toB, b.length, sep)
}
