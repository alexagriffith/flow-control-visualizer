import { describe, expect, it } from 'vitest'
import { demoRun } from '../demo-run'
import { isRunData } from './run-data'

describe('isRunData', () => {
  it('accepts the versioned replay contract', () => {
    expect(isRunData(demoRun)).toBe(true)
  })

  it('rejects incomplete frame data before React renders it', () => {
    expect(isRunData({ ...demoRun, frames: [{ time: 0 }] })).toBe(false)
  })

  it('rejects empty replays', () => {
    expect(isRunData({ ...demoRun, frames: [] })).toBe(false)
  })
})
