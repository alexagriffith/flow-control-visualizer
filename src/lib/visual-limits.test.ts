import { describe, expect, it } from 'vitest'
import { MAX_RENDERED_SLOTS, renderableSlotCount } from './visual-limits'

describe('renderableSlotCount', () => {
  it('accepts realistic positive integer capacities', () => {
    expect(renderableSlotCount(128)).toBe(128)
  })

  it.each([null, 0, -1, 12.5, Number.NaN, MAX_RENDERED_SLOTS + 1])(
    'rejects unsafe visual slot count %s',
    (value) => expect(renderableSlotCount(value)).toBeNull(),
  )
})
