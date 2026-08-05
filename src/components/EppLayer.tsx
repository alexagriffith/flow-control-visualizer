import { memo } from 'react'
import { formatBytes, formatCount, humanizeIdentifier } from '../lib/format'
import type { RunData, TimelineFrame } from '../types'

type EppLayerProps = {
  run: RunData
  frame: TimelineFrame
}

export const EppLayer = memo(function EppLayer({ run, frame }: EppLayerProps) {
  const maximum = Math.max(1, run.summary.maxEppQueue)
  const queuesByTenant = new Map(frame.queues.map((queue) => [`${queue.priority}:${queue.id}`, queue]))
  const sortedQueues = run.tenants.map((tenant) => queuesByTenant.get(`${tenant.priority}:${tenant.id}`) ?? {
    id: tenant.id,
    priority: tenant.priority,
    size: 0,
    bytes: 0,
  }).sort(
    (left, right) => right.priority - left.priority || left.id.localeCompare(right.id),
  )

  return (
    <section className="layer epp-layer" aria-labelledby="epp-layer-title">
      <div className="signal-bridge" aria-hidden="true"><span /></div>
      <div className="layer-index" aria-hidden="true">02</div>
      <header className="layer-header">
        <h2 id="epp-layer-title">Endpoint Picker</h2>
        <div className="saturation-readout">
          <span>Pool saturation</span>
          <strong>{frame.saturation.toFixed(2)}×</strong>
          <div className="saturation-track" aria-hidden="true">
            <span style={{ width: `${Math.min(100, frame.saturation * 25)}%` }} />
          </div>
        </div>
      </header>
      <div className="queue-rack">
        {sortedQueues.map((queue) => {
          const tenant = run.tenants.find((item) => item.id === queue.id)
          const color = tenant?.color ?? '#73808a'
          const fill = (queue.size / maximum) * 100
          return (
            <article className="queue-card" key={queue.id} style={{ '--queue-color': color } as React.CSSProperties}>
              <div className="queue-label">
                <div>
                  <span className="priority-badge">P{queue.priority}</span>
                  <h3>{humanizeIdentifier(queue.id)}</h3>
                </div>
                <strong>{formatCount(queue.size)}</strong>
              </div>
              <div className="queue-vessel" aria-label={`${queue.size} requests queued`}>
                <div className="queue-fill" style={{ height: `${fill}%` }} />
                <div className="queue-grid-lines" aria-hidden="true" />
              </div>
              <div className="queue-meta">
                <span>{formatBytes(queue.bytes)}</span>
              </div>
            </article>
          )
        })}
      </div>
      <div className="dispatch-gate">
        <span className="gate-label">Saturation gate</span>
        <div className={frame.saturation >= 1 ? 'gate gate-holding' : 'gate gate-open'} aria-hidden="true">
          <i /><i /><i />
        </div>
        <span className="gate-state">{frame.saturation >= 1 ? 'Holding' : 'Dispatching'}</span>
      </div>
    </section>
  )
})
