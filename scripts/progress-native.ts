import type { ProgressData } from '../src/progress-types'
import { object, readBounded } from './progress-files'
import { trafficFromFiles } from './progress-traffic'

/** Native exports contain observations, not a planned sweep or runner heartbeat. */
export async function readNativeProgress(root: string, files: string[], now: number): Promise<ProgressData> {
  const records = files.includes('profile_export.jsonl')
  const summary = files.includes('profile_export_aiperf.json')
  if (!records && !summary) throw new Error('No supported native AIPerf exports')
  let savedAt: string
  if (summary) {
    const file = await readBounded(root, 'profile_export_aiperf.json')
    const value = object(JSON.parse(file.text))
    if (value.schema_version !== '1.4') throw new Error('Unsupported AIPerf summary schema')
    savedAt = file.modifiedAt
  }
  if (records) {
    savedAt = (await readBounded(root, 'profile_export.jsonl', 8 * 1024 * 1024)).modifiedAt
  }
  const traffic = await trafficFromFiles(root, records ? ['profile_export.jsonl'] : [], null)
  if (!records) traffic.unavailable = 'Summary only. Request timestamps require profile_export.jsonl.'
  return { configured: true, source: 'aiperf', currentRow: null, name: 'Native AIPerf export',
    status: 'Saved export', savedAt: savedAt!, readAt: new Date(now).toISOString(), stale: false,
    rows: [], configSource: null, traffic,
    action: 'No runner state supplied. Current activity, pending tests and repeat progress are unknown.' }
}
