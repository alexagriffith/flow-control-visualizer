import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseCsv, type CsvRow } from '../src/lib/csv'
import type { RequestSample, RunData, TenantDefinition, TimelineFrame, VllmFrame } from '../src/types'

const COLORS = ['#2d5bff', '#168f82', '#d95b30', '#6941c6', '#b7791f', '#0077a8']

export type PackageIngestOptions = {
  packageDir: string
  runName: string | null
  output: string
}

function numberValue(row: CsvRow, key: string): number {
  const parsed = Number(row[key])
  return Number.isFinite(parsed) ? parsed : 0
}

function optionalNumber(row: CsvRow, key: string): number | null {
  if (!(key in row) || row[key] === '') return null
  const parsed = Number(row[key])
  return Number.isFinite(parsed) ? parsed : null
}

async function readCsv(path: string): Promise<CsvRow[]> {
  return parseCsv(await readFile(path, 'utf8'))
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path)
    return true
  } catch {
    return false
  }
}

function selectRun(rows: CsvRow[], requested: string | null): string {
  const names = [...new Set(rows.map((row) => row.run_name).filter(Boolean))]
  if (requested && names.includes(requested)) return requested
  if (requested) throw new Error(`Run not found: ${requested}`)
  if (names.length === 1) return names[0]
  throw new Error(`Choose --run-name. Available runs: ${names.join('; ')}`)
}

function tenantDefinitions(rows: CsvRow[]): TenantDefinition[] {
  const tenants = new Map<string, number>()
  for (const row of rows) {
    if (row.tenant && !tenants.has(row.tenant)) tenants.set(row.tenant, numberValue(row, 'priority'))
  }
  return [...tenants.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, priority], index) => ({
      id,
      priority,
      objective: `${id} objective`,
      color: COLORS[index % COLORS.length],
    }))
}

function requestSamples(rows: CsvRow[]): RequestSample[] {
  return rows.map((row) => ({
    requestId: row.request_number ? `${row.run_name}:${row.request_number}` : undefined,
    tenant: row.tenant,
    priority: numberValue(row, 'priority'),
    start: numberValue(row, 'actual_send_seconds') || numberValue(row, 'planned_arrival_seconds'),
    plannedArrival: optionalNumber(row, 'planned_arrival_seconds'),
    actualSend: optionalNumber(row, 'actual_send_seconds'),
    sendDelay: optionalNumber(row, 'send_lag_ms') === null ? null : numberValue(row, 'send_lag_ms') / 1000,
    ttft: numberValue(row, 'ttft_ms') / 1000,
    latency: numberValue(row, 'e2e_latency_ms') / 1000,
    status: numberValue(row, 'http_status'),
    promptTokens: optionalNumber(row, 'prompt_tokens'),
    completionTokens: optionalNumber(row, 'completion_tokens'),
    tpot: optionalNumber(row, 'tpot_ms_per_token') === null ? null : numberValue(row, 'tpot_ms_per_token') / 1000,
    errorClass: row.error_class || null,
    retryCount: optionalNumber(row, 'retry_count'),
    timeout: row.timeout ? row.timeout.toLowerCase() === 'true' : null,
  })).sort((left, right) => left.start - right.start)
}

function eventCounts(requests: RequestSample[], frameTimes: number[]): Array<[number, number]> {
  const starts = requests.map((request) => request.start).sort((left, right) => left - right)
  const completions = requests
    .map((request) => request.start + request.latency)
    .sort((left, right) => left - right)
  let startIndex = 0
  let completionIndex = 0
  let previous = Number.NEGATIVE_INFINITY
  return frameTimes.map((time) => {
    let arrivals = 0
    let completed = 0
    while (startIndex < starts.length && starts[startIndex] <= time) {
      if (starts[startIndex] > previous) arrivals += 1
      startIndex += 1
    }
    while (completionIndex < completions.length && completions[completionIndex] <= time) {
      if (completions[completionIndex] > previous) completed += 1
      completionIndex += 1
    }
    previous = time
    return [arrivals, completed]
  })
}

