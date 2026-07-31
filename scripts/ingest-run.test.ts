import { describe, expect, it } from 'vitest'
import { vllmFor } from './ingest-run'

describe('vllmFor', () => {
  it('keeps older aggregate samples compatible', () => {
    expect(vllmFor({
      'vllm:num_requests_running': '12',
      'vllm:num_requests_waiting': '3',
      'vllm:gpu_cache_usage_perc': '0.25',
      'vllm:num_preemptions_total': '2',
    }, [])).toEqual([{
      pod: 'vllm-aggregate',
      running: 12,
      waiting: 3,
      kvCacheUsage: 0.25,
      preemptions: 2,
      aggregated: true,
    }])
  })

  it('preserves labeled engine samples separately', () => {
    const suffix = 'engine=0|pod=model-a'
    expect(vllmFor({
      [`vllm:num_requests_running|${suffix}`]: '10',
      [`vllm:num_requests_waiting|${suffix}`]: '2',
      [`vllm:gpu_cache_usage_perc|${suffix}`]: '0.5',
      [`vllm:num_preemptions_total|${suffix}`]: '4',
    }, [`vllm:num_requests_running|${suffix}`])).toEqual([{
      pod: 'model-a',
      running: 10,
      waiting: 2,
      kvCacheUsage: 0.5,
      preemptions: 4,
      aggregated: false,
    }])
  })
})
