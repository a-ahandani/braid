import { describe, expect, it } from 'vitest'
import { changedDirs } from './FileExplorer'

describe('changedDirs', () => {
  it('marks every folder on the path to a change, and mixed folders as modified', () => {
    const dirs = changedDirs([
      { path: 'src/ui/App.tsx', kind: 'M' },
      { path: 'src/new.ts', kind: '?' },
      { path: 'docs/guide.md' },
      { path: 'README.md', kind: 'M' },
    ])
    expect(Object.fromEntries(dirs)).toEqual({ src: 'M', 'src/ui': 'M' })
    expect(Object.fromEntries(changedDirs([{ path: 'lib/a.ts', kind: '?' }, { path: 'lib/b.ts', kind: '?' }]))).toEqual({ lib: '?' })
  })
})
