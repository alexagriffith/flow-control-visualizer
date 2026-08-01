import type { VllmFrame } from '../types'

export function aggregateVllm(pods: VllmFrame[]) {
  return pods.reduce((total, pod) => ({
    running: total.running + pod.running,
    waiting: total.waiting + pod.waiting,
    preemptions: total.preemptions + pod.preemptions,
    peakKvCacheUsage: Math.max(total.peakKvCacheUsage, pod.kvCacheUsage),
  }), { running: 0, waiting: 0, preemptions: 0, peakKvCacheUsage: 0 })
}
