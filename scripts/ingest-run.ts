import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseCsv, type CsvRow } from '../src/lib/csv'
import type {
  QueueFrame,
  PriorityBandDefinition,
  RequestSample,
  RunData,
  TenantDefinition,
  TenantFrame,
  VllmFrame,
} from '../src/types'

const QUEUE_SIZE_PREFIX = 'inference_extension_flow_control_queue_size|'
const QUEUE_BYTES_PREFIX = 'inference_extension_flow_control_queue_bytes|'
const VLLM_RUNNING_PREFIX = 'vllm:num_requests_running|'
const VLLM_WAITING_PREFIX = 'vllm:num_requests_waiting|'
const VLLM_CACHE_PREFIX = 'vllm:gpu_cache_usage_perc|'
const VLLM_PREEMPTIONS_PREFIX = 'vllm:num_preemptions_total|'
const COLORS = ['#2d5bff', '#168f82', '#d95b30', '#6941c6', '#b7791f', '#0077a8']

export type IngestOptions = {
  runDir: string
  output: string
  maxSequences: number | null
  maxBatchedTokens: number | null
  schedulerPolicy: string | null
  chunkedPrefill: boolean | null
}

function parseArguments(argv: string[]): IngestOptions {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const runDir = valueAfter('--run-dir')
  if (!runDir) {
    throw new Error(
      'Missing --run-dir. Example: npm run ingest -- --run-dir /absolute/path/to/run',
    )
  }

  const maxSequences = valueAfter('--max-seqs')
  const maxBatchedTokens = valueAfter('--max-batched-tokens')
  const chunkedPrefill = valueAfter('--chunked-prefill')

  return {
    runDir: resolve(runDir),
    output: resolve(valueAfter('--output') ?? 'public/data/run.json'),
    maxSequences: maxSequences === undefined ? null : Number(maxSequences),
    maxBatchedTokens: maxBatchedTokens === undefined ? null : Number(maxBatchedTokens),
    schedulerPolicy: valueAfter('--scheduler-policy') ?? null,
    chunkedPrefill: chunkedPrefill === undefined ? null : chunkedPrefill !== 'false',
  }
}

function numeric(row: CsvRow, key: string): number {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : 0
}

async function readCsv(path: string): Promise<CsvRow[]> {
  return parseCsv(await readFile(path, 'utf8'))
}

async function readCsvOptional(path: string): Promise<CsvRow[]> {
  try {
    return await readCsv(path)
  } catch {
    return []
  }
}

