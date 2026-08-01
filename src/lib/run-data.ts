import type { RunData } from '../types'

const MAX_FRAMES = 100_000
const MAX_ITEMS_PER_FRAME = 10_000

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null
}

function finiteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

function boundedArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= MAX_ITEMS_PER_FRAME
}

export function isRunData(value: unknown): value is RunData {
  const candidate = objectValue(value)
  if (!candidate || candidate.schemaVersion !== 1) return false

  const metadata = objectValue(candidate.metadata)
  const limits = objectValue(candidate.limits)
  const summary = objectValue(candidate.summary)
  if (!metadata || !limits || !summary) return false
  if (typeof metadata.runId !== 'string' || typeof metadata.scenario !== 'string') return false
  if (!finiteNumber(metadata.duration) || !finiteNumber(metadata.sampleInterval)) return false
  if (!finiteNumber(summary.requestCount) || !finiteNumber(summary.maxEppQueue) || !finiteNumber(summary.maxVllmWaiting)) return false

  const tenants = candidate.tenants
  const frames = candidate.frames
  if (!boundedArray(tenants) || !Array.isArray(frames) || frames.length === 0 || frames.length > MAX_FRAMES) return false

  if (!tenants.every((value) => {
    const tenant = objectValue(value)
    if (!tenant) return false
    return typeof tenant.id === 'string'
      && typeof tenant.color === 'string'
      && finiteNumber(tenant.priority)
  })) return false

  return frames.every((value) => {
    const frame = objectValue(value)
    if (!frame) return false
    return finiteNumber(frame.time)
      && finiteNumber(frame.saturation)
      && finiteNumber(frame.arrivals)
      && finiteNumber(frame.completions)
      && boundedArray(frame.tenants)
      && boundedArray(frame.queues)
      && boundedArray(frame.vllm)
  })
}
