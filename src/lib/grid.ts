export function balancedGridColumns(slotCount: number): number {
  const count = Math.max(1, Math.floor(slotCount))
  const preferredMaximum = count <= 16 ? 8 : count <= 64 ? 16 : 32
  const practicalMinimum = count <= 16 ? 2 : 8

  for (let columns = Math.min(count, preferredMaximum); columns >= practicalMinimum; columns -= 1) {
    if (count % columns === 0) return columns
  }

  for (let columns = preferredMaximum + 1; columns <= Math.min(count, 64); columns += 1) {
    if (count % columns === 0) return columns
  }

  return count
}

export function balancedCardColumns(cardCount: number): number {
  const count = Math.max(1, Math.floor(cardCount))
  if (count === 1) return 1
  const target = Math.sqrt(count)
  const divisors = Array.from({ length: count - 1 }, (_, index) => index + 2)
    .filter((columns) => count % columns === 0)
  return divisors.sort((left, right) => Math.abs(left - target) - Math.abs(right - target))[0] ?? count
}