async function readSummary(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function readBenchmarkConfig(runDir: string): Promise<Record<string, unknown>> {
  for (const directory of [runDir, dirname(runDir), dirname(dirname(runDir))]) {
    const config = await readSummary(resolve(directory, 'benchmark_config.json'))
    if (Object.keys(config).length > 0) return config
  }
  return {}
}

function tenantDefinitions(rows: CsvRow[]): TenantDefinition[] {
  const tenants = new Map<string, Omit<TenantDefinition, 'color'>>()
  for (const row of rows) {
    if (!row.tenant || tenants.has(row.tenant)) continue
    tenants.set(row.tenant, {
      id: row.tenant,
      priority: numeric(row, 'priority'),
      objective: row.objective || 'unknown',
    })
  }

  return [...tenants.values()]
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .map((tenant, index) => ({ ...tenant, color: COLORS[index % COLORS.length] }))
}

function requestSamples(rows: CsvRow[]): RequestSample[] {
  return rows
    .map((row) => ({
      tenant: row.tenant,
      priority: numeric(row, 'priority'),
      start: numeric(row, 'start_s'),
      ttft: numeric(row, 'ttft_s'),
      latency: numeric(row, 'latency_s'),
      status: numeric(row, 'status'),
    }))
    .sort((left, right) => left.start - right.start)
}

function nearestTenantFrames(
  samplesByTenant: Map<string, CsvRow[]>,
  tenants: TenantDefinition[],
  time: number,
): TenantFrame[] {
  return tenants.map((tenant) => {
    const samples = samplesByTenant.get(tenant.id) ?? []
    let nearest: CsvRow | undefined
    let nearestDistance = Number.POSITIVE_INFINITY

    for (const sample of samples) {
      const distance = Math.abs(numeric(sample, 'elapsed_s') - time)
      if (distance < nearestDistance) {
        nearest = sample
        nearestDistance = distance
      }
    }

    return {
      id: tenant.id,
      targetConcurrency: nearest ? numeric(nearest, 'target_concurrency') : 0,
      actualInflight: nearest ? numeric(nearest, 'actual_inflight') : 0,
    }
  })
}

function queuesFor(
  row: CsvRow,
  queueKeys: string[],
  tenantById: Map<string, TenantDefinition>,
): QueueFrame[] {
  const inferredPriority = (id: string): number => {
    const recorded = tenantById.get(id)?.priority
    if (recorded !== undefined) return recorded
    if (id.toLowerCase().includes('premium')) return 100
    if (id.toLowerCase().includes('batch')) return -10
    return 0
  }

  return queueKeys.map((sizeKey) => {
    const suffix = sizeKey.slice(QUEUE_SIZE_PREFIX.length)
    const labels = Object.fromEntries(
      suffix.split('|').filter((part) => part.includes('=')).map((part) => {
        const separator = part.indexOf('=')
        return [part.slice(0, separator), part.slice(separator + 1)]
      }),
    )
    const id = labels.fairness_id ?? suffix
    const recordedPriority = Number(labels.priority)
    return {
      id,
      priority: Number.isFinite(recordedPriority) ? recordedPriority : inferredPriority(id),
      size: numeric(row, sizeKey),
      bytes: numeric(row, `${QUEUE_BYTES_PREFIX}${suffix}`),
    }
  })
}

function labelsFromSuffix(suffix: string): Record<string, string> {
  return Object.fromEntries(
    suffix.split('|').filter((part) => part.includes('=')).map((part) => {
      const separator = part.indexOf('=')
      return [part.slice(0, separator), part.slice(separator + 1)]
    }),
  )
}

export function vllmFor(row: CsvRow, runningKeys: string[]): VllmFrame[] {
  if (runningKeys.length === 0) {
    return [{
      pod: 'vllm-aggregate',
      running: numeric(row, 'vllm:num_requests_running'),
      waiting: numeric(row, 'vllm:num_requests_waiting'),
      kvCacheUsage: numeric(row, 'vllm:kv_cache_usage_perc') || numeric(row, 'vllm:gpu_cache_usage_perc'),
      preemptions: numeric(row, 'vllm:num_preemptions') || numeric(row, 'vllm:num_preemptions_total'),
      aggregated: true,
    }]
  }

  return runningKeys.map((runningKey, index) => {
    const suffix = runningKey.slice(VLLM_RUNNING_PREFIX.length)
    const labels = labelsFromSuffix(suffix)
    const pod = labels.pod ?? labels.instance ?? labels.engine ?? labels.model_name ?? `vllm-${index + 1}`
    return {
      pod,
      running: numeric(row, runningKey),
      waiting: numeric(row, `${VLLM_WAITING_PREFIX}${suffix}`),
      kvCacheUsage: numeric(row, `${VLLM_CACHE_PREFIX}${suffix}`),
      preemptions: numeric(row, `${VLLM_PREEMPTIONS_PREFIX}${suffix}`),
      aggregated: false,
    }
  })
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'on' || value === 'true') return true
  if (value === 'off' || value === 'false') return false
  return null
}

