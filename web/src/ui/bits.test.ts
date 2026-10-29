import { describe, expect, it } from 'vitest'
import { settleLimited } from './bits'

describe('settleLimited', () => {
  it('never runs more than the limit at once and keeps results in order', async () => {
    let running = 0
    let peak = 0
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      if (i === 4) throw new Error('boom')
      return i
    })
    const seen: number[] = []
    const results = await settleLimited(tasks, 3, (done) => seen.push(done))
    expect(peak).toBe(3)
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : 'failed'))).toEqual([0, 1, 2, 3, 'failed', 5, 6, 7, 8, 9])
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})
