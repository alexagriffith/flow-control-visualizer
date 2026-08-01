export function balancedGridColumns(slotCount: number): number {
  const count = Math.max(1, Math.floor(slotCount))
  const preferredMaximum = count <= 16 ? 8 : count <= 64 ? 16 : 32

  for (let columns = Math.min(count, preferredMaximum); columns >= 2; columns -= 1) {
    if (count % columns === 0) return columns
  }

  return count
}