function nearest(rows: CsvRow[], time: number, elapsedKey: string): CsvRow | undefined {
  return rows.reduce<CsvRow | undefined>((best, candidate) => {
    if (!best) return candidate
    return Math.abs(numberValue(candidate, elapsedKey) - time) < Math.abs(numberValue(best, elapsedKey) - time)
      ? candidate
      : best
  }, undefined)
}

function configValues(config: Record<string, unknown>): {
  maxSequences: number | null
  maxBatchedTokens: number | null
  prefixCache: boolean | null
} {
  const service = config.model_service && typeof config.model_service === 'object'
    ? config.model_service as Record<string, unknown>
    : {}
  const maxSequences = Number(service.max_num_sequences ?? service.max_num_seqs)
  const maxBatchedTokens = Number(service.max_num_batched_tokens)
  return {
    maxSequences: Number.isFinite(maxSequences) ? maxSequences : null,
    maxBatchedTokens: Number.isFinite(maxBatchedTokens) ? maxBatchedTokens : null,
    prefixCache: service.prefix_cache === 'enabled' ? true : service.prefix_cache === 'disabled' ? false : null,
  }
}

function metricValue(rows: CsvRow[], metric: string, modelReplica = ''): number {
  const row = rows.find((candidate) => (
    candidate.metric === metric && (modelReplica === '' || candidate.model_replica === modelReplica)
  ))
  return row ? numberValue(row, 'value') : 0
}

function longFormVllm(rows: CsvRow[]): VllmFrame[] {
  const replicas = [...new Set(rows
    .filter((row) => row.metric === 'vllm_running_requests')
    .map((row) => row.model_replica || 'vllm aggregate'))]
  return replicas.map((replica) => {
    const sourceReplica = replica === 'vllm aggregate' ? '' : replica
    return {
      pod: replica,
      running: Math.max(0, Math.floor(metricValue(rows, 'vllm_running_requests', sourceReplica))),
      waiting: Math.max(0, Math.floor(metricValue(rows, 'vllm_waiting_requests', sourceReplica))),
      kvCacheUsage: Math.max(0, Math.min(1, metricValue(rows, 'vllm_kv_cache_usage_ratio', sourceReplica))),
      preemptions: Math.max(0, Math.floor(metricValue(rows, 'vllm_preemptions_total', sourceReplica))),
      aggregated: sourceReplica === '',
    }
  })
}

