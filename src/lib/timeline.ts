import type { TimelineFrame } from '../types'

export function frameIndexAtTime(frames: TimelineFrame[], time: number): number {
  if (frames.length === 0) return 0
  let low = 0
  let high = frames.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (frames[middle].time <= time) low = middle + 1
    else high = middle - 1
  }

  return Math.max(0, Math.min(frames.length - 1, high))
}

export function pointsFor(
  frames: TimelineFrame[],
  width: number,
  height: number,
  value: (frame: TimelineFrame) => number,
): string {
  if (frames.length === 0) return ''
  let maximum = 1
  for (const frame of frames) maximum = Math.max(maximum, value(frame))

  return frames
    .map((frame, index) => {
      const x = frames.length === 1 ? 0 : (index / (frames.length - 1)) * width
      const y = height - (value(frame) / maximum) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}
