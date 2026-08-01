import { memo, type CSSProperties } from 'react'
import { formatCount, formatPercent, formatTime, humanizeIdentifier } from '../lib/format'
import { balancedGridColumns } from '../lib/grid'
import { MAX_RENDERED_SLOTS, renderableSlotCount } from '../lib/visual-limits'
import { aggregateVllm } from '../lib/vllm'
import type { QueueFrame, RunData, TimelineFrame } from '../types'

type SystemFlowDiagramProps = {
  run: RunData
  frame: TimelineFrame
  playing: boolean
}

function QueueDots({ queue }: { queue: QueueFrame }) {
  const visibleDots = Math.min(12, queue.size)
  return (
    <div className="diagram-queue-dots" aria-hidden="true">
      {Array.from({ length: visibleDots }, (_, index) => (
        <i key={index} style={{ '--dot-index': index } as CSSProperties} />
      ))}
      {queue.size > visibleDots ? <span>+{formatCount(queue.size - visibleDots)}</span> : null}
      {queue.size === 0 ? <em>empty</em> : null}
    </div>
  )
}

function PriorityBand({
  priority,
  label,
  color,
  queues,
  run,
}: {
  priority: number
  label: string | null
  color: string
  queues: QueueFrame[]
  run: RunData
}) {
  const queued = queues.reduce((total, queue) => total + queue.size, 0)
  const activeQueues = queues.filter((queue) => queue.size > 0)
  const emptyQueueCount = queues.length - activeQueues.length
  return (
    <section
      className="priority-band"
      style={{ '--band-color': color, '--band-bg': `color-mix(in srgb, ${color} 8%, #fff)` } as CSSProperties}
      aria-label={`${label ?? 'Priority'} ${priority}`}
    >
      <header>
        <div>
          <strong>P{priority}</strong>
          <span>{label ?? 'Priority'}</span>
        </div>
        <b>{formatCount(queued)} queued</b>
      </header>
      <div className="fairness-queues">
        {activeQueues.map((queue) => {
          const tenant = run.tenants.find((candidate) => candidate.id === queue.id)
          return (
            <div
              className="fairness-queue"
              key={queue.id}
              style={{ '--flow-color': tenant?.color ?? '#71808b' } as CSSProperties}
              aria-label={`${humanizeIdentifier(queue.id)}, ${queue.size} requests waiting`}
            >
              <span>{humanizeIdentifier(queue.id)}</span>
              <QueueDots queue={queue} />
              <small>{formatCount(queue.size)} queued</small>
            </div>
          )
        })}
        {activeQueues.length === 0 ? (
          <div className="queue-empty-summary">
            <strong>{queues.length > 0 ? 'No queued requests' : 'No flows recorded'}</strong>
            {queues.length > 0 ? <span>{formatCount(queues.length)} empty {queues.length === 1 ? 'queue' : 'queues'}</span> : null}
          </div>
        ) : emptyQueueCount > 0 ? (
          <span className="empty-queue-count">+{formatCount(emptyQueueCount)} empty</span>
        ) : null}
      </div>
      <div className="band-dispatch" aria-hidden="true"><i /><span>eligible</span></div>
    </section>
  )
}

function Connector({ label, holding }: { label: string; holding?: boolean }) {
  return (
    <div className={`component-connector ${holding ? 'connector-holding' : ''}`} aria-label={label}>
      <span>{label}</span>
      <div className="connector-track" aria-hidden="true">
        <b>→</b>
      </div>
    </div>
  )
}