async function ingestLongForm(packageDir: string, requestedRun: string | null): Promise<RunData> {
  const [allRequests, allMetrics, allTraffic, config] = await Promise.all([
    readCsv(resolve(packageDir, 'request-results.csv')),
    readCsv(resolve(packageDir, 'system-metrics.csv')),
    readCsv(resolve(packageDir, 'traffic-samples.csv')),
    readJson(resolve(packageDir, 'run-config.json')),
  ])
  const runName = selectRun(allRequests, requestedRun)
  const requestRows = allRequests.filter((row) => row.run_name === runName)
  const metricRows = allMetrics.filter((row) => row.run_name === runName)
  const trafficRows = allTraffic.filter((row) => row.run_name === runName)
  const tenants = tenantDefinitions(requestRows)
  const requests = requestSamples(requestRows)
  const metricGroups = new Map<string, CsvRow[]>()
  for (const row of metricRows) {
    const key = row.elapsed_seconds
    const group = metricGroups.get(key) ?? []
    group.push(row)
    metricGroups.set(key, group)
  }
  const frameGroups = [...metricGroups.entries()].sort((left, right) => Number(left[0]) - Number(right[0]))
  const frameTimes = frameGroups.map(([elapsed]) => Number(elapsed))
  const counts = eventCounts(requests, frameTimes)
  const trafficByTenant = new Map(tenants.map((tenant) => [
    tenant.id,
    trafficRows.filter((row) => row.tenant === tenant.id),
  ]))
  const frames: TimelineFrame[] = frameGroups.map(([elapsed, rows], index) => {
    const time = Number(elapsed)
    const recordedQueueRows = rows.filter((candidate) => candidate.metric === 'endpoint_picker_policy_queue_requests')
    const policyQueueRows = recordedQueueRows.filter((row) => row.workload !== 'warmup')
    const queueRows = policyQueueRows.length > 0 ? policyQueueRows : recordedQueueRows
    return {
      time,
      saturation: Math.max(0, metricValue(rows, 'endpoint_picker_pool_saturation_ratio')),
      arrivals: counts[index][0],
      completions: counts[index][1],
      tenants: tenants.map((tenant) => {
        const sample = nearest(trafficByTenant.get(tenant.id) ?? [], time, 'elapsed_seconds')
        return {
          id: tenant.id,
          targetConcurrency: 0,
          actualInflight: sample ? numberValue(sample, 'outstanding_requests') : 0,
          targetRps: null,
          arrivalProcess: sample?.arrival_process || null,
          issuedRequests: sample ? numberValue(sample, 'issued_requests') : null,
          completedRequests: sample ? numberValue(sample, 'completed_requests') : null,
          outstandingRequests: sample ? numberValue(sample, 'outstanding_requests') : null,
          sendDelay: sample ? optionalNumber(sample, 'send_delay_seconds') : null,
          safetyCeilingState: sample?.safety_ceiling_state || null,
        }
      }),
      queues: queueRows.map((row) => {
        const priority = numberValue(row, 'priority')
        const tenant = tenants.find((candidate) => candidate.priority === priority)
        return {
          id: row.workload === 'warmup' ? tenant?.id ?? `priority ${priority}` : row.workload,
          priority,
          size: Math.max(0, Math.floor(numberValue(row, 'value'))),
          bytes: 0,
        }
      }),
      vllm: longFormVllm(rows),
    }
  })
  const configured = configValues(config)
  const sampleInterval = frameTimes.length > 1 ? frameTimes[1] - frameTimes[0] : 0
  const scenario = requestRows[0]?.scenario || basename(packageDir)
  const priorities = [...new Set(tenants.map((tenant) => tenant.priority))].sort((left, right) => right - left)
  return {
    schemaVersion: 1,
    metadata: {
      runId: runName,
      scenario,
      duration: frameTimes.at(-1) ?? 0,
      sampleInterval,
      trafficMode: 'open_loop_poisson',
      generatedAt: new Date().toISOString(),
      source: 'ingested',
    },
    limits: { maxSequences: configured.maxSequences, maxBatchedTokens: configured.maxBatchedTokens },
    runtime: { schedulerPolicy: 'fcfs', chunkedPrefill: null },
    routing: {
      priorityBands: priorities.map((priority) => {
        const tenant = tenants.find((candidate) => candidate.priority === priority)
        return { priority, label: tenant?.id ?? null, color: tenant?.color ?? null }
      }),
    },
    tenants,
    frames,
    summary: {
      requestCount: requests.length,
      errorCount: requests.filter((request) => request.status >= 400 || request.status === 0).length,
      maxEppQueue: Math.max(0, ...frames.flatMap((frame) => frame.queues.map((queue) => queue.size))),
      maxVllmWaiting: Math.max(0, ...frames.map((frame) => frame.vllm.reduce((sum, pod) => sum + pod.waiting, 0))),
      maxVllmRunning: Math.max(0, ...frames.map((frame) => frame.vllm.reduce((sum, pod) => sum + pod.running, 0))),
      maxSaturation: Math.max(0, ...frames.map((frame) => frame.saturation)),
    },
    evidence: {
      metricResolution: `${sampleInterval.toFixed(2)} seconds`,
      requestCorrelation: true,
      exactBatchMembership: false,
      capabilities: {
        hasOpenLoop: true,
        hasPerRequestTokens: requestRows.some((row) => row.prompt_tokens !== ''),
        hasRequestIds: true,
        hasTpot: requestRows.some((row) => row.tpot_ms_per_token !== ''),
        hasPerPodVllm: metricRows.some((row) => row.model_replica !== ''),
        hasEppQueueDurations: metricRows.some((row) => row.metric === 'endpoint_picker_policy_queue_seconds_total'),
      },
      notes: [
        'Replay generated directly from the public request, traffic, and system-metric CSV files.',
        'Endpoint Picker queues and vLLM pressure are exact at the recorded sampling interval.',
        `Prefix cache was ${configured.prefixCache === false ? 'off' : configured.prefixCache === true ? 'on' : 'not recorded'}.`,
      ],
    },
  }
}

