import { memo } from 'react'
import { formatCount, humanizeIdentifier } from '../lib/format'
import { balancedCardColumns } from '../lib/grid'
import type { RunData, TimelineFrame } from '../types'
import { Sparkline } from './Sparkline'

type ClientLayerProps = {
  run: RunData
  frame: TimelineFrame
  frameIndex: number
}

export const ClientLayer = memo(function ClientLayer({ run, frame, frameIndex }: ClientLayerProps) {
  const columns = balancedCardColumns(run.tenants.length)
  return (
    <section className="layer client-layer" aria-labelledby="client-layer-title">
      <header className="layer-header">
        <h2 id="client-layer-title">Traffic</h2>
      </header>
      <div className="tenant-grid" style={{ '--tenant-grid-columns': columns } as React.CSSProperties}>
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
                  <p>P{tenant.priority}</p>
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
                <span>Target {formatCount(current?.targetConcurrency ?? 0)}</span>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
})
