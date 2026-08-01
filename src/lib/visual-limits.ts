export const MAX_RENDERED_SLOTS = 2048

export function renderableSlotCount(value: number | null): number | null {
  if (value === null || !Number.isInteger(value) || value <= 0 || value > MAX_RENDERED_SLOTS) {
    return null
  }
  return value
}
