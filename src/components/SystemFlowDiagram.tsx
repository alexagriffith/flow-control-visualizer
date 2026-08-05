import { memo, type CSSProperties } from 'react'
import { formatCount, formatPercent, humanizeIdentifier } from '../lib/format'
import { balancedGridColumns } from '../lib/grid'
import { MAX_RENDERED_SLOTS, renderableSlotCount } from '../lib/visual-limits'
import { aggregateVllm } from '../lib/vllm'
import type { QueueFrame, RunData, TimelineFrame } from '../types'

type SystemFlowDiagramProps = {
  run: RunData
  frame: TimelineFrame
  playing: boolean
}

function compactFlowName(id: string): string {
  return humanizeIdentifier(id).replace(/\btenant\b/gi, '').replace(/\s+/g, ' ').trim()
}

function QueueDots({ queue }: { queue: QueueFrame }) {
  const visibleDots = Math.min(12, queue.size)
  return (
    <div className="diagram-queue-dots" aria-label={`${queue.size} waiting`}>
      {Array.from({ length: 12 }, (_, index) => (
        <i key={index} className={index < visibleDots ? 'active' : ''} aria-hidden="true" />
      ))}
      {queue.size > visibleDots ? <span>+{formatCount(queue.size - visibleDots)}</span> : null}
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
  return (
    <section
      className="priority-band"
      style={{ '--band-color': color, '--band-bg': `color-mix(in srgb, ${color} 8%, #fff)` } as CSSProperties}
      aria-label={`${label ?? 'Priority'} ${priority}`}
    >
      <header>
        <div>
          <strong>P{priority}</strong>
          {label ? <span>{label}</span> : null}
        </div>
        <b aria-label={`${queued} queued`}>{formatCount(queued)}</b>
      </header>
      <div
        className="fairness-queues"
        style={{ '--flow-count': Math.max(1, queues.length) } as CSSProperties}
      >
        {queues.map((queue) => {
          const tenant = run.tenants.find((candidate) => candidate.id === queue.id)
          return (
            <div
              className="fairness-queue"
              key={queue.id}
              style={{ '--flow-color': tenant?.color ?? '#71808b' } as CSSProperties}
              aria-label={`${humanizeIdentifier(queue.id)}, ${queue.size} requests waiting`}
            >
              <div className="queue-card-label">
                <span>{humanizeIdentifier(queue.id)}</span>
                <strong>{formatCount(queue.size)}</strong>
              </div>
              <QueueDots queue={queue} />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Connector({ label, holding, visibleLabel = true }: { label: string; holding?: boolean; visibleLabel?: boolean }) {
  return (
    <div className={`component-connector ${holding ? 'connector-holding' : ''}`} aria-label={label}>
      {visibleLabel ? <span>{label}</span> : null}
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
  const pods = frame.vllm
  const gateHolding = frame.saturation >= 1
  const { running, waiting, preemptions, peakKvCacheUsage } = aggregateVllm(pods)
  const maxSequences = run.limits.maxSequences
  const configuredSlots = maxSequences ? maxSequences * Math.max(1, pods.length) : null
  const batchSlots = renderableSlotCount(configuredSlots)
  const visibleRunning = Math.min(running, batchSlots ?? 0)
  const batchColumns = batchSlots ? balancedGridColumns(batchSlots) : 1
  const waitingPeak = Math.max(run.summary.maxVllmWaiting, waiting)
  const waitingSlots = renderableSlotCount(waitingPeak)
  const visibleWaiting = Math.min(waiting, waitingSlots ?? 0)
  const waitingColumns = waitingSlots ? balancedGridColumns(waitingSlots) : 1
  const queuesByTenant = new Map(frame.queues.map((queue) => [`${queue.priority}:${queue.id}`, queue]))
  const queuesForPriority = (priority: number): QueueFrame[] => run.tenants
    .filter((tenant) => tenant.priority === priority)
    .map((tenant) => queuesByTenant.get(`${priority}:${tenant.id}`) ?? {
      id: tenant.id,
      priority,
      size: 0,
      bytes: 0,
    })

  return (
    <section className={`system-diagram ${playing ? 'is-playing' : ''}`} aria-labelledby="system-diagram-title">
      <header className="system-diagram-header">
        <h2 id="system-diagram-title">Request path</h2>
      </header>

      <div className="component-flow-canvas">
        <section className="ingress-component" aria-label="Client request ingress">
          <header>
            <h3>Traffic</h3>
          </header>
          <div
            className="request-streams"
            style={{ '--tenant-count': Math.max(1, run.tenants.length) } as CSSProperties}
          >
            {run.tenants.map((tenant) => {
              const current = frame.tenants.find((candidate) => candidate.id === tenant.id)
              const name = humanizeIdentifier(tenant.id)
              const inFlight = current?.actualInflight ?? 0
              return (
                <div className="request-stream" key={tenant.id} style={{ '--flow-color': tenant.color } as CSSProperties}>
                  <span title={name}>{compactFlowName(tenant.id)}</span>
                  <strong aria-label={`${formatCount(inFlight)} in flight`}>{formatCount(inFlight)}</strong>
                </div>
              )
            })}
          </div>
        </section>

        <Connector label="priority + fairness" />

        <section className="endpoint-picker-component" aria-labelledby="endpoint-picker-title">
          <header className="component-titlebar">
            <div>
              <h3 id="endpoint-picker-title">Endpoint Picker</h3>
            </div>
            <div className="component-state">
              <i className={gateHolding ? 'state-holding' : 'state-open'} />
              {gateHolding ? 'Holding' : 'Open'}
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
                queues={queuesForPriority(priority)}
                run={run}
              />
            ))}
          </div>

          <div className="epp-decision-stage">
            <strong className="priority-order" aria-label="Priority order">
              {priorities.map((priority) => `P${priority}`).join(' → ')}
            </strong>
            <div className={`saturation-gate ${gateHolding ? 'gate-is-holding' : ''}`}>
              <span>Saturation</span>
              <strong>{frame.saturation.toFixed(2)}×</strong>
              <div aria-hidden="true"><i /><i /><i /></div>
            </div>
          </div>
        </section>

        <Connector label={gateHolding ? 'held' : 'dispatch'} holding={gateHolding} visibleLabel={false} />

        <section className="vllm-component" aria-labelledby="runtime-title">
          <header className="component-titlebar">
            <div>
              <h3 id="runtime-title">vLLM{pods.length > 1 ? ` · ${formatCount(pods.length)} pods` : ''}</h3>
            </div>
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
                <h4 id="batch-title">Continuous batch</h4>
                <strong>{formatCount(running)}{maxSequences ? ` / ${formatCount(maxSequences)}` : ''}</strong>
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
                  <section className="vllm-waiting-queue" aria-labelledby="waiting-queue-title">
                    <header>
                      <h5 id="waiting-queue-title">Waiting</h5>
                      <strong>{formatCount(waiting)} / {formatCount(waitingPeak)} peak</strong>
                    </header>
                    {waitingSlots ? (
                      <>
                        <div
                          className="waiting-capacity-grid"
                          style={{ '--waiting-grid-columns': waitingColumns } as CSSProperties}
                          aria-label={`${waiting} requests waiting; ${waitingPeak} was the observed run peak and is not a configured limit`}
                        >
                          {Array.from({ length: waitingSlots }, (_, index) => (
                            <i key={index} className={index < visibleWaiting ? 'active' : ''} />
                          ))}
                        </div>
                      </>
                    ) : waitingPeak > MAX_RENDERED_SLOTS ? (
                      <div className="waiting-queue-empty">Peak {formatCount(waitingPeak)} · grid hidden</div>
                    ) : (
                      <div className="waiting-queue-empty">No waiting recorded</div>
                    )}
                  </section>
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
        </section>
      </div>
    </section>
  )
})
