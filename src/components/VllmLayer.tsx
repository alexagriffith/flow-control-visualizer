import { memo, useMemo, type CSSProperties } from 'react'
import { formatCount, formatPercent, humanizeIdentifier } from '../lib/format'
import { balancedGridColumns } from '../lib/grid'
import { MAX_RENDERED_SLOTS, renderableSlotCount } from '../lib/visual-limits'
import type { RunData, TimelineFrame, VllmFrame } from '../types'

type VllmLayerProps = {
  run: RunData
  frame: TimelineFrame
}

function PodCard({ pod, run, waitingPeak }: { pod: VllmFrame; run: RunData; waitingPeak: number }) {
  const maximum = run.limits.maxSequences
  const renderedMaximum = renderableSlotCount(maximum)
  const renderedWaitingPeak = renderableSlotCount(waitingPeak)
  const runningColumns = renderedMaximum ? balancedGridColumns(renderedMaximum) : 1
  const waitingColumns = renderedWaitingPeak ? balancedGridColumns(renderedWaitingPeak) : 1

  return (
    <article className="pod-card">
      <header className="pod-card-header">
        <div>
          <span className="pod-status"><i /> {pod.aggregated ? 'Aggregate source' : 'Pod ready'}</span>
          <h3>{humanizeIdentifier(pod.pod)}</h3>
        </div>
      </header>

      <div className="batch-title-row">
        <h4>Continuous batch</h4>
        <span>{formatCount(pod.running)}{maximum ? ` / ${formatCount(maximum)}` : ''}</span>
      </div>

      {renderedMaximum ? (
        <div
          className="sequence-grid"
          style={{ '--telemetry-grid-columns': runningColumns } as CSSProperties}
          aria-label={`${pod.running} of ${maximum} configured requests active`}
        >
          {Array.from({ length: renderedMaximum }, (_, index) => (
            <i key={index} className={index < pod.running ? 'sequence-cell occupied' : 'sequence-cell'} />
          ))}
        </div>
      ) : maximum ? (
        <div className="telemetry-config-needed">{formatCount(maximum)} slots · grid hidden above {formatCount(MAX_RENDERED_SLOTS)}</div>
      ) : <div className="telemetry-config-needed">Need config · max_num_seqs</div>}
      <div className="batch-title-row waiting-title-row">
        <h4>Waiting</h4>
        <span>{formatCount(pod.waiting)}{waitingPeak > 0 ? ` / ${formatCount(waitingPeak)} peak` : ''}</span>
      </div>
      {renderedWaitingPeak ? (
        <div
          className="sequence-grid waiting-grid"
          style={{ '--telemetry-grid-columns': waitingColumns } as CSSProperties}
          aria-label={`${pod.waiting} requests waiting; ${waitingPeak} was the observed run peak and is not a configured limit`}
        >
          {Array.from({ length: renderedWaitingPeak }, (_, index) => (
            <i key={index} className={index < pod.waiting ? 'sequence-cell occupied' : 'sequence-cell'} />
          ))}
        </div>
      ) : waitingPeak > 0 ? (
        <div className="telemetry-config-needed">{formatCount(waitingPeak)} peak · grid hidden above {formatCount(MAX_RENDERED_SLOTS)}</div>
      ) : <div className="waiting-empty">No waiting recorded</div>}
      <div className="pod-metric-grid">
        <div>
          <span>KV cache</span>
          <strong>{formatPercent(pod.kvCacheUsage)}</strong>
          <div className="micro-bar"><i style={{ width: `${Math.min(100, pod.kvCacheUsage * 100)}%` }} /></div>
        </div>
        <div>
          <span>Token cap</span>
          <strong>{run.limits.maxBatchedTokens ? formatCount(run.limits.maxBatchedTokens) : '—'}</strong>
        </div>
        <div>
          <span>Preemptions</span>
          <strong>{formatCount(pod.preemptions)}</strong>
          <small>cumulative</small>
        </div>
      </div>
      <div className="batch-boundary-note">
        <span aria-hidden="true">◎</span>
        <p>Request-level batch membership not captured.</p>
      </div>
    </article>
  )
}

export const VllmLayer = memo(function VllmLayer({ run, frame }: VllmLayerProps) {
  const waitingPeaks = useMemo(() => {
    const peaks = new Map<string, number>()
    for (const candidate of run.frames) {
      for (const pod of candidate.vllm) {
        peaks.set(pod.pod, Math.max(peaks.get(pod.pod) ?? 0, pod.waiting))
      }
    }
    return peaks
  }, [run.frames])

  return (
    <section className="layer vllm-layer" aria-labelledby="vllm-layer-title">
      <div className="signal-bridge" aria-hidden="true"><span /></div>
      <div className="layer-index" aria-hidden="true">03</div>
      <header className="layer-header">
        <h2 id="vllm-layer-title">vLLM</h2>
      </header>
      <div className="pod-grid">
        {frame.vllm.map((pod) => {
          return <PodCard key={pod.pod} pod={pod} run={run} waitingPeak={waitingPeaks.get(pod.pod) ?? 0} />
        })}
      </div>
    </section>
  )
})
