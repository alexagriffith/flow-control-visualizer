import type { CSSProperties } from 'react'
import { formatCount, formatPercent, humanizeIdentifier } from '../lib/format'
import { balancedGridColumns } from '../lib/grid'
import type { RunData, TimelineFrame, VllmFrame } from '../types'

type VllmLayerProps = {
  run: RunData
  frame: TimelineFrame
}

function PodCard({ pod, run, waitingPeak }: { pod: VllmFrame; run: RunData; waitingPeak: number }) {
  const maximum = run.limits.maxSequences
  const runningColumns = maximum ? balancedGridColumns(maximum) : 1
  const waitingColumns = waitingPeak > 0 ? balancedGridColumns(waitingPeak) : 1

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
        <span>{formatCount(pod.running)}{maximum ? ` / ${formatCount(maximum)}` : ''} running</span>
      </div>

      {maximum ? (
        <div
          className="sequence-grid"
          style={{ '--telemetry-grid-columns': runningColumns } as CSSProperties}
          aria-label={`${pod.running} of ${maximum} configured requests active`}
        >
          {Array.from({ length: maximum }, (_, index) => (
            <i key={index} className={index < pod.running ? 'sequence-cell occupied' : 'sequence-cell'} />
          ))}
        </div>
      ) : <div className="telemetry-config-needed">Need config · max_num_seqs</div>}
      <div className="sequence-caption">
        <span>{maximum ? `${formatCount(maximum)} configured slots` : 'Configured limit not captured'}</span>
      </div>

      <div className="batch-title-row waiting-title-row">
        <h4>Waiting</h4>
        <span>{formatCount(pod.waiting)}</span>
      </div>
      {waitingPeak > 0 ? (
        <div
          className="sequence-grid waiting-grid"
          style={{ '--telemetry-grid-columns': waitingColumns } as CSSProperties}
          aria-label={`${pod.waiting} requests waiting; ${waitingPeak} was the observed run peak and is not a configured limit`}
        >
          {Array.from({ length: waitingPeak }, (_, index) => (
            <i key={index} className={index < pod.waiting ? 'sequence-cell occupied' : 'sequence-cell'} />
          ))}
        </div>
      ) : <div className="waiting-empty">No waiting recorded</div>}
      {waitingPeak > 0 && (
        <div className="sequence-caption"><span>Run peak {formatCount(waitingPeak)} · observed, not a limit</span></div>
      )}

      <div className="pod-metric-grid">
        <div>
          <span>KV cache</span>
          <strong>{formatPercent(pod.kvCacheUsage)}</strong>
          <div className="micro-bar"><i style={{ width: `${Math.min(100, pod.kvCacheUsage * 100)}%` }} /></div>
        </div>
        <div>
          <span>Iteration token ceiling</span>
          <strong>{run.limits.maxBatchedTokens ? formatCount(run.limits.maxBatchedTokens) : 'Not captured'}</strong>
          <small>{run.limits.maxBatchedTokens ? 'configured limit' : 'older run'}</small>
        </div>
        <div>
          <span>Preemptions</span>
          <strong>{formatCount(pod.preemptions)}</strong>
          <small>cumulative</small>
        </div>
      </div>
      <div className="batch-boundary-note">
        <span aria-hidden="true">◎</span>
        <p><strong>Exact members unavailable.</strong> This run recorded aggregate scheduler pressure, not per-iteration request events.</p>
      </div>
    </article>
  )
}

export function VllmLayer({ run, frame }: VllmLayerProps) {
  return (
    <section className="layer vllm-layer" aria-labelledby="vllm-layer-title">
      <div className="signal-bridge" aria-hidden="true"><span /></div>
      <div className="layer-index" aria-hidden="true">03</div>
      <header className="layer-header">
        <h2 id="vllm-layer-title">vLLM pod pressure</h2>
        <div className="layer-live-stats">
          <span><strong>{formatCount(frame.vllm.reduce((total, pod) => total + pod.running, 0))}</strong> running</span>
          <span><strong>{formatCount(frame.vllm.reduce((total, pod) => total + pod.waiting, 0))}</strong> waiting</span>
        </div>
      </header>
      <div className="pod-grid">
        {frame.vllm.map((pod) => {
          const waitingPeak = Math.max(0, ...run.frames.flatMap((candidate) =>
            candidate.vllm.filter((item) => item.pod === pod.pod).map((item) => item.waiting)))
          return <PodCard key={pod.pod} pod={pod} run={run} waitingPeak={waitingPeak} />
        })}
      </div>
    </section>
  )
}