async function ingestBatchEviction(packageDir: string, requestedRun: string | null): Promise<RunData> {
  const [allRequests, allFrames, config] = await Promise.all([
    readCsv(resolve(packageDir, 'realtime-requests.csv')),
    readCsv(resolve(packageDir, 'traffic-samples.csv')),
    readJson(resolve(packageDir, 'run-config.json')),
  ])
  const runName = selectRun(allRequests, requestedRun)
  const requestRows = allRequests.filter((row) => row.run_name === runName)
  const frameRows = allFrames.filter((row) => row.run_name === runName)
  const realtimeTenant: TenantDefinition = {
    id: 'realtime', priority: 100, objective: 'realtime latency', color: COLORS[0],
  }
  const requests: RequestSample[] = requestRows.map((row) => ({
    requestId: `${runName}:${row.request_number}`,
    tenant: realtimeTenant.id,
    priority: realtimeTenant.priority,
    start: numberValue(row, 'elapsed_seconds'),
    ttft: numberValue(row, 'ttft_ms') / 1000,
    latency: numberValue(row, 'e2e_latency_ms') / 1000,
    status: numberValue(row, 'http_status'),
    promptTokens: optionalNumber(row, 'prompt_tokens'),
    completionTokens: optionalNumber(row, 'completion_tokens'),
    tpot: optionalNumber(row, 'tpot_ms_per_token') === null ? null : numberValue(row, 'tpot_ms_per_token') / 1000,
  }))
  const frameTimes = frameRows.map((row) => numberValue(row, 'run_elapsed_seconds'))
  const counts = eventCounts(requests, frameTimes)
  const frames: TimelineFrame[] = frameRows.map((row, index) => {
    const time = frameTimes[index]
    const running = [1, 2].map((replica) => ({
      pod: `model replica ${replica}`,
      running: Math.max(0, Math.floor(numberValue(row, `model_replica_${replica}_running_requests`))),
      waiting: Math.max(0, Math.floor(numberValue(row, `model_replica_${replica}_waiting_requests`))),
      kvCacheUsage: Math.max(0, Math.min(1, numberValue(row, `model_replica_${replica}_kv_cache_usage_ratio`))),
      preemptions: Math.max(0, Math.floor(numberValue(row, 'vllm_preemptions_total'))),
      aggregated: false,
    }))
    const inflight = requests.filter((request) => request.start <= time && request.start + request.latency > time).length
    return {
      time,
      saturation: numberValue(row, 'endpoint_picker_saturation_ratio'),
      arrivals: counts[index][0],
      completions: counts[index][1],
      tenants: [{
        id: realtimeTenant.id,
        targetConcurrency: 0,
        actualInflight: inflight,
        targetRps: null,
        arrivalProcess: 'open-loop burst',
        issuedRequests: null,
        completedRequests: null,
        outstandingRequests: inflight,
        sendDelay: null,
        safetyCeilingState: null,
      }],
      queues: [{
        id: 'batch work',
        priority: -10,
        size: Math.max(0, Math.floor(numberValue(row, 'endpoint_picker_queue_requests'))),
        bytes: 0,
      }],
      vllm: running,
    }
  })
  const configured = configValues(config)
  const sampleInterval = frameTimes.length > 1 ? frameTimes[1] - frameTimes[0] : 0
  return {
    schemaVersion: 1,
    metadata: {
      runId: runName,
      scenario: 'batch eviction across two model replicas',
      duration: frameTimes.at(-1) ?? 0,
      sampleInterval,
      trafficMode: 'open_loop_poisson',
      generatedAt: new Date().toISOString(),
      source: 'ingested',
    },
    limits: { maxSequences: configured.maxSequences, maxBatchedTokens: configured.maxBatchedTokens },
    runtime: { schedulerPolicy: 'fcfs', chunkedPrefill: null },
    routing: { priorityBands: [
      { priority: 100, label: 'Realtime', color: COLORS[0] },
      { priority: -10, label: 'Batch', color: COLORS[2] },
    ] },
    tenants: [realtimeTenant],
    frames,
    summary: {
      requestCount: requests.length,
      errorCount: requests.filter((request) => request.status >= 400 || request.status === 0).length,
      maxEppQueue: Math.max(0, ...frames.map((frame) => frame.queues[0].size)),
      maxVllmWaiting: Math.max(0, ...frames.map((frame) => frame.vllm.reduce((sum, pod) => sum + pod.waiting, 0))),
      maxVllmRunning: Math.max(0, ...frames.map((frame) => frame.vllm.reduce((sum, pod) => sum + pod.running, 0))),
      maxSaturation: Math.max(0, ...frames.map((frame) => frame.saturation)),
    },
    evidence: {
      metricResolution: `${sampleInterval.toFixed(2)} seconds`,
      requestCorrelation: true,
      exactBatchMembership: false,
      capabilities: {
        hasOpenLoop: true,
        hasPerRequestTokens: true,
        hasRequestIds: true,
        hasTpot: true,
        hasPerPodVllm: true,
        hasEppQueueDurations: false,
      },
      notes: [
        'Replay generated directly from the public two-model batch-eviction evidence.',
        'Per-model running, waiting, and KV-cache values are exact at the recorded sampling interval.',
        'Eviction and retry outcomes remain in the package correlation CSV and are not inferred by the animation.',
      ],
    },
  }
}

