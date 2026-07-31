import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { parseCsv, type CsvRow } from '../src/lib/csv'
import type {
  QueueFrame,
  RequestSample,
  RunData,
  TenantDefinition,
  TenantFrame,
} from '../src/types'

const QUEUE_SIZE_PREFIX = 'inference_extension_flow_control_queue_size|'
const QUEUE_BYTES_PREFIX = 'inference_extension_flow_control_queue_bytes|'
const COLORS = ['#2d5bff', '#168f82', '#d95b30', '#6941c6', '#b7791f', '#0077a8']

type Arguments = {
  runDir: string
  output: string
  maxSequences: number
  maxBatchedTokens: number
}

function parseArguments(argv: string[]): Arguments {
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

  return {
    runDir: resolve(runDir),
    output: resolve(valueAfter('--output') ?? 'public/data/run.json'),
    maxSequences: Number(valueAfter('--max-seqs') ?? 128),
    maxBatchedTokens: Number(valueAfter('--max-batched-tokens') ?? 8192),
  }
}

function numeric(row: CsvRow, key: string): number {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : 0
}

async function readCsv(path: string): Promise<CsvRow[]> {
  return parseCsv(await readFile(path, 'utf8'))
}

async function readSummary(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
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
  queueIds: string[],
  tenantById: Map<string, TenantDefinition>,
): QueueFrame[] {
  return queueIds.map((id) => ({
    id,
    priority: tenantById.get(id)?.priority ?? 0,
    size: numeric(row, `${QUEUE_SIZE_PREFIX}${id}`),
    bytes: numeric(row, `${QUEUE_BYTES_PREFIX}${id}`),
  }))
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

async function ingest(args: Arguments): Promise<RunData> {
  const [clientRows, concurrencyRows, metricRows, summary] = await Promise.all([
    readCsv(resolve(args.runDir, 'client_samples.csv')),
    readCsv(resolve(args.runDir, 'concurrency_samples.csv')),
    readCsv(resolve(args.runDir, 'metric_samples.csv')),
    readSummary(resolve(args.runDir, 'summary.json')),
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

  const queueIds = Object.keys(metricRows[0])
    .filter((key) => key.startsWith(QUEUE_SIZE_PREFIX))
    .map((key) => key.slice(QUEUE_SIZE_PREFIX.length))
  const frameTimes = metricRows.map((row) => numeric(row, 'elapsed_s'))
  const counts = eventCounts(requests, frameTimes)

  const frames = metricRows.map((row, index) => ({
    time: frameTimes[index],
    saturation: numeric(row, 'inference_extension_flow_control_pool_saturation'),
    arrivals: counts[index][0],
    completions: counts[index][1],
    tenants: nearestTenantFrames(samplesByTenant, tenants, frameTimes[index]),
    queues: queuesFor(row, queueIds, tenantById),
    vllm: [
      {
        pod: 'vllm-aggregate',
        running: numeric(row, 'vllm:num_requests_running'),
        waiting: numeric(row, 'vllm:num_requests_waiting'),
        kvCacheUsage: numeric(row, 'vllm:kv_cache_usage_perc'),
        preemptions: numeric(row, 'vllm:num_preemptions_total'),
        aggregated: true,
      },
    ],
  }))

  const runId = String(summary.run_id ?? metricRows[0].run_id ?? basename(args.runDir))
  const scenario = String(summary.scenario ?? metricRows[0].scenario ?? 'Unknown scenario')

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
      maxSequences: args.maxSequences,
      maxBatchedTokens: args.maxBatchedTokens,
    },
    tenants,
    requests,
    frames,
    summary: {
      requestCount: requests.length,
      errorCount: requests.filter((request) => request.status >= 400 || request.status === 0).length,
      maxEppQueue: Math.max(0, ...frames.flatMap((frame) => frame.queues.map((queue) => queue.size))),
      maxVllmWaiting: Math.max(0, ...frames.flatMap((frame) => frame.vllm.map((pod) => pod.waiting))),
      maxVllmRunning: Math.max(0, ...frames.flatMap((frame) => frame.vllm.map((pod) => pod.running))),
      maxSaturation: Math.max(0, ...frames.map((frame) => frame.saturation)),
    },
    evidence: {
      metricResolution: `${sampleInterval(frameTimes).toFixed(2)} seconds`,
      requestCorrelation: false,
      exactBatchMembership: false,
      notes: [
        'Client and server metrics share elapsed run time but do not carry a common request ID.',
        'Queue transitions shorter than the sampling interval may not appear.',
        'vLLM metrics are aggregate because the source CSV does not preserve pod labels.',
      ],
    },
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const data = await ingest(args)
  await mkdir(resolve(args.output, '..'), { recursive: true })
  await writeFile(args.output, `${JSON.stringify(data)}\n`, 'utf8')
  process.stdout.write(
    `Ingested ${data.summary.requestCount} requests and ${data.frames.length} metric frames into ${args.output}\n`,
  )
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`Ingestion failed: ${message}\n`)
  process.exitCode = 1
})
