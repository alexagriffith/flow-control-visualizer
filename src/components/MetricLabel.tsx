type MetricLabelProps = {
  children: string
  description: string
}

export function MetricLabel({ children, description }: MetricLabelProps) {
  return (
    <span
      className="metric-label"
      tabIndex={0}
      data-tooltip={description}
      aria-label={`${children}. ${description}`}
    >
      {children}
    </span>
  )
}
