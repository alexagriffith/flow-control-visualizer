import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'

export type Json = Record<string, unknown>
export function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
  return value as Json
}
export function integer(value: unknown, max = 100000): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) throw new Error('Invalid count')
  return Number(value)
}
export function label(value: unknown, fallback: string): string {
  // Only operator-facing identifiers, never free text, URLs, paths or error logs.
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,79}$/.test(value) ? value : fallback
}
export async function readBounded(root: string, path: string, limit = 2 * 1024 * 1024) {
  const parts = path.split('/')
  if (parts.some(p => !p || p === '.' || p === '..' || p.includes('\\'))) throw new Error('Unsafe artifact path')
  const base = await realpath(root)
  let target = base
  for (const part of parts) {
    target = resolve(target, part)
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Symbolic links are not supported')
  }
  if (!(await realpath(target)).startsWith(base + sep)) throw new Error('Artifact outside run directory')
  if (!(await lstat(target)).isFile()) throw new Error('Artifact is not a regular file')
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) throw new Error('Artifact is not a supported bounded file')
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    if (bytesRead > limit) throw new Error('Artifact exceeds read limit')
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), modifiedAt: stat.mtime.toISOString() }
  } finally { await handle.close() }
}

export function projectedConfig(config: Json): Json {
  const output: Json = {}
  const keys: Record<string, string[]> = {
    load: ['concurrency', 'rates', 'max_concurrency', 'requests', 'repeats', 'duration_seconds',
      'request_timeout_seconds', 'grace_seconds', 'deadline_seconds', 'max_attempts_per_repeat'],
    workload: ['input_tokens', 'output_tokens'],
    goals: ['ttft_p95_ms', 'latency_p95_ms', 'max_error_fraction'],
  }
  for (const [group, fields] of Object.entries(keys)) {
    const source = config[group] ? object(config[group]) : {}
    const safe: Json = {}
    for (const key of fields) {
      const value = source[key]
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) safe[key] = value
      if (Array.isArray(value) && value.length <= 1000 && value.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)) safe[key] = value
    }
    if (group === 'workload' && ['synthetic', 'single_turn'].includes(String(source.type))) safe.type = source.type
    if (group === 'load' && ['constant', 'poisson'].includes(String(source.arrival))) safe.arrival = source.arrival
    output[group] = safe
  }
  return output
}
