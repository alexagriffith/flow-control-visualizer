import { useId } from 'react'

type SparklineProps = {
  values: number[]
  currentIndex: number
  color: string
  label: string
}

export function Sparkline({ values, currentIndex, color, label }: SparklineProps) {
  const gradientId = useId().replaceAll(':', '')
  const width = 360
  const height = 68
  let maximum = 1
  for (const value of values) maximum = Math.max(maximum, value)
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width
      const y = height - (value / maximum) * (height - 8) - 4
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const currentX = values.length === 1 ? 0 : (currentIndex / (values.length - 1)) * width

  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.24" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradientId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1={currentX} x2={currentX} y1="0" y2={height} className="spark-cursor" />
    </svg>
  )
}
