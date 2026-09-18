import { createHash } from 'node:crypto'
import { readdir } from 'node:fs/promises'
import type { Plugin } from 'vite'
import type { ProgressData, ProgressRow } from '../src/progress-types'
import { integer, label, object, projectedConfig, readBounded, type Json } from './progress-files'
import { traffic } from './progress-traffic'
import { readNativeProgress } from './progress-native'

const states: Record<string, string> = {
  created: 'Ready', ready: 'Ready', checking: 'Checking', running: 'Running', complete: 'Finished',
  paused: 'Paused', interrupted: 'Interrupted', evidence_invalid: 'Invalid evidence',
  preflight_failed: 'Verification failed', profile_mismatch: 'Config mismatch', goal_not_met: 'Goal not met',
  request_errors: 'Request errors', attempt_budget_exhausted: 'Attempt budget exhausted',
  dataset_changed: 'Dataset changed',
}
const attemptPattern = /^(?:row-\d{3,}-repeat-\d{2,}|point-\d{2,}(?:-repeat-\d{2,})?)-attempt-\d{3,}$/
function loadText(config: Json): string {
  const load = object(config.load)
  const value = Array.isArray(load.rates) ? load.rates[0] : Array.isArray(load.concurrency) ? load.concurrency[0] : undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Missing load point')
  return `${value}${load.rates ? '/s' : ' concurrent'}`
}

