import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configuredPriorityBands, ingestRun, vllmFor } from './ingest-run'

describe('configuredPriorityBands', () => {
  it('preserves arbitrary configured bands, labels, and colors', () => {
    expect(configuredPriorityBands({
      epp_runtime: {
        priority_bands: [
          { priority: 25, label: 'Interactive', color: '#7457d9' },
          { priority: -4, label: 'Background', color: '#8a6f45' },
        ],
      },
    })).toEqual([
      { priority: 25, label: 'Interactive', color: '#7457d9' },
      { priority: -4, label: 'Background', color: '#8a6f45' },
    ])
  })

  it('also reads the legacy top-level priority band list', () => {
    expect(configuredPriorityBands({
      priority_bands: [{ priority: 7 }],
    })).toEqual([{ priority: 7, label: null, color: null }])
  })

  it('rejects display values that could escape the visual contract', () => {
    expect(configuredPriorityBands({
      epp_runtime: {
        priority_bands: [{ priority: 7, label: 'x'.repeat(100), color: 'url(https://example.com)' }],
      },
    })).toEqual([{ priority: 7, label: 'x'.repeat(80), color: null }])
  })
})

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

describe('ingestRun', () => {
  it('preserves optional open-loop traffic and per-request token evidence', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'flow-run-'))
    await writeFile(join(runDir, 'client_samples.csv'), [
      'run_id,scenario,tenant,priority,objective,status,start_s,ttft_s,latency_s,request_id,planned_arrival_s,prompt_tokens,completion_tokens,tpot_s',
      'run-1,poisson-proof,premium-a,100,premium,200,0.5,0.1,0.9,req-1,0.45,512,128,0.0063',
    ].join('\n'))
    await writeFile(join(runDir, 'traffic_samples.csv'), [
      'elapsed_s,tenant,target_rps,arrival_process,issued_requests,completed_requests,outstanding_requests,send_delay_s,safety_ceiling_state',
      '0.5,premium-a,12,poisson,1,0,1,0.05,ok',
    ].join('\n'))
    await writeFile(join(runDir, 'metric_samples.csv'), [
      'run_id,scenario,elapsed_s,inference_extension_flow_control_pool_saturation,vllm:num_requests_running,vllm:num_requests_waiting',
      'run-1,poisson-proof,0.5,1.2,10,2',
    ].join('\n'))

    const run = await ingestRun({
      runDir,
      output: join(runDir, 'run.json'),
      maxSequences: null,
      maxBatchedTokens: null,
      schedulerPolicy: null,
      chunkedPrefill: null,
    })

    expect(run.metadata.trafficMode).toBe('open_loop_poisson')
    expect(run.evidence.capabilities).toMatchObject({
      hasOpenLoop: true,
      hasPerRequestTokens: true,
      hasRequestIds: true,
      hasTpot: true,
    })
    expect(run.frames[0].tenants[0]).toMatchObject({
      targetRps: 12,
      arrivalProcess: 'poisson',
      outstandingRequests: 1,
      sendDelay: 0.05,
      safetyCeilingState: 'ok',
    })
  })
})
