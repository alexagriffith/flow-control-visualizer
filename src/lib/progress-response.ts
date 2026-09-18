import type { ProgressData } from '../progress-types'

const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string'
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
const date = (v: unknown) => text(v) && Number.isFinite(Date.parse(v))
const optionalText = (v: unknown) => v === null || text(v)

/** Validate render inputs before replacing the last readable snapshot. */
export function isProgressResponse(v: unknown): v is ProgressData | { configured: false } {
  if (!object(v)) return false
  if (v.configured === false) return true
  if (v.configured !== true || !['harness', 'aiperf'].includes(String(v.source))) return false
  if (![v.name, v.status, v.action].every(text) || !date(v.savedAt) || !date(v.readAt) || typeof v.stale !== 'boolean') return false
  if (v.currentRow !== null && (!count(v.currentRow) || v.currentRow < 1)) return false
  if (!Array.isArray(v.rows) || v.rows.length > 200 || !v.rows.every(row => object(row)
    && count(row.number) && row.number > 0 && count(row.accepted) && count(row.repeats)
    && row.repeats > 0 && row.accepted <= row.repeats
    && [row.name, row.load, row.status, row.outcome].every(text) && object(row.config))) return false
  if (v.configSource !== null && (!object(v.configSource) || !text(v.configSource.file)
    || !text(v.configSource.sha256) || !date(v.configSource.modifiedAt))) return false
  if (v.source === 'harness' && v.configSource === null) return false
  const t = v.traffic
  return object(t) && optionalText(t.attempt) && (t.start === null || date(t.start))
    && count(t.secondsPerBin) && t.secondsPerBin > 0 && Array.isArray(t.counts)
    && t.counts.length <= 60 && t.counts.every(count) && count(t.records)
    && typeof t.partial === 'boolean' && optionalText(t.unavailable)
}