export const SystemFlowDiagram = memo(function SystemFlowDiagram({ run, frame, playing }: SystemFlowDiagramProps) {
  const priorities = [...new Set([
    ...(run.routing?.priorityBands.map((band) => band.priority) ?? []),
    ...run.tenants.map((tenant) => tenant.priority),
    ...frame.queues.map((queue) => queue.priority),
  ])]
    .sort((left, right) => right - left)
  const totalQueued = frame.queues.reduce((total, queue) => total + queue.size, 0)
  const pods = frame.vllm
  const sampleInterval = Math.max(0.001, run.metadata.sampleInterval)
  const incomingRps = frame.arrivals / sampleInterval
  const gateHolding = frame.saturation >= 1
  const { running, waiting, preemptions, peakKvCacheUsage } = aggregateVllm(pods)
  const maxSequences = run.limits.maxSequences
  const configuredSlots = maxSequences ? maxSequences * Math.max(1, pods.length) : null
  const batchSlots = renderableSlotCount(configuredSlots)
  const visibleRunning = Math.min(running, batchSlots ?? 0)
  const batchColumns = batchSlots ? balancedGridColumns(batchSlots) : 1

  return (
    <section className={`system-diagram ${playing ? 'is-playing' : ''}`} aria-labelledby="system-diagram-title">
      <header className="system-diagram-header">
        <div>
          <h2 id="system-diagram-title">Request path</h2>
        </div>
        <div className="diagram-live-readout">
          <span><strong>{incomingRps.toFixed(1)}</strong> req/s</span>
          <span><strong>{formatCount(totalQueued)}</strong> EPP queued</span>
          <span><strong>{formatCount(waiting)}</strong> vLLM waiting</span>
        </div>
      </header>
      <div className="diagram-provenance">
        <span><i className="recorded-mark" /> Run data</span>
        <span><i className="concept-mark" /> Mechanics only</span>
      </div>

      <div className="component-flow-canvas">
        <section className="ingress-component" aria-label="Client request ingress">
          <header>
            <span className="component-kicker">01</span>
            <h3>Traffic</h3>
          </header>
          <div className="request-streams">
            {run.tenants.map((tenant) => {
              const current = frame.tenants.find((candidate) => candidate.id === tenant.id)
              return (
                <div className="request-stream" key={tenant.id} style={{ '--flow-color': tenant.color } as CSSProperties}>
                  <span>{humanizeIdentifier(tenant.id)}</span>
                  <small>{formatCount(current?.actualInflight ?? 0)} in flight</small>
                </div>
              )
            })}
          </div>
        </section>

        <Connector label="priority + fairness" />

        <section className="endpoint-picker-component" aria-labelledby="endpoint-picker-title">
          <header className="component-titlebar">
            <div>
              <span className="component-kicker">02 · llm-d router</span>
              <h3 id="endpoint-picker-title">Endpoint Picker</h3>
            </div>
            <div className="component-state">
              <i className={gateHolding ? 'state-holding' : 'state-open'} />
              {gateHolding ? 'Admission holding' : 'Dispatching'}
            </div>
          </header>

          <div className="priority-stack">
            {priorities.map((priority) => (
              <PriorityBand
                key={priority}
                priority={priority}
                label={run.routing?.priorityBands.find((band) => band.priority === priority)?.label ?? null}
                color={run.routing?.priorityBands.find((band) => band.priority === priority)?.color
                  ?? run.tenants.find((tenant) => tenant.priority === priority)?.color
                  ?? '#71808b'}
                queues={frame.queues.filter((queue) => queue.priority === priority)}
                run={run}
              />
            ))}
          </div>

          <div className="epp-decision-stage">
            <div>
              <span>Arbitration</span>
              <strong>Next eligible flow</strong>
            </div>
            <div className={`saturation-gate ${gateHolding ? 'gate-is-holding' : ''}`}>
              <span>Pool saturation</span>
              <strong>{frame.saturation.toFixed(2)}×</strong>
              <div aria-hidden="true"><i /><i /><i /></div>
            </div>
          </div>
        </section>

        <Connector label={gateHolding ? 'held' : 'dispatch'} holding={gateHolding} />

        <section className="vllm-component" aria-labelledby="runtime-title">
          <header className="component-titlebar">
            <div>
              <span className="component-kicker">03 · model server</span>
              <h3 id="runtime-title">vLLM{pods.length > 1 ? ` · ${formatCount(pods.length)} pods` : ''}</h3>
            </div>
            <div className="component-state runtime-state"><i /> Sample {formatTime(frame.time)}</div>
          </header>

          <div className="policy-boundary"><span>llm-d priority ends here</span></div>

          <div className="runtime-pipeline">
            <div className="scheduler-step">
              <div className="scheduler-rotor" aria-hidden="true"><i /></div>
              <span>Scheduler</span>
              {run.runtime.schedulerPolicy ? (
                <strong>{run.runtime.schedulerPolicy.toUpperCase()}</strong>
              ) : (
                <strong className="metric-needed"><i aria-hidden="true">!</i> Need metrics</strong>
              )}
            </div>

            <section className="continuous-batch" aria-labelledby="batch-title">
              <header>
                <div>
                  <span title="vllm:num_requests_running">Continuous scheduler</span>
                  <h4 id="batch-title">Continuous batch</h4>
                </div>
                <strong>{formatCount(running)}{maxSequences ? ` / ${formatCount(maxSequences)}` : ''} running</strong>
              </header>

              {pods.length > 0 && batchSlots && configuredSlots ? (
                <>
                  <div
                    className="batch-capacity-grid"
                    style={{ '--batch-grid-columns': batchColumns } as CSSProperties}
                    aria-label={`${running} of ${configuredSlots} configured sequence slots running across ${pods.length} vLLM source${pods.length === 1 ? '' : 's'}; ${waiting} requests waiting`}
                  >
                    {Array.from({ length: batchSlots }, (_, index) => (
                      <i key={index} className={index < visibleRunning ? 'active' : ''} />
                    ))}
                  </div>
                  <div className="batch-capacity-key">
                    <span><i /> Running <strong>{formatCount(running)}</strong></span>
                    <span>Waiting <strong>{formatCount(waiting)}</strong></span>
                    <small>{formatCount(configuredSlots)} configured slots</small>
                  </div>
                  <div className="batch-facts">
                    <span>{pods.length > 1 ? 'Peak KV' : 'KV'} <strong>{formatPercent(peakKvCacheUsage)}</strong></span>
                    <span>Preemptions <strong>{formatCount(preemptions)}</strong></span>
                    {run.limits.maxBatchedTokens ? <span>Token cap <strong>{formatCount(run.limits.maxBatchedTokens)}</strong></span> : null}
                  </div>
                </>
              ) : pods.length === 0 ? (
                <div className="batch-metrics-needed" role="status">
                  <i aria-hidden="true">!</i>
                  <span><strong>Need metrics</strong><small>Running · waiting · KV · preemptions</small></span>
                </div>
              ) : configuredSlots && configuredSlots > MAX_RENDERED_SLOTS ? (
                <div className="batch-metrics-needed" role="status">
                  <i aria-hidden="true">!</i>
                  <span><strong>{formatCount(configuredSlots)} configured slots</strong><small>Grid hidden above {formatCount(MAX_RENDERED_SLOTS)}</small></span>
                </div>
              ) : (
                <div className="batch-metrics-needed" role="status">
                  <i aria-hidden="true">!</i>
                  <span><strong>Need config</strong><small>max_num_seqs</small></span>
                </div>
              )}

              <div className="batch-rebuild-loop">
                <small>Mechanics, not measured membership</small>
                <span>decode</span><b>→</b>
                <span>prefill</span><b>→</b>
                <span>rebuild</span>
              </div>
            </section>
          </div>

          <footer className="runtime-footer">
            <span className="mechanics-warning">Older runs do not contain request IDs per engine step.</span>
          </footer>
        </section>
      </div>
    </section>
  )
})
