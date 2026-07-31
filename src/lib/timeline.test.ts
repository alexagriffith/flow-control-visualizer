import { describe, expect, it } from 'vitest'
import type { TimelineFrame } from '../types'
import { frameIndexAtTime } from './timeline'

const frame = (time: number): TimelineFrame => ({
  time,
  saturation: 0,
  arrivals: 0,
  completions: 0,
  tenants: [],
  queues: [],
  vllm: [],
})

describe('frameIndexAtTime', () => {
  const frames = [frame(0), frame(1.1), frame(2.2), frame(3.3)]

  it('returns the closest frame at or before the cursor', () => {
    expect(frameIndexAtTime(frames, 0)).toBe(0)
    expect(frameIndexAtTime(frames, 2)).toBe(1)
    expect(frameIndexAtTime(frames, 20)).toBe(3)
  })
})
