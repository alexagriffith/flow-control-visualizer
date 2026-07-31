import { formatTime } from '../lib/format'
import { pointsFor } from '../lib/timeline'
import type { TimelineFrame } from '../types'

type TimelineControlProps = {
  frames: TimelineFrame[]
  cursor: number
  duration: number
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
  playing,
  speed,
  onCursorChange,
  onPlayingChange,
  onSpeedChange,
}: TimelineControlProps) {
  const width = 1000
  const height = 76
  const arrivals = pointsFor(frames, width, height, (frame) => frame.arrivals)
  const completions = pointsFor(frames, width, height, (frame) => frame.completions)
  const cursorX = duration > 0 ? (cursor / duration) * width : 0

  return (
    <section className="timeline-shell" aria-label="Run playback">
      <div className="timeline-controls">
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
          <select value={speed} onChange={(event) => onSpeedChange(Number(event.target.value))}>
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
        <span><i className="legend-line arrivals" /> Arrivals</span>
        <span><i className="legend-line completions" /> Completions</span>
        <span className="scrub-hint">Drag anywhere on the trace</span>
      </div>
    </section>
  )
}
