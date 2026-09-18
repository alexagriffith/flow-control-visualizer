import { readBounded, object } from './progress-files'
import type { ProgressData } from '../src/progress-types'

export async function traffic(root: string, attempt: string | null, streams: string[]): Promise<ProgressData['traffic']> {
  const files = attempt ? streams.map(stream => `${attempt}/${stream ? stream + '/' : ''}native/profile_export.jsonl`) : []
  return trafficFromFiles(root, files, attempt)
}

export async function trafficFromFiles(root: string, files: string[], attempt: string | null): Promise<ProgressData['traffic']> {
  const empty = { attempt, start: null, secondsPerBin: 1, counts: [], records: 0, partial: false, unavailable: 'No request records yet.' }
  if (!files.length) return empty
  const starts: bigint[] = []
  let partial = false
  for (const file of files) {
    try {
      const { text } = await readBounded(root, file, 8 * 1024 * 1024)
      const lines = text.split('\n')
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index].trim()
        if (!line) continue
        try {
          // Preserve epoch nanoseconds before JSON number parsing can round them.
          const row = object(JSON.parse(line.replace(/("request_start_ns"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"')))
          const value = object(row.metadata).request_start_ns
          if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new Error('Missing request timestamp')
          const ns = BigInt(value)
          if (ns <= 0n || ns > 8640000000000000000000n) throw new Error('Invalid timestamp')
          starts.push(ns)
        } catch { partial = true }
      }
    } catch { partial = true }
  }
  if (!starts.length) return { ...empty, partial, unavailable: 'Request timestamps unavailable; missing data is not zero traffic.' }
  starts.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  const first = starts[0]
  const span = Number((starts.at(-1)! - first) / 1000000000n)
  const width = Math.max(1, Math.ceil((span + 1) / 60))
  const counts = Array(Math.floor(span / width) + 1).fill(0) as number[]
  for (const ns of starts) counts[Math.floor(Number((ns - first) / 1000000000n) / width)]++
  return { attempt, start: new Date(Number(first / 1000000n)).toISOString(), secondsPerBin: width,
    counts, records: starts.length, partial, unavailable: null }
}
