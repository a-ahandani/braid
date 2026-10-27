import { describe, expect, it } from 'vitest'
import { layout, type GraphRow, type NodeKind } from './graph'

const row = (id: string, parents: string[], kind: NodeKind = 'commit'): GraphRow => ({ id, parents, kind })

describe('layout', () => {
  it('gives a merged feature branch its own lane and frees it at the base', () => {
    const { rows, maxCol } = layout([
      row('5', ['4', '3'], 'merge'),
      row('4', ['2']),
      row('3', ['2']),
      row('2', ['1']),
      row('1', []),
    ])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 1, 0, 0])
    expect(maxCol).toBe(1)
    expect(rows[0].edges.get(1)?.starting?.parent).toBe('3')
    expect(rows[1].edges.get(1)?.pass).toBeDefined()
    expect(rows[2].edges.get(1)?.ending).toBeDefined()
    expect(rows[3].edges.get(1)?.ending).toBeDefined()
    expect(rows[4].edges.get(1)).toBeUndefined()
  })

  it('keeps the work-in-progress row on the head lane with a wip edge', () => {
    const { rows } = layout([row('w', ['2'], 'wip'), row('2', ['1']), row('1', [])])
    expect(rows.map((r) => r.column)).toEqual([0, 0, 0])
    expect(rows[1].edges.get(0)?.ending?.kind).toBe('wip')
  })
})
