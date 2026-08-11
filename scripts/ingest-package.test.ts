import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { ingestPublishedPackage, listPublishedRuns } from './ingest-package'

describe('ingestPublishedPackage', () => {
  it('replays a public long-form package without inventing queue or vLLM values', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'flow-package-'))
    await writeFile(join(directory, 'request-results.csv'), [
      'run_name,scenario,request_number,tenant,priority,http_status,planned_arrival_seconds,actual_send_seconds,send_lag_ms,ttft_ms,e2e_latency_ms,prompt_tokens,completion_tokens,tpot_ms_per_token,timeout,error_class,retry_count',
      'repeat 1,priority tiers,1,premium,100,200,0,0.01,10,300,900,512,128,12,false,,0',
    ].join('\n'))
    await writeFile(join(directory, 'traffic-samples.csv'), [
      'run_name,elapsed_seconds,tenant,arrival_process,issued_requests,completed_requests,outstanding_requests,send_delay_seconds,safety_ceiling_state',
      'repeat 1,0,premium,poisson,1,0,1,0.01,not_applicable',
    ].join('\n'))
    await writeFile(join(directory, 'system-metrics.csv'), [
      'run_name,elapsed_seconds,metric,workload,priority,model_replica,value',
      'repeat 1,0,endpoint_picker_pool_saturation_ratio,,,,1.1',
      'repeat 1,0,endpoint_picker_policy_queue_requests,warmup,100,,0',
      'repeat 1,0,endpoint_picker_policy_queue_requests,premium,100,,3',
      'repeat 1,0,endpoint_picker_policy_queue_requests,premium peer,100,,1',
      'repeat 1,0,vllm_running_requests,,,model-1,12',
      'repeat 1,0,vllm_waiting_requests,,,model-1,2',
      'repeat 1,0,vllm_kv_cache_usage_ratio,,,model-1,0.25',
      'repeat 1,0,vllm_preemptions_total,,,model-1,0',
    ].join('\n'))
    await writeFile(join(directory, 'run-config.json'), JSON.stringify({
      model_service: {
        max_num_sequences: 128,
        max_num_batched_tokens: 8192,
        prefix_cache: 'disabled',
      },
    }))

    await expect(listPublishedRuns(directory)).resolves.toEqual(['repeat 1'])
    const run = await ingestPublishedPackage({ packageDir: directory, runName: 'repeat 1', output: '' })
    expect(run.summary).toMatchObject({ requestCount: 1, maxEppQueue: 3, maxVllmWaiting: 2 })
    expect(run.frames[0].vllm[0]).toMatchObject({ pod: 'model-1', running: 12, kvCacheUsage: 0.25 })
    expect(run.frames[0].queues).toHaveLength(2)
    expect(run.frames[0].queues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'premium', size: 3 }),
      expect.objectContaining({ id: 'premium peer', size: 1 }),
    ]))
    expect(run.limits).toEqual({ maxSequences: 128, maxBatchedTokens: 8192 })
  })
})