export async function listPublishedRuns(packageDir: string): Promise<string[]> {
  const directory = resolve(packageDir)
  const requestFile = await exists(resolve(directory, 'request-results.csv'))
    ? 'request-results.csv'
    : await exists(resolve(directory, 'realtime-requests.csv')) ? 'realtime-requests.csv' : null
  if (!requestFile) return []
  const rows = await readCsv(resolve(directory, requestFile))
  return [...new Set(rows.map((row) => row.run_name).filter(Boolean))]
}

export async function ingestPublishedPackage(options: PackageIngestOptions): Promise<RunData> {
  const directory = resolve(options.packageDir)
  if (await exists(resolve(directory, 'request-results.csv'))
      && await exists(resolve(directory, 'system-metrics.csv'))) {
    return ingestLongForm(directory, options.runName)
  }
  if (await exists(resolve(directory, 'realtime-requests.csv'))
      && await exists(resolve(directory, 'traffic-samples.csv'))) {
    return ingestBatchEviction(directory, options.runName)
  }
  throw new Error('Package does not contain replayable request and time-series metric data')
}

function parseArguments(argv: string[]): PackageIngestOptions {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const packageDir = valueAfter('--package-dir')
  if (!packageDir) throw new Error('Missing --package-dir')
  return {
    packageDir,
    runName: valueAfter('--run-name') ?? null,
    output: resolve(valueAfter('--output') ?? 'public/data/run.json'),
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const data = await ingestPublishedPackage(options)
  await mkdir(dirname(options.output), { recursive: true })
  await writeFile(options.output, `${JSON.stringify(data)}\n`, 'utf8')
  process.stdout.write(`Ingested ${data.metadata.runId}: ${data.summary.requestCount} requests, ${data.frames.length} frames\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
