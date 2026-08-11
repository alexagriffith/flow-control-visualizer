import { describe, expect, it } from 'vitest'
import { balancedCardColumns, balancedGridColumns } from './grid'

describe('balancedGridColumns', () => {
  it.each([
    [14, 7],
    [32, 16],
    [48, 16],
    [64, 16],
    [74, 37],
    [128, 32],
  ])('formats %i slots into complete rows of %i', (slots, columns) => {
    expect(balancedGridColumns(slots)).toBe(columns)
    expect(slots % columns).toBe(0)
  })

  it('uses one complete row when the slot count is prime', () => {
    expect(balancedGridColumns(13)).toBe(13)
    expect(balancedGridColumns(73)).toBe(73)
  })
})

describe('balancedCardColumns', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 2],
    [5, 5],
    [6, 2],
    [8, 2],
    [9, 3],
  ])('places %i cards in complete rows of %i', (cards, columns) => {
    expect(balancedCardColumns(cards)).toBe(columns)
    expect(cards % columns).toBe(0)
  })
})
