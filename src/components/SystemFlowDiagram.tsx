import type { CSSProperties } from 'react'
import { formatCount, formatPercent, formatTime, humanizeIdentifier } from '../lib/format'
import type { QueueFrame, RunData, TimelineFrame } from '../types'

type SystemFlowDiagramProps = {
  run: RunData
  frame: TimelineFrame
}

const REQUIRED_PRIORITY_BANDS = [100, 0, -10]

function priorityName(priority: number): string {
  if (priority > 0) return 'Premium'
  if (priority < 0) return 'Batch'
  return 'Standard'
}

function priorityClass(priority: number): string {
  if (priority > 0) return 'priority-premium'
  if (priority < 0) return 'priority-batch'
  return 'priority-standard'
}

function QueueDots({ queue }: { queue: QueueFrame }) {
  const visibleDots = Math.min(12, queue.size)
  return (
    <div className="diagram-queue-dots" aria-hidden="true">
      {Array.from({ length: visibleDots }, (_, index) => <i key={index} />)}
      {queue.size > visibleDots ? <span>+{formatCount(queue.size - visibleDots)}</span> : null}
      {queue.size === 0 ? <em>empty</em> : null}
    </div>
  )
}

function PriorityBand({ priority, queues, run }: { priority: number; queues: QueueFrame[]; run: RunData }) {
  const queued = queues.reduce((total, queue) => total + queue.size, 0)
  const activeQueues = queues.filter((queue) => queue.size > 0)
  const emptyQueueCount = queues.length - activeQueues.length
  return (
    <section className={`priority-band ${priorityClass(priority)}`} aria-label={`${priorityName(priority)} priority ${priority}`}>
      <header>
        <div>
          <strong>P{priority}</strong>
          <span>{priorityName(priority)}</span>
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

export function SystemFlowDiagram({ run, frame }: SystemFlowDiagramProps) {
  const priorities = [...new Set([...REQUIRED_PRIORITY_BANDS, ...frame.queues.map((queue) => queue.priority)])]
    .sort((left, right) => right - left)
  const totalQueued = frame.queues.reduce((total, queue) => total + queue.size, 0)
  const pod = frame.vllm[0]
  const sampleInterval = Math.max(0.001, run.metadata.sampleInterval)
  const incomingRps = frame.arrivals / sampleInterval
  const gateHolding = frame.saturation >= 1
  const running = pod?.running ?? 0
  const maxSequences = run.limits.maxSequences
  const sequencePercent = maxSequences ? Math.min(100, (running / maxSequences) * 100) : null

  return (
    <section className="system-diagram" aria-labelledby="system-diagram-title">
      <header className="system-diagram-header">
        <div>
          <p className="eyebrow">Selected moment</p>
          <h2 id="system-diagram-title">Request path</h2>
        </div>
        <div className="diagram-live-readout">
          <span><strong>{incomingRps.toFixed(1)}</strong> req/s</span>
          <span><strong>{formatCount(totalQueued)}</strong> EPP queued</span>
          <span><strong>{formatCount(pod?.waiting ?? 0)}</strong> vLLM waiting</span>
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
              <h3 id="runtime-title">vLLM</h3>
            </div>
            <div className="component-state runtime-state"><i /> Sample {formatTime(frame.time)}</div>
          </header>

          <div className="policy-boundary"><span>llm-d priority ends here</span></div>

          <div className="runtime-pipeline">
            <section className="runtime-waiting-queue" aria-label={`${pod?.waiting ?? 0} requests reported by vLLM as waiting`}>
              <header>
                <span title="vllm:num_requests_waiting">vLLM waiting</span>
                <strong>{formatCount(pod?.waiting ?? 0)}</strong>
              </header>
              <div className="runtime-queue-track" aria-hidden="true">
                {Array.from({ length: Math.min(14, pod?.waiting ?? 0) }, (_, index) => <i key={index} />)}
                {(pod?.waiting ?? 0) === 0 ? <em>empty</em> : null}
                {(pod?.waiting ?? 0) > 14 ? <b>+{formatCount((pod?.waiting ?? 0) - 14)}</b> : null}
              </div>
            </section>

            <div className="scheduler-step">
              <div className="scheduler-rotor" aria-hidden="true"><i /><b>↻</b></div>
              <span>Scheduler</span>
              <strong>{run.runtime.schedulerPolicy?.toUpperCase() ?? 'NOT CAPTURED'}</strong>
            </div>

            <section className="continuous-batch" aria-labelledby="batch-title">
              <header>
                <div>
                  <span title="vllm:num_requests_running">Continuous scheduler</span>
                  <h4 id="batch-title">Continuous batch</h4>
                </div>
                <strong>{formatCount(running)} active{maxSequences ? ` / ${formatCount(maxSequences)}` : ''}</strong>
              </header>

              {sequencePercent === null ? (
                <div className="active-request-bar unknown"><i /></div>
              ) : (
                <div className="active-request-bar" aria-label={`${sequencePercent.toFixed(0)} percent of configured request limit`}>
                  <i style={{ width: `${sequencePercent}%` }} />
                </div>
              )}
              <div className="batch-facts">
                <span>KV <strong>{formatPercent(pod?.kvCacheUsage ?? 0)}</strong></span>
                <span>Preemptions <strong>{formatCount(pod?.preemptions ?? 0)}</strong></span>
                {run.limits.maxBatchedTokens ? <span>Token cap <strong>{formatCount(run.limits.maxBatchedTokens)}</strong></span> : null}
              </div>

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
}
