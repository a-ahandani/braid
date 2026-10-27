export type NodeKind = 'commit' | 'merge' | 'stash' | 'wip'

export interface GraphRow {
  id: string
  parents: string[]
  kind: NodeKind
}

export interface Edge {
  parent: string
  kind: NodeKind
}

export interface RowEdge {
  ending?: Edge
  pass?: Edge
  starting?: Edge
}

export interface RowLayout {
  column: number
  edges: Map<number, RowEdge>
}

function takeFree(lanes: (Edge | undefined)[]): number {
  const i = lanes.findIndex((l) => l === undefined)
  if (i >= 0) return i
  lanes.push(undefined)
  return lanes.length - 1
}

function slot(edges: Map<number, RowEdge>, col: number): RowEdge {
  let e = edges.get(col)
  if (!e) {
    e = {}
    edges.set(col, e)
  }
  return e
}

export function layout(rows: GraphRow[]): { rows: RowLayout[]; maxCol: number } {
  const lanes: (Edge | undefined)[] = []
  const out: RowLayout[] = []
  let maxCol = 0
  for (const row of rows) {
    const edges = new Map<number, RowEdge>()
    let column: number | undefined
    lanes.forEach((e, i) => {
      if (!e) return
      if (e.parent === row.id) {
        slot(edges, i).ending = e
        if (column === undefined) column = i
        else lanes[i] = undefined
      } else {
        slot(edges, i).pass = e
      }
    })
    if (column === undefined) column = takeFree(lanes)
    const [first, ...rest] = row.parents
    lanes[column] = first ? { parent: first, kind: row.kind } : undefined
    if (lanes[column]) slot(edges, column).starting = lanes[column]
    for (const p of rest) {
      const e = { parent: p, kind: row.kind }
      let target = lanes.findIndex((l) => l?.parent === p)
      if (target < 0) {
        target = takeFree(lanes)
        lanes[target] = e
      }
      slot(edges, target).starting = e
    }
    while (lanes.length > 0 && lanes[lanes.length - 1] === undefined) lanes.pop()
    maxCol = Math.max(maxCol, column, ...edges.keys())
    out.push({ column, edges })
  }
  return { rows: out, maxCol }
}
