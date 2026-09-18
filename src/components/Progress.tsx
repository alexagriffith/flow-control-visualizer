import { Fragment, useEffect, useState } from 'react'
import type { ProgressData } from '../progress-types'
import { TrafficChart } from './TrafficChart'
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
  const current = data?.rows.find(row => row.number === data.currentRow)
  return <main className="progress-page" id="progress-main">
    <header className="progress-heading"><h1>{data?.name ?? 'Benchmark progress'}</h1><span>{data?.status ?? (error ? 'Unavailable' : !configured ? 'Not connected' : 'Loading…')}</span></header>
    {error ? <p className="progress-alert" role="alert">{error} {data ? 'Showing the last readable snapshot.' : ''}</p> : null}
    {!configured ? <section className="progress-panel"><h2>Connect saved artifacts</h2><p>Select a native AIPerf export directory or a harness output directory.</p><pre>FLOW_PROGRESS_RUN=/absolute/path/to/results npm run dev</pre><p>Read-only. No cluster access or benchmark execution.</p></section> : null}
    {data ? <>
      <div className="progress-meta" role="status">
        <span>{error ? 'Disconnected' : `${data.source === 'harness' ? 'Harness checkpoint' : 'Native AIPerf'} · polling every 5s`}</span>
        <span>File updated {time(data.savedAt)}</span>
        <span>Last read {time(data.readAt)}</span>
      </div>
      {data.stale ? <p className="progress-alert">No checkpoint update for over 30 seconds. The run may still be working; this is not a process heartbeat.</p> : null}
      <section className="progress-current" aria-label="Saved activity">
        <div><strong>{current ? `${current.number}. ${current.name}` : data.source === 'harness' ? `${accepted}/${total} repeats accepted` : 'No test plan supplied'}</strong>{current ? <span>{current.load} · {current.accepted}/{current.repeats} repeats accepted</span> : null}</div>
        <div><p>{data.action}</p>{data.source === 'harness' ? <details><summary>Read the full report</summary><p>Suggested command, in the harness checkout; replace the output path.</p><code>make report RUN=/absolute/path/to/results</code></details> : null}</div>
      </section>
      <TrafficChart traffic={data.traffic} source={data.source} />
      {data.source === 'harness' ? <>
      <section className="progress-panel">
        <header><h2>Test plan</h2><span>{data.rows.filter(row => row.accepted === row.repeats).length}/{data.rows.length} tests completed</span></header>
        <div className="progress-table-scroll"><table><thead><tr><th>Test / traffic</th><th>Repeats</th><th>State</th><th>Outcome</th><th>Config</th></tr></thead><tbody>
          {data.rows.map(row => <Fragment key={row.number}>
            <tr className={`progress-test-row${row.number === data.currentRow ? ' current' : ''}`}><th scope="row">{row.number}. {row.name}<small>{row.load}</small></th><td data-label="Repeats">{row.accepted}/{row.repeats}</td><td data-label="State">{row.accepted === row.repeats ? 'Completed' : row.status}</td><td data-label="Outcome">{row.outcome}</td><td data-label="Config"><button aria-expanded={expanded === row.number} aria-controls={`config-${row.number}`} onClick={() => setExpanded(expanded === row.number ? null : row.number)}>View {row.number}</button></td></tr>
            {expanded === row.number && data.configSource ? <tr id={`config-${row.number}`}><td colSpan={5}><div className="progress-config"><strong>Safe config fields</strong><p>Source: {data.configSource.file}{data.rows.length > 1 ? ` · row ${row.number}` : ''} · modified {time(data.configSource.modifiedAt)}</p><p>Source SHA-256: <code>{data.configSource.sha256}</code></p><pre>{JSON.stringify(row.config, null, 2)}</pre><p>Endpoint, model identity, headers, prompts, paths and free-text notes are omitted. Current saved-file projection; acceptance is not revalidated. Not an executable config.</p></div></td></tr> : null}
          </Fragment>)}
        </tbody></table></div>
        <p className="progress-note">Completed = all repeats accepted by the runner. Check outcomes separately; completion does not establish latency or fairness.</p>
      </section>
      </> : <p className="progress-note">Native records show observed traffic only. Harness config/state adds planned tests, repeat progress and saved outcomes. CSV replay is a separate view.</p>}
    </> : null}
  </main>
}
