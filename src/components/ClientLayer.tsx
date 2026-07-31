import { formatCount, humanizeIdentifier } from '../lib/format'
import type { RunData, TimelineFrame } from '../types'
import { Sparkline } from './Sparkline'

type ClientLayerProps = {
  run: RunData
  frame: TimelineFrame
  frameIndex: number
}

export function ClientLayer({ run, frame, frameIndex }: ClientLayerProps) {
  return (
    <section className="layer client-layer" aria-labelledby="client-layer-title">
      <div className="layer-index" aria-hidden="true">01</div>
      <header className="layer-header">
        <div>
          <p className="eyebrow">Pressure enters</p>
          <h2 id="client-layer-title">Client traffic</h2>
        </div>
        <div className="layer-live-stats">
          <span><strong>{frame.arrivals}</strong> arrivals</span>
          <span><strong>{frame.completions}</strong> completed</span>
        </div>
      </header>
      <div className="tenant-grid">
        {run.tenants.map((tenant) => {
          const current = frame.tenants.find((sample) => sample.id === tenant.id)
          const values = run.frames.map(
            (sample) => sample.tenants.find((item) => item.id === tenant.id)?.actualInflight ?? 0,
          )
          return (
            <article className="tenant-card" key={tenant.id} style={{ '--tenant-color': tenant.color } as React.CSSProperties}>
              <div className="tenant-card-top">
                <span className="tenant-signal" aria-hidden="true" />
                <div>
                  <h3>{humanizeIdentifier(tenant.id)}</h3>
                  <p>Priority {tenant.priority} · {humanizeIdentifier(tenant.objective)}</p>
                </div>
                <strong className="inflight-value">{formatCount(current?.actualInflight ?? 0)}</strong>
              </div>
              <Sparkline
                values={values}
                currentIndex={frameIndex}
                color={tenant.color}
                label={`${humanizeIdentifier(tenant.id)} in-flight concurrency over time`}
              />
              <div className="tenant-card-foot">
                <span>Actual in flight</span>
                <span>Target {formatCount(current?.targetConcurrency ?? 0)}</span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
