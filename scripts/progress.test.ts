import { mkdtemp, mkdir, writeFile, rm, symlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { readProgress } from './progress'
import { projectedConfig, readBounded } from './progress-files'

const roots: string[] = []
const attempt = 'row-001-repeat-01-attempt-001'
const stream = { endpoint: { url: 'https://private.example', headers: { secret: 'do-not-expose' } },
  workload: { type: 'single_turn', path: '/private/prompts.jsonl', output_tokens: 64 },
  load: { rates: [2], arrival: 'constant', max_concurrency: 8, requests: 20 }, goals: {} }
async function save(root: string, path: string, value: unknown) { await writeFile(join(root, path), JSON.stringify(value)) }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'progress-test-')); roots.push(root)
  await save(root, 'config.json', { schema_version: 1, name: 'example-benchmark', repeats: 3,
    sources: { '/private/config.json': 'secret' }, rows: [{ stage: 'mixed', streams: { interactive: stream } }] })
  await save(root, 'state.json', { kind: 'matrix', status: 'running', next_row: 0, completed: [attempt], outcomes: { '0': 'ready' } })
  await mkdir(join(root, attempt, 'interactive', 'native'), { recursive: true })
  const rows = ['1789700000000000001', '1789700000999999999', '1789700001000000001'].map((ns, i) =>
    `{"metadata":{"request_start_ns":${ns}},"error":${i === 2 ? '"failed"' : 'null'},"prompt":"private text"}`)
  await writeFile(join(root, attempt, 'interactive/native/profile_export.jsonl'), rows.join('\n') + '\n')
  return root
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('saved harness progress', () => {
  it('maps accepted repeats without inventing a goal pass; counts starts including failures', async () => {
    const data = await readProgress(await fixture())
    expect(data.rows[0]).toMatchObject({ accepted: 1, repeats: 3, status: 'Running', outcome: 'No goals set' })
    expect(data.traffic.counts).toEqual([2, 1])
    expect(data.traffic.records).toBe(3)
    expect(data.traffic.partial).toBe(false)
    expect(data.configSource.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(data)).not.toMatch(/private|secret|prompts|do-not-expose/)
  })
  it('does not label an old running checkpoint live or a finished run stale', async () => {
    const root = await fixture(); await utimes(join(root, 'state.json'), 1, 1)
    expect((await readProgress(root)).stale).toBe(true)
    await save(root, 'state.json', { kind: 'matrix', status: 'complete', next_row: 1,
      completed: [attempt, 'row-001-repeat-02-attempt-001', 'row-001-repeat-03-attempt-001'], outcomes: {} })
    await utimes(join(root, 'state.json'), 1, 1)
    expect((await readProgress(root)).stale).toBe(false)
  })
  it('shows a goal miss independently of accepted evidence', async () => {
    const root = await fixture()
    await save(root, 'state.json', { kind: 'matrix', status: 'goal_not_met', next_row: 1, completed: [attempt], outcomes: { '0': 'goal_not_met' } })
    expect((await readProgress(root)).rows[0].outcome).toBe('Goal not met')
  })
  it('handles a partial final record without fabricating requests', async () => {
    const root = await fixture()
    await writeFile(join(root, attempt, 'interactive/native/profile_export.jsonl'), '{"metadata":{"request_start_ns":1789700000000000001}}\n{"metadata":')
    const data = await readProgress(root)
    expect(data.traffic.records).toBe(1); expect(data.traffic.partial).toBe(true)
  })
  it('missing request exports are unavailable, not a zero-rate graph', async () => {
    const root = await fixture(); await rm(join(root, attempt, 'interactive/native/profile_export.jsonl'))
    const data = await readProgress(root)
    expect(data.traffic.counts).toEqual([]); expect(data.traffic.unavailable).toContain('unavailable')
  })
  it('refuses symlinked config files and traversal', async () => {
    const root = await fixture(); await rm(join(root, 'config.json'))
    await symlink(join(root, 'state.json'), join(root, 'config.json'))
    await expect(readProgress(root)).rejects.toThrow('Symbolic')
    await expect(readBounded(root, '../secret')).rejects.toThrow('Unsafe')
  })
  it('does not follow a request export symlink', async () => {
    const root = await fixture(); const path = join(root, attempt, 'interactive/native/profile_export.jsonl')
    await rm(path); await symlink(join(root, 'state.json'), path)
    expect((await readProgress(root)).traffic.unavailable).toContain('unavailable')
  })
  it('refuses oversized and malformed config/state without returning their contents', async () => {
    const root = await fixture()
    await writeFile(join(root, 'state.json'), 'private'.repeat(400000))
    await expect(readProgress(root)).rejects.toThrow('bounded')
    await writeFile(join(root, 'state.json'), '{')
    await expect(readProgress(root)).rejects.toThrow()
  })
  it('rejects a real named pipe without waiting for a writer', async () => {
    const root = await fixture()
    await rm(join(root, 'state.json'))
    execFileSync('mkfifo', [join(root, 'state.json')])
    await expect(readProgress(root)).rejects.toThrow('regular file')
  }, 1000)
  it('maps single-workload sweeps and leaves future points pending', async () => {
    const root = await fixture()
    await save(root, 'config.json', { schema_version: 1, ...stream, load: { concurrency: [1, 2], repeats: 3 } })
    await rm(join(root, attempt), { recursive: true })
    await save(root, 'state.json', { schema_version: 1, status: 'ready', next_point: 0, completed: ['point-01-repeat-01-attempt-001'], point_results: {} })
    const data = await readProgress(root)
    expect(data.rows.map(r => r.accepted)).toEqual([1, 0]); expect(data.rows[1].status).toBe('Pending')
  })
  it('whitelists only numeric tuning fields and known enums', () => {
    const value = projectedConfig({ ...stream, load: { rates: ['secret'], request: 'secret', arrival: 'secret' }, goals: { secret: 'secret' } })
    expect(JSON.stringify(value)).not.toContain('secret')
  })
  it('rejects unknown state and duplicate accepted attempt entries', async () => {
    const root = await fixture()
    await save(root, 'state.json', { kind: 'matrix', status: 'invented', next_row: 0, completed: [] })
    await expect(readProgress(root)).rejects.toThrow('Unsupported')
    await save(root, 'state.json', { kind: 'matrix', status: 'running', next_row: 0, completed: [attempt, attempt] })
    await expect(readProgress(root)).rejects.toThrow('Duplicate')
  })
  it('rejects two accepted attempts for one repeat and incomplete finished state', async () => {
    const root = await fixture()
    await save(root, 'state.json', { kind: 'matrix', status: 'running', next_row: 0, completed: [attempt, 'row-001-repeat-01-attempt-002'] })
    await expect(readProgress(root)).rejects.toThrow('Duplicate accepted repeat')
    await save(root, 'state.json', { kind: 'matrix', status: 'complete', next_row: 1, completed: [attempt] })
    await expect(readProgress(root)).rejects.toThrow('Incomplete finished')
    await save(root, 'state.json', { kind: 'matrix', status: 'running', next_row: 0, completed: ['row-009-repeat-01-attempt-001'] })
    await expect(readProgress(root)).rejects.toThrow('Invalid accepted')
  })
})
