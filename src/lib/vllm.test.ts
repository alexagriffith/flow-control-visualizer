import { describe, expect, it } from 'vitest'
import { aggregateVllm } from './vllm'

describe('aggregateVllm', () => {
  it('sums multi-pod pressure without treating KV percentages as additive', () => {
    expect(aggregateVllm([
      { pod: 'a', running: 10, waiting: 2, preemptions: 1, kvCacheUsage: 0.4, aggregated: false },
      { pod: 'b', running: 12, waiting: 5, preemptions: 3, kvCacheUsage: 0.7, aggregated: false },
    ])).toEqual({
      running: 22,
      waiting: 7,
      preemptions: 4,
      peakKvCacheUsage: 0.7,
    })
  })
})
