import { describe, expect, it } from 'vitest'
import { balancedGridColumns } from './grid'

describe('balancedGridColumns', () => {
  it.each([
    [14, 7],
    [32, 16],
    [48, 16],
    [64, 16],
    [128, 32],
  ])('formats %i slots into complete rows of %i', (slots, columns) => {
    expect(balancedGridColumns(slots)).toBe(columns)
    expect(slots % columns).toBe(0)
  })

  it('uses one complete row when the slot count is prime', () => {
    expect(balancedGridColumns(13)).toBe(13)
  })
})
