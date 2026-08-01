import { useMemo } from 'react'
import { formatTime } from '../lib/format'
import { frameIndexAtTime, pointsFor } from '../lib/timeline'
import type { TimelineFrame } from '../types'

type TimelineControlProps = {
  frames: TimelineFrame[]
  cursor: number
  duration: number
  sampleInterval: number
  playing: boolean
  speed: number
  onCursorChange: (time: number) => void
  onPlayingChange: (playing: boolean) => void
  onSpeedChange: (speed: number) => void
}

export function TimelineControl({
  frames,
  cursor,
  duration,
  sampleInterval,
  playing,
  speed,
  onCursorChange,
  onPlayingChange,
  onSpeedChange,
}: TimelineControlProps) {
  const width = 1000
  const height = 76
  const interval = Math.max(0.001, sampleInterval)
  const arrivals = useMemo(
    () => pointsFor(frames, width, height, (frame) => frame.arrivals / interval),
    [frames, interval],
  )
  const completions = useMemo(
    () => pointsFor(frames, width, height, (frame) => frame.completions / interval),
    [frames, interval],
  )
  const cursorX = duration > 0 ? (cursor / duration) * width : 0
  const currentFrame = frames[frameIndexAtTime(frames, cursor)]
  const incomingRps = (currentFrame?.arrivals ?? 0) / interval

  return (
    <section className="timeline-shell" aria-label="Run playback">
      <div className="timeline-controls">
        <span className="timeline-title">Requests/sec</span>
        <button
          className="play-button"
          type="button"
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          onClick={() => onPlayingChange(!playing)}
        >
          <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="time-readout">
          <strong>{formatTime(cursor)}</strong>
          <span>/ {formatTime(duration)}</span>
        </div>
        <label className="speed-control">
          <span>Playback</span>
          <select name="playback-speed" autoComplete="off" value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </label>
      </div>
      <div className="timeline-plot">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <polyline points={arrivals} className="timeline-arrivals" />
          <polyline points={completions} className="timeline-completions" />
          <line x1={cursorX} x2={cursorX} y1="0" y2={height} className="timeline-cursor" />
        </svg>
        <input
          className="timeline-slider"
          name="run-time"
          type="range"
          min="0"
          max={duration}
          step="0.1"
          value={Math.min(cursor, duration)}
          aria-label="Run time"
          onChange={(event) => onCursorChange(Number(event.target.value))}
        />
      </div>
      <div className="timeline-legend" aria-hidden="true">
        <span className="request-rate-now"><strong>{incomingRps.toFixed(1)}</strong> now</span>
        <span><i className="legend-line arrivals" /> Incoming</span>
        <span><i className="legend-line completions" /> Completed</span>
      </div>
    </section>
  )
}
