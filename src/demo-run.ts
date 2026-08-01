import type { RunData, TenantDefinition, TimelineFrame } from './types'

const tenants: TenantDefinition[] = [
  { id: 'premium-a', priority: 100, objective: 'premium', color: '#2d5bff' },
  { id: 'standard-a', priority: 0, objective: 'standard', color: '#168f82' },
  { id: 'batch-a', priority: -10, objective: 'batch', color: '#d95b30' },
]

function pulse(time: number, start: number, end: number, height: number): number {
  if (time < start || time > end) return 0
  const phase = (time - start) / (end - start)
  return Math.max(0, Math.sin(phase * Math.PI)) * height
}

function makeFrames(): TimelineFrame[] {
  return Array.from({ length: 121 }, (_, time) => {
    const premiumQueue = Math.round(pulse(time, 44, 86, 8))
    const standardQueue = Math.round(pulse(time, 35, 98, 22))
    const batchQueue = Math.round(pulse(time, 30, 108, 38))
    const totalQueue = premiumQueue + standardQueue + batchQueue
    const running = Math.min(128, Math.round(42 + time * 1.7 + pulse(time, 28, 110, 55)))
    const waiting = Math.round(pulse(time, 32, 108, 74))

    return {
      time,
      saturation: Math.max(0, (running + waiting - 112) / 16),
      arrivals: time > 26 && time < 104 ? 8 + Math.round(Math.sin(time / 4) * 2) : 2,
      completions: time > 31 && time < 114 ? 7 + Math.round(Math.cos(time / 5) * 2) : 2,
      tenants: [
        { id: 'premium-a', targetConcurrency: time < 25 ? 12 : 36, actualInflight: Math.min(38, 11 + Math.round(time / 6)) },
        { id: 'standard-a', targetConcurrency: time < 25 ? 10 : 52, actualInflight: Math.min(54, 9 + Math.round(time / 3.5)) },
        { id: 'batch-a', targetConcurrency: time < 30 ? 0 : 72, actualInflight: time < 30 ? 0 : Math.min(74, Math.round((time - 30) / 1.2)) },
      ],
      queues: [
        { id: 'premium-a', priority: 100, size: premiumQueue, bytes: premiumQueue * 620 },
        { id: 'standard-a', priority: 0, size: standardQueue, bytes: standardQueue * 710 },
        { id: 'batch-a', priority: -10, size: batchQueue, bytes: batchQueue * 840 },
      ],
      vllm: [
        {
          pod: 'vllm-0',
          running,
          waiting,
          kvCacheUsage: Math.min(0.94, running / 142),
          preemptions: totalQueue > 40 ? Math.round((totalQueue - 40) / 3) : 0,
          aggregated: false,
        },
      ],
    }
  })
}

const frames = makeFrames()

export const demoRun: RunData = {
  schemaVersion: 1,
  metadata: {
    runId: 'synthetic-three-tier-pressure',
    scenario: 'Three-tier saturation demonstration',
    duration: 120,
    sampleInterval: 1,
    trafficMode: 'closed_loop',
    generatedAt: '2026-07-31T00:00:00.000Z',
    source: 'demo',
  },
  limits: { maxSequences: 128, maxBatchedTokens: 8192 },
  runtime: { schedulerPolicy: 'fcfs', chunkedPrefill: true },
  routing: {
    priorityBands: [
      { priority: 100, label: 'Premium', color: '#2d5bff' },
      { priority: 0, label: 'Standard', color: '#168f82' },
      { priority: -10, label: 'Batch', color: '#d95b30' },
    ],
  },
  tenants,
  frames,
  summary: {
    requestCount: 1_184,
    errorCount: 0,
    maxEppQueue: Math.max(...frames.flatMap((frame) => frame.queues.map((queue) => queue.size))),
    maxVllmWaiting: Math.max(...frames.flatMap((frame) => frame.vllm.map((pod) => pod.waiting))),
    maxVllmRunning: Math.max(...frames.flatMap((frame) => frame.vllm.map((pod) => pod.running))),
    maxSaturation: Math.max(...frames.map((frame) => frame.saturation)),
  },
  evidence: {
    metricResolution: '1 second (synthetic)',
    requestCorrelation: false,
    exactBatchMembership: false,
    capabilities: {
      hasOpenLoop: false,
      hasPerRequestTokens: false,
      hasRequestIds: false,
      hasTpot: false,
      hasPerPodVllm: true,
      hasEppQueueDurations: false,
    },
    notes: [
      'Queue and pod metrics are synchronized aggregates.',
      'Animated request pulses illustrate flow direction, not individual requests.',
      'Exact vLLM iteration membership requires opt-in runtime events.',
    ],
  },
}
