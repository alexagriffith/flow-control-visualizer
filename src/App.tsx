import { useEffect, useMemo, useRef, useState } from 'react'
import { ClientLayer } from './components/ClientLayer'
import { EppLayer } from './components/EppLayer'
import { TimelineControl } from './components/TimelineControl'
import { VllmLayer } from './components/VllmLayer'
import { SystemFlowDiagram } from './components/SystemFlowDiagram'
import { demoRun } from './demo-run'
import { formatCount, humanizeIdentifier } from './lib/format'
import { isRunData } from './lib/run-data'
import { frameIndexAtTime } from './lib/timeline'
import type { RunCatalogEntry, RunData } from './types'

const RUN_CACHE_SIZE = 8

function cacheRun(cache: Map<string, RunData>, id: string, run: RunData): void {
  cache.delete(id)
  cache.set(id, run)
  while (cache.size > RUN_CACHE_SIZE) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

function peakQueueTime(run: RunData): number {
  const peakFrame = run.frames.reduce((peak, candidate) => {
    const peakQueue = Math.max(0, ...peak.queues.map((queue) => queue.size))
    const candidateQueue = Math.max(0, ...candidate.queues.map((queue) => queue.size))
    return candidateQueue > peakQueue ? candidate : peak
  }, run.frames[0])
  return peakFrame.time
}

export default function App() {
  const [loadedRun, setLoadedRun] = useState<RunData | null>(null)
  const [run, setRun] = useState<RunData>(demoRun)
  const [catalog, setCatalog] = useState<RunCatalogEntry[]>([])
  const [source, setSource] = useState('demo')
  const [loadingRun, setLoadingRun] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [viewMode, setViewMode] = useState<'diagram' | 'telemetry'>('diagram')
  const [showHelp, setShowHelp] = useState(false)
  const lastTick = useRef<number | null>(null)
  const runCache = useRef(new Map<string, RunData>())
  const runRequest = useRef<AbortController | null>(null)
  const urlPlaybackApplied = useRef(false)
  const helpPanel = useRef<HTMLElement | null>(null)
  const duration = Math.max(run.metadata.duration, run.frames.at(-1)?.time ?? 0)
  const frameIndex = useMemo(() => frameIndexAtTime(run.frames, cursor), [run.frames, cursor])
  const frame = run.frames[frameIndex]

  useEffect(() => {
    let active = true
    const staticRun = fetch('/data/run.json').then(async (response) =>
      response.ok ? response.json() as Promise<unknown> : null,
    )
    const runCatalog = fetch('/api/runs').then(async (response) =>
      response.ok ? response.json() as Promise<unknown> : [],
    )

    Promise.allSettled([staticRun, runCatalog]).then(([staticResult, catalogResult]) => {
      if (!active) return
      if (staticResult.status === 'fulfilled' && isRunData(staticResult.value)) {
        const normalized = {
          ...staticResult.value,
          runtime: staticResult.value.runtime ?? { schedulerPolicy: null, chunkedPrefill: null },
        }
        setLoadedRun(normalized)
        setRun(normalized)
        setSource('loaded')
        setCursor(peakQueueTime(normalized))
      }
      if (catalogResult.status === 'fulfilled' && Array.isArray(catalogResult.value)) {
        setCatalog(catalogResult.value as RunCatalogEntry[])
      }
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const recordingMode = new URLSearchParams(window.location.search).get('record') === '1'
    document.body.classList.toggle('recording-mode', recordingMode)
    return () => document.body.classList.remove('recording-mode')
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

  useEffect(() => {
    if (!showHelp) return undefined
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const background = [...document.querySelectorAll<HTMLElement>('.app-shell > :not(.how-to-scrim)')]
    background.forEach((element) => { element.inert = true })
    const focusable = () => [...(helpPanel.current?.querySelectorAll<HTMLElement>('button, [href], select, input, [tabindex]:not([tabindex="-1"])') ?? [])]
    focusable()[0]?.focus()

    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowHelp(false)
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items.at(-1) ?? first
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleDialogKeys)
    return () => {
      window.removeEventListener('keydown', handleDialogKeys)
      background.forEach((element) => { element.inert = false })
      previousFocus?.focus()
    }
  }, [showHelp])

  const chooseSource = async (nextSource: string): Promise<RunData | null> => {
    const previousSource = source
    runRequest.current?.abort()
    runRequest.current = null
    setSource(nextSource)
    setPlaying(false)
    setRunError(null)
    setLoadingRun(false)

    if (nextSource === 'demo') {
      setRun(demoRun)
      setCursor(peakQueueTime(demoRun))
      return demoRun
    }

    if (nextSource === 'loaded' && loadedRun) {
      setRun(loadedRun)
      setCursor(peakQueueTime(loadedRun))
      return loadedRun
    }

    const cached = runCache.current.get(nextSource)
    if (cached) {
      setRun(cached)
      setCursor(peakQueueTime(cached))
      return cached
    }

    const controller = new AbortController()
    runRequest.current = controller
    setLoadingRun(true)
    try {
      const response = await fetch(`/api/run?id=${encodeURIComponent(nextSource)}`, { signal: controller.signal })
      if (!response.ok) throw new Error('This run could not be loaded')
      const data = await response.json() as unknown
      if (!isRunData(data)) throw new Error('This run uses an unsupported artifact format')
      const normalized = {
        ...data,
        runtime: data.runtime ?? { schedulerPolicy: null, chunkedPrefill: null },
      }
      cacheRun(runCache.current, nextSource, normalized)
      setRun(normalized)
      setCursor(peakQueueTime(normalized))
      return normalized
    } catch (error) {
      if (controller.signal.aborted) return null
      setSource(previousSource)
      setRunError(error instanceof Error ? error.message : 'This run could not be loaded')
      return null
    } finally {
      if (runRequest.current === controller) {
        runRequest.current = null
        setLoadingRun(false)
      }
    }
  }

  useEffect(() => {
    if (urlPlaybackApplied.current || catalog.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const requestedRun = params.get('run')
    if (!requestedRun) return

    urlPlaybackApplied.current = true
    const requestedTime = Number(params.get('time'))
    const requestedSpeed = Number(params.get('speed'))
    if ([0.5, 1, 2, 4].includes(requestedSpeed)) setSpeed(requestedSpeed)

    void chooseSource(requestedRun).then((selectedRun) => {
      if (!selectedRun) return
      const selectedDuration = Math.max(selectedRun.metadata.duration, selectedRun.frames.at(-1)?.time ?? 0)
      if (Number.isFinite(requestedTime) && requestedTime >= 0) setCursor(Math.min(requestedTime, selectedDuration))
      if (params.get('autoplay') === '1') setPlaying(true)
    })
  }, [catalog.length])

  const catalogGroups = useMemo(() => {
    const groups = new Map<string, RunCatalogEntry[]>()
    for (const entry of catalog) {
      const entries = groups.get(entry.group) ?? []
      entries.push(entry)
      groups.set(entry.group, entries)
    }
    return [...groups.entries()]
  }, [catalog])
  const runName = humanizeIdentifier(run.metadata.runId)
  const scenarioName = humanizeIdentifier(run.metadata.scenario)
  const showScenario = !runName.toLocaleLowerCase().includes(scenarioName.toLocaleLowerCase())

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to replay</a>
      <header className="masthead">
        <div className="brand" aria-label="Flow Control Flight Recorder">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>
            <strong>Flow control</strong>
            <small>Flight recorder</small>
          </span>
        </div>
        <div className="run-context">
          <select
            name="run"
            autoComplete="off"
            value={source}
            disabled={loadingRun}
            aria-label="Run"
            aria-busy={loadingRun}
            onChange={(event) => void chooseSource(event.target.value)}
          >
            <option value="demo">Synthetic demo</option>
            {loadedRun ? <option value="loaded">Current loaded run</option> : null}
            {catalogGroups.map(([group, entries]) => (
              <optgroup label={group} key={group}>
                {entries.map((entry) => (
                  <option value={entry.id} key={entry.id}>
                    {entry.replayLevel === 'full' ? 'Full replay' : entry.replayLevel === 'queues-and-runtime' ? 'Queues + runtime' : 'Client/partial'} · {entry.runId}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="sr-only" role="status" aria-live="polite">{loadingRun ? 'Loading run…' : ''}</span>
          <button className="how-to-button" type="button" onClick={() => setShowHelp(true)}>How to use</button>
        </div>
      </header>

      {showHelp ? (
        <div className="how-to-scrim" role="presentation" onMouseDown={() => setShowHelp(false)}>
          <section
            ref={helpPanel}
            className="how-to-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="how-to-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <h2 id="how-to-title">How to use</h2>
              <button type="button" aria-label="Close how to use" onClick={() => setShowHelp(false)}>×</button>
            </header>
            <ol>
              <li><strong>Choose a run.</strong></li>
              <li><strong>Play or scrub.</strong></li>
              <li><strong>Follow the path.</strong><span>Traffic → Endpoint Picker → vLLM.</span></li>
            </ol>
            <p>Solid = recorded. Dashed = mechanism.</p>
          </section>
        </div>
      ) : null}

      {runError ? <div className="run-error" role="alert">{runError}</div> : null}

      <main id="main">
        <section className="run-hero">
          <div className="hero-copy">
            <h1>{runName}</h1>
            {showScenario ? <p className="hero-deck">{scenarioName}</p> : null}
          </div>
          <dl className="run-summary">
            <div><dt>Requests</dt><dd>{formatCount(run.summary.requestCount)}</dd></div>
            <div><dt>EPP peak</dt><dd>{formatCount(run.summary.maxEppQueue)}</dd></div>
            <div><dt>vLLM peak wait</dt><dd>{formatCount(run.summary.maxVllmWaiting)}</dd></div>
          </dl>
        </section>

        <TimelineControl
          frames={run.frames}
          cursor={cursor}
          duration={duration}
          sampleInterval={run.metadata.sampleInterval}
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

        <div className="view-switcher" role="group" aria-label="Visualization mode">
          <button type="button" aria-pressed={viewMode === 'diagram'} onClick={() => setViewMode('diagram')}>
            Flow
          </button>
          <button type="button" aria-pressed={viewMode === 'telemetry'} onClick={() => setViewMode('telemetry')}>
            Metrics
          </button>
        </div>

        {viewMode === 'diagram' ? (
          <SystemFlowDiagram run={run} frame={frame} playing={playing} />
        ) : (
          <div className="flow-stack">
            <ClientLayer run={run} frame={frame} frameIndex={frameIndex} />
            <EppLayer run={run} frame={frame} />
            <VllmLayer run={run} frame={frame} />
          </div>
        )}

      </main>
    </div>
  )
}
