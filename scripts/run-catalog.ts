import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import type { RunCatalogEntry, RunData } from '../src/types'
import { ingestRun } from './ingest-run'

type CatalogRecord = RunCatalogEntry & {
  runDir: string
}

const RUN_CACHE_SIZE = 8

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findRunDirectories(root: string): Promise<string[]> {
  const found: string[] = []

  async function visit(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'client_samples.csv')) {
      found.push(directory)
      return
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map((entry) => visit(resolve(directory, entry.name))),
    )
  }

  await visit(root)
  return found
}

function requestCountFrom(summary: Record<string, unknown>): number {
  if (!Array.isArray(summary.client_summary)) return 0
  return summary.client_summary.reduce((total: number, tenant) => {
    if (!tenant || typeof tenant !== 'object') return total
    const count = Number((tenant as Record<string, unknown>).total)
    return total + (Number.isFinite(count) ? count : 0)
  }, 0)
}

async function catalogRecord(root: string, runDir: string): Promise<CatalogRecord> {
  let summary: Record<string, unknown> = {}
  try {
    summary = JSON.parse(await readFile(resolve(runDir, 'summary.json'), 'utf8')) as Record<string, unknown>
  } catch {
    summary = {}
  }

  const [hasConcurrency, hasMetrics] = await Promise.all([
    exists(resolve(runDir, 'concurrency_samples.csv')),
    exists(resolve(runDir, 'metric_samples.csv')),
  ])
  let metricHeader = ''
  if (hasMetrics) {
    try {
      metricHeader = (await readFile(resolve(runDir, 'metric_samples.csv'), 'utf8')).split(/\r?\n/, 1)[0]
    } catch {
      metricHeader = ''
    }
  }
  const hasFlowQueues = metricHeader.includes('inference_extension_flow_control_queue_size|')
  const hasVllmPressure = metricHeader.includes('vllm:num_requests_running')
  const relativeParent = relative(root, dirname(runDir))
  const groupParts = relativeParent.split(sep).filter(Boolean).slice(-2)
  const group = groupParts.length > 0 ? groupParts.join(' / ') : basename(root)
  const runId = String(summary.run_id ?? basename(runDir))
  const scenario = String(summary.scenario ?? runId)
  const duration = Number(summary.duration_s ?? 0)
  const id = createHash('sha1').update(runDir).digest('hex').slice(0, 14)

  return {
    id,
    runId,
    scenario,
    group,
    duration: Number.isFinite(duration) ? duration : 0,
    requestCount: requestCountFrom(summary),
    replayLevel: hasFlowQueues && hasVllmPressure
      ? (hasConcurrency ? 'full' : 'queues-and-runtime')
      : 'client-only',
    runDir,
  }
}

async function buildCatalog(roots: string[]): Promise<CatalogRecord[]> {
  const records = await Promise.all(
    roots.map(async (root) => {
      const directories = await findRunDirectories(root)
      return Promise.all(directories.map((runDir) => catalogRecord(root, runDir)))
    }),
  )

  return records
    .flat()
    .sort((left, right) => left.group.localeCompare(right.group) || left.runId.localeCompare(right.runId))
}

function sendJson(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

export function runCatalogPlugin(roots: string[]): Plugin {
  let catalogPromise: Promise<CatalogRecord[]> | undefined
  const runCache = new Map<string, RunData>()
  const getCatalog = () => {
    catalogPromise ??= buildCatalog(roots)
    return catalogPromise
  }

  return {
    name: 'flow-control-run-catalog',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost')
        if (url.pathname !== '/api/runs' && url.pathname !== '/api/run') {
          next()
          return
        }

        try {
          const catalog = await getCatalog()
          if (url.pathname === '/api/runs') {
            sendJson(response, 200, catalog.map(({ runDir: _runDir, ...entry }) => entry))
            return
          }

          const id = url.searchParams.get('id')
          const record = catalog.find((candidate) => candidate.id === id)
          if (!record) {
            sendJson(response, 404, { error: 'Run not found' })
            return
          }

          const cached = runCache.get(record.id)
          if (cached) {
            sendJson(response, 200, cached)
            return
          }

          const run = await ingestRun({
            runDir: record.runDir,
            output: '',
            maxSequences: null,
            maxBatchedTokens: null,
            schedulerPolicy: null,
            chunkedPrefill: null,
          })
          runCache.delete(record.id)
          runCache.set(record.id, run)
          while (runCache.size > RUN_CACHE_SIZE) {
            const oldest = runCache.keys().next().value
            if (oldest === undefined) break
            runCache.delete(oldest)
          }
          sendJson(response, 200, run)
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to load run'
          sendJson(response, 500, { error: message })
        }
      })
    },
  }
}