export async function readProgress(root: string, now = Date.now()): Promise<ProgressData> {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.length > 5000) throw new Error('Run directory exceeds supported size')
  const names = entries.map(e => e.name)
  // A broken harness checkpoint must not silently become a native-only view.
  if (!names.includes('config.json') && !names.includes('state.json')) return readNativeProgress(root, names, now)
  const [configFile, stateFile] = await Promise.all([readBounded(root, 'config.json'), readBounded(root, 'state.json')])
  const config = object(JSON.parse(configFile.text)), state = object(JSON.parse(stateFile.text))
  if (config.schema_version !== 1) throw new Error('Unsupported config version')
  const matrix = state.kind === 'matrix'
  if (!matrix && state.schema_version !== 1) throw new Error('Unsupported state version')
  if (!Array.isArray(state.completed) || state.completed.length > 20000 || state.completed.some(v => typeof v !== 'string' || !attemptPattern.test(v))) throw new Error('Invalid accepted attempts')
  const completed = state.completed as string[]
  if (new Set(completed).size !== completed.length) throw new Error('Duplicate accepted attempts')
  const statusKey = String(state.status)
  if (!(statusKey in states)) throw new Error('Unsupported runner state')
  const index = integer(matrix ? state.next_row : state.next_point, 1000)
  const load = matrix ? {} : object(config.load)
  const points = matrix ? config.rows : (load.rates ?? load.concurrency)
  if (!Array.isArray(points) || !points.length || points.length > 200) throw new Error('Expected 1–200 rows')
  const repeats = integer(matrix ? config.repeats : load.repeats ?? 1, 100)
  if (!repeats || index > points.length) throw new Error('Invalid checkpoint')
  const acceptedSlots = new Set<string>()
  for (const name of completed) {
    const match = name.match(matrix ? /^row-(\d+)-repeat-(\d+)-attempt-(\d+)$/ : /^point-(\d+)(?:-repeat-(\d+))?-attempt-(\d+)$/)
    const row = Number(match?.[1]), repeat = Number(match?.[2] ?? 1)
    if (!match || row < 1 || row > points.length || repeat < 1 || repeat > repeats || Number(match[3]) < 1) throw new Error('Invalid accepted attempt identity')
    const slot = `${row}:${repeat}`
    if (acceptedSlots.has(slot)) throw new Error('Duplicate accepted repeat')
    acceptedSlots.add(slot)
  }
  if (statusKey === 'complete' && (completed.length !== points.length * repeats || index !== points.length)) throw new Error('Incomplete finished checkpoint')
  const rows: ProgressRow[] = points.map((value, i) => {
    const row = matrix ? object(value) : {}
    const streams = matrix ? object(row.streams) : { workload: { ...config, load: { ...load, [load.rates ? 'rates' : 'concurrency']: [value] } } }
    const prefix = `${matrix ? 'row' : 'point'}-${String(i + 1).padStart(matrix ? 3 : 2, '0')}-`
    const accepted = completed.filter(name => name.startsWith(prefix)).length
    if (accepted > repeats) throw new Error('Invalid accepted repeat count')
    const outcome = object((matrix ? state.outcomes : state.point_results) ?? {})[String(matrix ? i : i + 1)]
    const goalCount = Object.values(streams).reduce<number>((n, c) => n + Object.keys(object(object(c).goals ?? {})).length, 0)
    return { number: i + 1, name: label(row.stage, `Test ${i + 1}`),
      load: Object.entries(streams).map(([name, c]) => `${label(name, 'Stream')} ${loadText(object(c))}`).join(' · '),
      accepted, repeats, status: accepted === repeats ? 'Accepted' : i === index ? states[statusKey] : i < index ? 'Incomplete' : 'Pending',
      outcome: outcome === 'goal_not_met' ? 'Goal not met' : outcome === 'request_errors' ? 'Request errors' : !goalCount ? 'No goals set' : accepted ? 'See saved results' : 'Not evaluated',
      config: Object.fromEntries(Object.entries(streams).map(([name, c]) => [label(name, 'Stream'), projectedConfig(object(c))])) }
  })
  const attempts = entries.filter(e => e.isDirectory() && attemptPattern.test(e.name)).map(e => e.name)
  attempts.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
  const latest = attempts.at(-1) ?? null
  const rowNumber = latest ? Number(latest.match(/^(?:row|point)-(\d+)/)?.[1]) : 1
  const streamNames = matrix ? Object.keys(object(object(points[rowNumber - 1]).streams)) : ['']
  if (streamNames.length > 8 || streamNames.some(s => s && !/^[a-z][a-z0-9_-]{0,47}$/.test(s))) throw new Error('Unsupported stream identity')
  const active = ['running', 'checking', 'ready', 'created'].includes(statusKey)
  const stale = active && now - Date.parse(stateFile.modifiedAt) > 30000
  const action = statusKey === 'complete' ? 'Review results; accepted evidence does not mean goals were met.'
    : active ? 'Reading saved checkpoints. Process health is not observed.'
    : 'Inspect the runner’s saved report and confirm server drain before resuming in the CLI.'
  return { configured: true, source: 'harness', currentRow: index < points.length && statusKey !== 'complete' ? index + 1 : null,
    name: label(config.name, 'Benchmark sweep'), status: states[statusKey],
    savedAt: stateFile.modifiedAt, readAt: new Date(now).toISOString(), stale, rows, action,
    configSource: { file: 'config.json', sha256: createHash('sha256').update(configFile.text).digest('hex'), modifiedAt: configFile.modifiedAt },
    traffic: await traffic(root, latest, streamNames) }
}

export function progressPlugin(root: string): Plugin {
  let pending: Promise<ProgressData> | undefined
  return { name: 'benchmark-progress', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (!request.url?.startsWith('/api/')) return next()
      response.setHeader('Content-Type', 'application/json')
      response.setHeader('Cache-Control', 'no-store')
      const host = request.headers.host ?? ''
      const origin = request.headers.origin
      if (request.method !== 'GET' || !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || (origin && origin !== `http://${host}`)) {
        response.statusCode = 403; response.end(JSON.stringify({ error: 'Local read-only access only.' })); return
      }
      if (request.url?.split('?')[0] !== '/api/progress') return next()
      if (!root) { response.end(JSON.stringify({ configured: false })); return }
      try {
        pending ??= readProgress(root).finally(() => { pending = undefined })
        response.end(JSON.stringify(await pending))
      } catch {
        response.statusCode = 422
        response.end(JSON.stringify({ error: 'Cannot read artifacts. Select a harness output directory or native AIPerf export directory. Check formats, read limits and permissions; symlinks are not supported.' }))
      }
    })
  } }
}
