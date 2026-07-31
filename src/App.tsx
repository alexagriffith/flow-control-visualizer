import { useEffect, useMemo, useRef, useState } from 'react'
import { ClientLayer } from './components/ClientLayer'
import { EppLayer } from './components/EppLayer'
import { TimelineControl } from './components/TimelineControl'
import { VllmLayer } from './components/VllmLayer'
import { demoRun } from './demo-run'
import { formatCount, humanizeIdentifier } from './lib/format'
import { frameIndexAtTime } from './lib/timeline'
import type { RunData } from './types'

function isRunData(value: unknown): value is RunData {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RunData>
  return candidate.schemaVersion === 1 && Array.isArray(candidate.frames) && candidate.frames.length > 0
}

export default function App() {
  const [loadedRun, setLoadedRun] = useState<RunData | null>(null)
  const [source, setSource] = useState<'demo' | 'loaded'>('demo')
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const lastTick = useRef<number | null>(null)
  const run = source === 'loaded' && loadedRun ? loadedRun : demoRun
  const duration = Math.max(run.metadata.duration, run.frames.at(-1)?.time ?? 0)
  const frameIndex = useMemo(() => frameIndexAtTime(run.frames, cursor), [run.frames, cursor])
  const frame = run.frames[frameIndex]

  useEffect(() => {
    let active = true
    fetch('/data/run.json')
      .then((response) => {
        if (!response.ok) throw new Error('No ingested run')
        return response.json() as Promise<unknown>
      })
      .then((data) => {
        if (active && isRunData(data)) setLoadedRun(data)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!playing) {
      lastTick.current = null
      return undefined
    }

    let animationFrame = 0
    const tick = (timestamp: number) => {
      const previous = lastTick.current ?? timestamp
      lastTick.current = timestamp
      const elapsed = ((timestamp - previous) / 1000) * speed
      setCursor((current) => {
        const next = current + elapsed
        if (next >= duration) {
          setPlaying(false)
          return duration
        }
        return next
      })
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [duration, playing, speed])

  const chooseSource = (nextSource: 'demo' | 'loaded') => {
    setSource(nextSource)
    setCursor(0)
    setPlaying(false)
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <a className="brand" href="#main" aria-label="Flow Control Flight Recorder home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>
            <strong>Flow control</strong>
            <small>Flight recorder</small>
          </span>
        </a>
        <div className="run-context">
          <label>
            <span>Replay source</span>
            <select value={source} onChange={(event) => chooseSource(event.target.value as 'demo' | 'loaded')}>
              <option value="demo">Synthetic demo</option>
              {loadedRun ? <option value="loaded">Loaded run</option> : null}
            </select>
          </label>
          <span className="evidence-chip"><i /> Aggregate replay</span>
        </div>
      </header>

      <main id="main">
        <section className="run-hero">
          <div className="hero-copy">
            <p className="eyebrow">{humanizeIdentifier(run.metadata.runId)}</p>
            <h1>Watch pressure become policy, then work.</h1>
            <p className="hero-deck">
              One clock across the client, EPP admission queues, and the vLLM runtime. Scrub to the
              moment the pool saturates and see where requests wait.
            </p>
          </div>
          <dl className="run-summary">
            <div><dt>Requests</dt><dd>{formatCount(run.summary.requestCount)}</dd></div>
            <div><dt>Peak EPP queue</dt><dd>{formatCount(run.summary.maxEppQueue)}</dd></div>
            <div><dt>Peak vLLM wait</dt><dd>{formatCount(run.summary.maxVllmWaiting)}</dd></div>
            <div><dt>Errors</dt><dd>{formatCount(run.summary.errorCount)}</dd></div>
          </dl>
        </section>

        <TimelineControl
          frames={run.frames}
          cursor={cursor}
          duration={duration}
          playing={playing}
          speed={speed}
          onCursorChange={(time) => {
            setCursor(time)
            setPlaying(false)
          }}
          onPlayingChange={(nextPlaying) => {
            if (nextPlaying && cursor >= duration) setCursor(0)
            setPlaying(nextPlaying)
          }}
          onSpeedChange={setSpeed}
        />

        <div className="flow-stack">
          <ClientLayer run={run} frame={frame} frameIndex={frameIndex} />
          <EppLayer run={run} frame={frame} />
          <VllmLayer run={run} frame={frame} />
        </div>

        <section className="evidence-panel" aria-labelledby="evidence-title">
          <div>
            <p className="eyebrow">Evidence boundary</p>
            <h2 id="evidence-title">What this replay knows</h2>
          </div>
          <div className="evidence-state">
            <span className="resolution-label">{run.evidence.metricResolution} samples</span>
            <ul>
              {run.evidence.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
          <div className="next-telemetry">
            <span>Unlock exact request paths</span>
            <p>Capture a shared trace ID, EPP queue and dispatch events, and opt-in vLLM iteration events.</p>
          </div>
        </section>
      </main>

      <footer>
        <span>llm-d experiment observability</span>
        <span>{humanizeIdentifier(run.metadata.scenario)}</span>
      </footer>
    </div>
  )
}
