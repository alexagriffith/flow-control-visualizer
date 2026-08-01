export type TenantDefinition = {
  id: string
  priority: number
  objective: string
  color: string
}

export type PriorityBandDefinition = {
  priority: number
  label: string | null
  color: string | null
}

export type RequestSample = {
  tenant: string
  priority: number
  start: number
  ttft: number
  latency: number
  status: number
}

export type TenantFrame = {
  id: string
  targetConcurrency: number
  actualInflight: number
}

export type QueueFrame = {
  id: string
  priority: number
  size: number
  bytes: number
}

export type VllmFrame = {
  pod: string
  running: number
  waiting: number
  kvCacheUsage: number
  preemptions: number
  aggregated: boolean
}

export type TimelineFrame = {
  time: number
  saturation: number
  arrivals: number
  completions: number
  tenants: TenantFrame[]
  queues: QueueFrame[]
  vllm: VllmFrame[]
}

export type RunData = {
  schemaVersion: 1
  metadata: {
    runId: string
    scenario: string
    duration: number
    sampleInterval: number
    generatedAt: string
    source: 'demo' | 'ingested'
  }
  limits: {
    maxSequences: number | null
    maxBatchedTokens: number | null
  }
  runtime: {
    schedulerPolicy: string | null
    chunkedPrefill: boolean | null
  }
  routing?: {
    priorityBands: PriorityBandDefinition[]
  }
  tenants: TenantDefinition[]
  frames: TimelineFrame[]
  summary: {
    requestCount: number
    errorCount: number
    maxEppQueue: number
    maxVllmWaiting: number
    maxVllmRunning: number
    maxSaturation: number
  }
  evidence: {
    metricResolution: string
    requestCorrelation: boolean
    exactBatchMembership: boolean
    notes: string[]
  }
}

export type RunCatalogEntry = {
  id: string
  runId: string
  scenario: string
  group: string
  duration: number
  requestCount: number
  replayLevel: 'full' | 'queues-and-runtime' | 'client-only'
}
