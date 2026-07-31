import { formatCount, formatPercent, humanizeIdentifier } from '../lib/format'
import type { RunData, TimelineFrame, VllmFrame } from '../types'

type VllmLayerProps = {
  run: RunData
  frame: TimelineFrame
}

function PodCard({ pod, run }: { pod: VllmFrame; run: RunData }) {
  const cells = 64
  const representedPerCell = run.limits.maxSequences / cells
  const occupiedCells = Math.min(cells, Math.ceil(pod.running / representedPerCell))
  const sequencePercent = Math.min(100, (pod.running / run.limits.maxSequences) * 100)

  return (
    <article className="pod-card">
      <header className="pod-card-header">
        <div>
          <span className="pod-status"><i /> {pod.aggregated ? 'Aggregate source' : 'Pod ready'}</span>
          <h3>{humanizeIdentifier(pod.pod)}</h3>
        </div>
        <div className="pod-pressure">
          <strong>{formatCount(pod.waiting)}</strong>
          <span>waiting</span>
        </div>
      </header>

      <div className="batch-title-row">
        <div>
          <p className="eyebrow">Current iteration pressure</p>
          <h4>Continuous batch</h4>
        </div>
        <span>{formatCount(pod.running)} / {formatCount(run.limits.maxSequences)} sequences</span>
      </div>

      <div className="sequence-grid" aria-label={`${pod.running} of ${run.limits.maxSequences} sequence slots occupied`}>
        {Array.from({ length: cells }, (_, index) => (
          <i key={index} className={index < occupiedCells ? 'sequence-cell occupied' : 'sequence-cell'} />
        ))}
      </div>
      <div className="sequence-caption">
        <span>{sequencePercent.toFixed(0)}% sequence occupancy</span>
        <span>Each cell ≈ {representedPerCell.toFixed(representedPerCell < 10 ? 1 : 0)} slots</span>
      </div>

      <div className="pod-metric-grid">
        <div>
          <span>KV cache</span>
          <strong>{formatPercent(pod.kvCacheUsage)}</strong>
          <div className="micro-bar"><i style={{ width: `${Math.min(100, pod.kvCacheUsage * 100)}%` }} /></div>
        </div>
        <div>
          <span>Iteration token ceiling</span>
          <strong>{formatCount(run.limits.maxBatchedTokens)}</strong>
          <small>configured limit</small>
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
        <div>
          <p className="eyebrow">Runtime continuously rebuilds the batch</p>
          <h2 id="vllm-layer-title">vLLM pod pressure</h2>
        </div>
        <div className="layer-live-stats">
          <span><strong>{formatCount(frame.vllm.reduce((total, pod) => total + pod.running, 0))}</strong> running</span>
          <span><strong>{formatCount(frame.vllm.reduce((total, pod) => total + pod.waiting, 0))}</strong> waiting</span>
        </div>
      </header>
      <div className="pod-grid">
        {frame.vllm.map((pod) => <PodCard key={pod.pod} pod={pod} run={run} />)}
      </div>
    </section>
  )
}
