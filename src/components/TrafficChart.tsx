import type { ProgressData } from '../progress-types'

export function TrafficChart({ traffic, source }: Pick<ProgressData, 'traffic' | 'source'>) {
  const { counts, secondsPerBin: width } = traffic
  const rates = counts.map(n => n / width)
  const max = Math.max(...rates, 1)
  const duration = counts.length * width
  const x = (i: number) => 54 + (i + 0.5) / counts.length * 916
  const y = (value: number) => 178 - value / max * 148
  const points = rates.map((rate, i) => `${x(i)},${y(rate)}`).join(' ')
  const test = traffic.attempt?.match(/^(?:row|point)-(\d+)/)?.[1]
  return <section className="progress-panel traffic-panel">
    <header><h2>Request starts over time</h2><span>{traffic.records ? `${traffic.records} recorded starts` : 'No request timeline'}</span></header>
    {traffic.unavailable ? <p className="progress-note">{traffic.unavailable}</p> : <>
      <div className="progress-chart-label"><span>Recorded request starts/s · {width}s bins</span><span>{source === 'harness' ? `Latest saved: test ${Number(test)} · all streams` : 'Native request records'}</span></div>
      <svg className="progress-chart" viewBox="0 0 1000 210" role="img" aria-label={`Recorded request starts per second, ${width}-second bins, ${duration} seconds from first recorded start`}>
        {[0, max / 2, max].map(value => <g key={value}><line x1="54" x2="970" y1={y(value)} y2={y(value)} /><text x="42" y={y(value) + 4} textAnchor="end">{Number(value.toFixed(2))}</text></g>)}
        <polyline points={points} />
        {rates.map((rate, i) => <circle key={i} cx={x(i)} cy={y(rate)} r="3"><title>{i * width}–{(i + 1) * width}s: {counts[i]} starts ({Number(rate.toFixed(2))}/s)</title></circle>)}
        {[0, duration / 2, duration].map((value, i) => <text key={i} x={54 + i * 458} y="204" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{value}s</text>)}
      </svg>
      <details><summary>Timing and counts</summary><p>Elapsed time starts at {traffic.start}. Points are fixed-bin counts divided by bin width; the final bin may be incomplete. Lines connect bin samples, not individual arrivals. Includes failed requests with start timestamps, not successful throughput or server queue depth.</p><p>{counts.map((n, i) => `${i * width}–${(i + 1) * width}s: ${n}`).join(' · ')}</p>{traffic.attempt ? <p>Attempt: {traffic.attempt}</p> : null}</details>
    </>}
    {traffic.partial ? <p className="progress-alert">Partial export: missing, incomplete, oversized or unmatched artifacts omitted.</p> : null}
  </section>
}
