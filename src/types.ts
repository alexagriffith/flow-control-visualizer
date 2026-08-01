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
  requestId?: string
  tenant: string
  priority: number
  start: number
  plannedArrival?: number | null
  actualSend?: number | null
  sendDelay?: number | null
  ttft: number
  latency: number
  status: number
  promptTokens?: number | null
  completionTokens?: number | null
  tpot?: number | null
  errorClass?: string | null
  retryCount?: number | null
  timeout?: boolean | null
}

export type TenantFrame = {
  id: string
  targetConcurrency: number
  actualInflight: number
  targetRps?: number | null
  arrivalProcess?: string | null
  issuedRequests?: number | null
  completedRequests?: number | null
  outstandingRequests?: number | null
  sendDelay?: number | null
  safetyCeilingState?: string | null
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
    trafficMode?: 'closed_loop' | 'open_loop_poisson' | 'unknown'
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
    capabilities?: {
      hasOpenLoop: boolean
      hasPerRequestTokens: boolean
      hasRequestIds: boolean
      hasTpot: boolean
      hasPerPodVllm: boolean
      hasEppQueueDurations: boolean
    }
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
