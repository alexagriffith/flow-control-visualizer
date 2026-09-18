import { Fragment, useEffect, useState } from 'react'
import type { ProgressData } from '../progress-types'
import './progress.css'

function time(value: string): string { return new Date(value).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC') }

export function Progress() {
  const [data, setData] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState(true)
  const [expanded, setExpanded] = useState<number | null>(null)
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let controller: AbortController
    const poll = async () => {
      controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 4000)
      try {
        const response = await fetch('/api/progress', { signal: controller.signal, cache: 'no-store' })
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Progress API unavailable. Start the development server with npm run dev.')
        const value = await response.json()
        if (!response.ok) throw new Error(typeof value.error === 'string' ? value.error : 'Progress request failed.')
        if (typeof value.configured !== 'boolean' || (value.configured && !Array.isArray(value.rows))) throw new Error('Unsupported progress response.')
        if (!disposed) {
          setConfigured(value.configured)
          if (value.configured) setData(value as ProgressData)
          else setData(null)
          setError(null)
        }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Progress connection timed out. Retrying…')
      } finally {
        clearTimeout(timeout)
        if (!disposed) timer = setTimeout(() => void poll(), 5000)
      }
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer); controller?.abort() }
  }, [])
  const accepted = data?.rows.reduce((n, r) => n + r.accepted, 0) ?? 0
  const total = data?.rows.reduce((n, r) => n + r.repeats, 0) ?? 0
  return <main className="progress-page" id="progress-main">
    <header className="progress-heading"><h1>{data?.name ?? 'Benchmark progress'}</h1><span>{data?.status ?? (error ? 'Unavailable' : !configured ? 'Not connected' : 'Loading…')}</span></header>
    {error ? <p className="progress-alert" role="alert">{error} {data ? 'Showing the last readable snapshot.' : ''}</p> : null}
    {!configured ? <section className="progress-panel"><h2>Connect a saved run</h2><p>Set the harness output directory, then open this tab.</p><pre>FLOW_PROGRESS_RUN=/absolute/path/to/results npm run dev</pre><p>Read-only. No cluster access or benchmark execution.</p></section> : null}
    {data ? <>
      <div className="progress-meta" role="status">
        <span>{error ? 'Disconnected' : 'Saved checkpoints · polling every 5s'}</span>
        <span>State file updated {time(data.savedAt)}</span>
        <span>Last read {time(data.readAt)}</span>
      </div>
      {data.stale ? <p className="progress-alert">No checkpoint update for over 30 seconds. The run may still be working; this is not a process heartbeat.</p> : null}
      <section className="progress-panel">
        <header><h2>Tests</h2><span>{accepted}/{total} repeats accepted</span></header>
        <div className="progress-table-scroll"><table><thead><tr><th>Test / traffic</th><th>Repeats</th><th>State</th><th>Outcome</th><th>Config</th></tr></thead><tbody>
          {data.rows.map(row => <Fragment key={row.number}>
            <tr className="progress-test-row"><th scope="row">{row.number}. {row.name}<small>{row.load}</small></th><td data-label="Repeats">{row.accepted}/{row.repeats}</td><td data-label="State">{row.status}</td><td data-label="Outcome">{row.outcome}</td><td data-label="Config"><button aria-expanded={expanded === row.number} aria-controls={`config-${row.number}`} onClick={() => setExpanded(expanded === row.number ? null : row.number)}>View {row.number}</button></td></tr>
            {expanded === row.number ? <tr id={`config-${row.number}`}><td colSpan={5}><div className="progress-config"><strong>Safe config fields</strong><p>Source: {data.configSource.file}{data.rows.length > 1 ? ` · row ${row.number}` : ''} · modified {time(data.configSource.modifiedAt)}</p><p>Source SHA-256: <code>{data.configSource.sha256}</code></p><pre>{JSON.stringify(row.config, null, 2)}</pre><p>Endpoint, model identity, headers, prompts, paths and free-text notes are omitted. Current saved-file projection; acceptance is not revalidated. Not an executable config.</p></div></td></tr> : null}
          </Fragment>)}
        </tbody></table></div>
        <p className="progress-note">Accepted = evidence accepted by the runner, not a latency or fairness guarantee.</p>
      </section>
      <section className="progress-panel">
        <header><h2>Recorded request arrivals</h2><span>{data.traffic.records ? `${data.traffic.records} timestamped records` : 'Unavailable'}</span></header>
        {data.traffic.unavailable ? <p>{data.traffic.unavailable}</p> : <>
          <div className="progress-chart-label"><span>Requests / {data.traffic.secondsPerBin}s bin</span><span>Peak {Math.max(...data.traffic.counts)}</span></div>
          <svg className="progress-chart" viewBox="0 0 800 160" preserveAspectRatio="none" role="img" aria-label={`${data.traffic.records} recorded request starts across ${data.traffic.counts.length} time bins`}>
            {data.traffic.counts.map((count, index) => { const width = 800 / data.traffic.counts.length; const height = count / Math.max(...data.traffic.counts, 1) * 150; return <rect key={index} x={index * width} y={160 - height} width={Math.max(1, width - 2)} height={height}><title>{index * data.traffic.secondsPerBin}s: {count} requests</title></rect> })}
          </svg>
          <div className="progress-chart-label"><span>0s</span><span>{data.traffic.counts.length * data.traffic.secondsPerBin}s</span></div>
          <p className="progress-note">{data.traffic.start ? time(data.traffic.start) : ''} · {data.traffic.attempt}</p>
          <details><summary>Arrival counts</summary><p>{data.traffic.counts.map((n, i) => `${i * data.traffic.secondsPerBin}s: ${n}`).join(' · ')}</p></details>
        </>}
        {data.traffic.partial ? <p className="progress-alert">Partial request export. Missing, incomplete or oversized records are not shown.</p> : null}
        <p className="progress-note">Latest saved attempt, all streams combined, including failed requests with timestamps. Not live ingress, completions, or server queue depth.</p>
      </section>
      <p className="progress-action">{data.action}</p>
    </> : null}
  </main>
}
