import { memo, type CSSProperties } from 'react'
import { formatCount, formatPercent, humanizeIdentifier } from '../lib/format'
import { balancedGridColumns } from '../lib/grid'
import { MAX_RENDERED_SLOTS, renderableSlotCount } from '../lib/visual-limits'
import { aggregateVllm } from '../lib/vllm'
import type { QueueFrame, RunData, TimelineFrame } from '../types'
import { MetricLabel } from './MetricLabel'

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
  return (
    <section
      className="priority-band"
      style={{ '--band-color': color, '--band-bg': `color-mix(in srgb, ${color} 8%, #fff)` } as CSSProperties}
      aria-label={`${label ?? 'Priority'} ${priority}`}
    >
      <header>
        <strong>P{priority}</strong>
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

function Connector({ label, holding }: { label: string; holding?: boolean }) {
  return (
    <div className={`component-connector ${holding ? 'connector-holding' : ''}`} aria-label={label}>
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
  const queuesForPriority = (priority: number): QueueFrame[] => {
    const observed = frame.queues.filter((queue) => queue.priority === priority)
    if (observed.length > 0) return observed
    return run.tenants
      .filter((tenant) => tenant.priority === priority)
      .map((tenant) => ({ id: tenant.id, priority, size: 0, bytes: 0 }))
  }

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
            <div className="request-stream-columns" aria-hidden="true">
              <span>Workload</span>
              <span>In flight</span>
            </div>
            {run.tenants.map((tenant) => {
              const current = frame.tenants.find((candidate) => candidate.id === tenant.id)
              const name = humanizeIdentifier(tenant.id)
              const inFlight = current?.actualInflight ?? 0
              return (
                <div className="request-stream" key={tenant.id} style={{ '--flow-color': tenant.color } as CSSProperties}>
                  <span className="request-stream-name" title={name}>{compactFlowName(tenant.id)}</span>
                  <span className="request-stream-count" aria-label={`${formatCount(inFlight)} in flight`}>
                    <strong>{formatCount(inFlight)}</strong>
                  </span>
                </div>
              )
            })}
          </div>
        </section>

        <Connector label="Requests enter the Endpoint Picker" />

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
            <div className="priority-stack-columns" aria-hidden="true">
              <span>Priority</span>
              <span>Queue</span>
              <span>Queued</span>
            </div>
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
            <div className={`saturation-gate ${gateHolding ? 'gate-is-holding' : ''}`}>
              <span>Saturation</span>
              <strong>{frame.saturation.toFixed(2)}×</strong>
              <div aria-hidden="true"><i /><i /><i /></div>
            </div>
          </div>
        </section>

        <Connector label={gateHolding ? 'Requests held by flow control' : 'Requests dispatched to vLLM'} holding={gateHolding} />

        <section className="vllm-component" aria-labelledby="runtime-title">
          <header className="component-titlebar">
            <div>
              <h3 id="runtime-title">
                <MetricLabel description="llm-d applies priority and fairness before dispatch. vLLM schedules requests after they are admitted.">vLLM</MetricLabel>
                {pods.length > 1 ? ` · ${formatCount(pods.length)} pods` : ''}
              </h3>
            </div>
          </header>

          <div className="runtime-pipeline">
            <section className="continuous-batch" aria-labelledby="batch-title">
              <header>
                <h4 id="batch-title">Continuous batch</h4>
                <span className="running-count"><small>Running</small><strong>{formatCount(running)}{maxSequences ? ` / ${formatCount(maxSequences)}` : ''}</strong></span>
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
                    <span><MetricLabel description="Share of vLLM key-value cache in use. High pressure can lead to preemption or swapping.">{pods.length > 1 ? 'Peak KV cache' : 'KV cache'}</MetricLabel> <strong>{formatPercent(peakKvCacheUsage)}</strong></span>
                    <span><MetricLabel description="Running requests paused by vLLM to free memory for other work.">Preemptions</MetricLabel> <strong>{formatCount(preemptions)}</strong></span>
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

            </section>

            <details className="runtime-config">
              <summary>Configuration</summary>
              <dl>
                <div><dt>Scheduler</dt><dd>{run.runtime.schedulerPolicy?.toLowerCase() === 'fcfs' ? 'First come, first served' : run.runtime.schedulerPolicy ? humanizeIdentifier(run.runtime.schedulerPolicy) : '—'}</dd></div>
                <div><dt>Maximum running sequences</dt><dd>{maxSequences ? formatCount(maxSequences) : '—'}</dd></div>
                <div><dt>Token budget per scheduling step</dt><dd>{run.limits.maxBatchedTokens ? `${formatCount(run.limits.maxBatchedTokens)} tokens` : '—'}</dd></div>
              </dl>
            </details>
          </div>
        </section>
      </div>
    </section>
  )
})
