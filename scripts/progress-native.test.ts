import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readProgress } from './progress'

const roots: string[] = []
async function fixture(summary = false) {
  const root = await mkdtemp(join(tmpdir(), 'native-progress-')); roots.push(root)
  await writeFile(join(root, 'profile_export.jsonl'), [
    '{"metadata":{"request_start_ns":1789700000000000001,"conversation_id":"sensitive"},"prompt":"private"}',
    '{"metadata":{"request_start_ns":1789700001000000001},"error":{"message":"secret"}}',
  ].join('\n') + '\n')
  if (summary) await writeFile(join(root, 'profile_export_aiperf.json'), JSON.stringify({
    schema_version: '1.4', input_config: { endpoint: { headers: { authorization: 'secret' } } },
    run_info: { cli_command: 'aiperf --secret=private' }, request_count: { avg: 1, unit: 'requests' },
  }))
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
describe('standalone native AIPerf', () => {
  it('reads native records without any harness configuration or matrix', async () => {
    const data = await readProgress(await fixture())
    expect(data.source).toBe('aiperf'); expect(data.status).toBe('Saved export')
    expect(data.rows).toEqual([]); expect(data.currentRow).toBeNull(); expect(data.configSource).toBeNull()
    expect(data.traffic.counts).toEqual([1, 1]); expect(data.traffic.records).toBe(2)
    expect(data.traffic.partial).toBe(false); expect(data.action).toContain('unknown')
  })
  it('does not expose native summary commands, headers or payloads', async () => {
    const data = await readProgress(await fixture(true))
    expect(JSON.stringify(data)).not.toMatch(/private|secret|sensitive|authorization|cli_command/)
  })
  it('summary-only exports do not fabricate a time series or completion', async () => {
    const root = await fixture(true); await rm(join(root, 'profile_export.jsonl'))
    const data = await readProgress(root)
    expect(data.traffic.unavailable).toContain('Summary only')
    expect(data.traffic.counts).toEqual([]); expect(data.rows).toEqual([])
    expect(data.status).toBe('Saved export')
  })
  it('rejects an unverified summary version and malformed summary', async () => {
    const root = await fixture(true)
    await writeFile(join(root, 'profile_export_aiperf.json'), '{"schema_version":"99"}')
    await expect(readProgress(root)).rejects.toThrow('Unsupported')
    await writeFile(join(root, 'profile_export_aiperf.json'), '{')
    await expect(readProgress(root)).rejects.toThrow()
  })
  it('does not hide broken harness state behind native fallback', async () => {
    const root = await fixture()
    await writeFile(join(root, 'state.json'), '{}')
    await expect(readProgress(root)).rejects.toThrow()
  })
  it('rejects an unsupported folder and symlinked summary', async () => {
    const root = await fixture(true)
    await rm(join(root, 'profile_export_aiperf.json'))
    await symlink(join(root, 'profile_export.jsonl'), join(root, 'profile_export_aiperf.json'))
    await expect(readProgress(root)).rejects.toThrow('Symbolic')
    await rm(join(root, 'profile_export_aiperf.json')); await rm(join(root, 'profile_export.jsonl'))
    await expect(readProgress(root)).rejects.toThrow('No supported')
  })
  it('marks partial native records without inventing missing starts', async () => {
    const root = await fixture()
    await writeFile(join(root, 'profile_export.jsonl'), '{"metadata":{"request_start_ns":1789700000000000001}}\n{"metadata":')
    const data = await readProgress(root)
    expect(data.traffic.records).toBe(1); expect(data.traffic.partial).toBe(true)
  })
})