export function configuredPriorityBands(config: Record<string, unknown>): PriorityBandDefinition[] {
  const eppRuntime = objectValue(config.epp_runtime)
  const configured = Array.isArray(eppRuntime.priority_bands)
    ? eppRuntime.priority_bands
    : Array.isArray(config.priority_bands) ? config.priority_bands : []

  return configured.flatMap((value) => {
    const band = objectValue(value)
    const priority = finiteNumber(band.priority)
    if (priority === null) return []
    return [{
      priority,
      label: typeof band.label === 'string' && band.label.trim() ? band.label.trim() : null,
      color: typeof band.color === 'string' && band.color.trim() ? band.color.trim() : null,
    }]
  })
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

function sampleInterval(times: number[]): number {
  if (times.length < 2) return 0
  const differences = times
    .slice(1)
    .map((time, index) => time - times[index])
    .sort((left, right) => left - right)
  return differences[Math.floor(differences.length / 2)]
}

export async function ingestRun(args: IngestOptions): Promise<RunData> {
  const [clientRows, concurrencyRows, metricRows, summary, benchmarkConfig] = await Promise.all([
    readCsv(resolve(args.runDir, 'client_samples.csv')),
    readCsvOptional(resolve(args.runDir, 'concurrency_samples.csv')),
    readCsv(resolve(args.runDir, 'metric_samples.csv')),
    readSummary(resolve(args.runDir, 'summary.json')),
    readBenchmarkConfig(args.runDir),
  ])

  if (metricRows.length === 0) throw new Error('metric_samples.csv contains no samples')

  const tenants = tenantDefinitions(clientRows)
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]))
  const requests = requestSamples(clientRows)
  const samplesByTenant = new Map<string, CsvRow[]>()
  for (const row of concurrencyRows) {
    const samples = samplesByTenant.get(row.tenant) ?? []
    samples.push(row)
    samplesByTenant.set(row.tenant, samples)
  }

  const queueKeys = Object.keys(metricRows[0])
    .filter((key) => key.startsWith(QUEUE_SIZE_PREFIX))
  const vllmRunningKeys = Object.keys(metricRows[0])
    .filter((key) => key.startsWith(VLLM_RUNNING_PREFIX))
  const frameTimes = metricRows.map((row) => numeric(row, 'elapsed_s'))
  const counts = eventCounts(requests, frameTimes)

  const frames = metricRows.map((row, index) => ({
    time: frameTimes[index],
    saturation: numeric(row, 'inference_extension_flow_control_pool_saturation'),
    arrivals: counts[index][0],
    completions: counts[index][1],
    tenants: nearestTenantFrames(samplesByTenant, tenants, frameTimes[index]),
    queues: queuesFor(row, queueKeys, tenantById),
    vllm: vllmFor(row, vllmRunningKeys),
  }))

  const runId = String(summary.run_id ?? metricRows[0].run_id ?? basename(args.runDir))
  const scenario = String(summary.scenario ?? metricRows[0].scenario ?? 'Unknown scenario')
  const runtimeConfig = objectValue(benchmarkConfig.vllm_runtime)
  const maxSequences = args.maxSequences ?? finiteNumber(runtimeConfig.max_num_seqs)
  const maxBatchedTokens = args.maxBatchedTokens ?? finiteNumber(runtimeConfig.max_num_batched_tokens)
  const schedulerPolicy = args.schedulerPolicy ?? (
    typeof runtimeConfig.scheduler_policy === 'string' && runtimeConfig.scheduler_policy !== 'unknown'
      ? runtimeConfig.scheduler_policy
      : null
  )
  const chunkedPrefill = args.chunkedPrefill ?? booleanValue(runtimeConfig.chunked_prefill)
  const hasRequestIds = clientRows.some((row) => Boolean(row.client_request_id))
  const configuredBands = configuredPriorityBands(benchmarkConfig)
  const observedPriorities = [...new Set([
    ...configuredBands.map((band) => band.priority),
    ...tenants.map((tenant) => tenant.priority),
    ...frames.flatMap((frame) => frame.queues.map((queue) => queue.priority)),
  ])].sort((left, right) => right - left)
  const priorityBands = observedPriorities.map((priority) => {
    const configured = configuredBands.find((band) => band.priority === priority)
    const tenant = tenants.find((candidate) => candidate.priority === priority)
    return configured ?? { priority, label: null, color: tenant?.color ?? null }
  })

  return {
    schemaVersion: 1,
    metadata: {
      runId,
      scenario,
      duration: Number(summary.duration_s ?? frameTimes.at(-1) ?? 0),
      sampleInterval: sampleInterval(frameTimes),
      generatedAt: new Date().toISOString(),
      source: 'ingested',
    },
    limits: {
      maxSequences,
      maxBatchedTokens,
    },
    runtime: {
      schedulerPolicy,
      chunkedPrefill,
    },
    routing: { priorityBands },
    tenants,
    frames,
    summary: {
      requestCount: requests.length,
      errorCount: requests.filter((request) => request.status >= 400 || request.status === 0).length,
      maxEppQueue: Math.max(0, ...frames.flatMap((frame) => frame.queues.map((queue) => queue.size))),
      maxVllmWaiting: Math.max(0, ...frames.map((frame) => frame.vllm.reduce((total, pod) => total + pod.waiting, 0))),
      maxVllmRunning: Math.max(0, ...frames.map((frame) => frame.vllm.reduce((total, pod) => total + pod.running, 0))),
      maxSaturation: Math.max(0, ...frames.map((frame) => frame.saturation)),
    },
    evidence: {
      metricResolution: `${sampleInterval(frameTimes).toFixed(2)} seconds`,
      requestCorrelation: hasRequestIds,
      exactBatchMembership: false,
      notes: [
        hasRequestIds
          ? 'Client request IDs and token event timing are available; engine-step membership is not.'
          : 'Client and server metrics share elapsed run time but do not carry a common request ID.',
        'Queue transitions shorter than the sampling interval may not appear.',
        vllmRunningKeys.length > 0
          ? 'vLLM series labels are preserved so each recorded engine or pod can be replayed separately.'
          : 'vLLM metrics are aggregate because the source CSV does not preserve pod labels.',
      ],
    },
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const data = await ingestRun(args)
  await mkdir(dirname(args.output), { recursive: true })
  await writeFile(args.output, `${JSON.stringify(data)}\n`, 'utf8')
  process.stdout.write(
    `Ingested ${data.summary.requestCount} requests and ${data.frames.length} metric frames into ${args.output}\n`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Ingestion failed: ${message}\n`)
    process.exitCode = 1
  })
}
