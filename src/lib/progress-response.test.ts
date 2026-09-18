import { describe, expect, it } from 'vitest'
import { isProgressResponse } from './progress-response'

const valid = { configured: true, source: 'aiperf', currentRow: null, name: 'Export', status: 'Saved export',
  savedAt: '2026-09-18T12:00:00Z', readAt: '2026-09-18T12:00:01Z', stale: false,
  rows: [], configSource: null, action: 'Unknown process state',
  traffic: { attempt: null, start: null, secondsPerBin: 1, counts: [], records: 0, partial: false, unavailable: 'No records' } }
describe('progress response boundary', () => {
  it('accepts disconnected and valid saved exports', () => {
    expect(isProgressResponse({ configured: false })).toBe(true)
    expect(isProgressResponse(valid)).toBe(true)
  })
  it('rejects malformed render inputs rather than throwing during render', () => {
    for (const value of [null, { configured: true, rows: [] }, { ...valid, traffic: null },
      { ...valid, savedAt: 'not-a-date' }, { ...valid, rows: [null] },
      { ...valid, traffic: { ...valid.traffic, counts: ['1'] } },
      { ...valid, configSource: { file: 'config.json', sha256: 'a', modifiedAt: 'bad' } }]) {
      expect(isProgressResponse(value)).toBe(false)
    }
  })
})
