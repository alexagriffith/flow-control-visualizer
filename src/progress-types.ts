export type ProgressRow = {
  number: number
  name: string
  load: string
  accepted: number
  repeats: number
  status: string
  outcome: string
  config: Record<string, unknown>
}

export type ProgressData = {
  configured: boolean
  source: 'harness' | 'aiperf'
  currentRow: number | null
  name: string
  status: string
  savedAt: string
  readAt: string
  stale: boolean
  rows: ProgressRow[]
  configSource: { file: string; sha256: string; modifiedAt: string } | null
  action: string
  traffic: {
    attempt: string | null
    start: string | null
    secondsPerBin: number
    counts: number[]
    records: number
    partial: boolean
    unavailable: string | null
  }
}
