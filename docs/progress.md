# Benchmark progress

The **Benchmark progress** tab reads native AIPerf exports directly, or a single
output directory from the [inference benchmark harness](https://github.com/rh-aiservices-bu/inference-benchmark-harness).
It does not launch, stop, resume or modify a benchmark.

## Connect

Run AIPerf or the harness separately. If using the harness, follow its README:
verify → smoke → benchmark. A matrix is optional. No serving settings are chosen here.

Point at the **output directory**, not an input config or campaign parent:

```sh
FLOW_PROGRESS_RUN=/absolute/path/to/results npm run dev
```

Open the printed localhost URL and select **Benchmark progress**. For a persistent
setting, put `FLOW_PROGRESS_RUN=/absolute/path/to/results` in `.env.local` and restart
the server. That file is ignored by Git. Paths with spaces must be quoted in the shell.

For native AIPerf, select the directory containing `profile_export.jsonl` and,
optionally, `profile_export_aiperf.json`. Only default filenames are supported.
No harness configuration or matrix is required. A summary without per-request records
cannot provide the chart. Native records do not establish a plan, repeat count or
current process state; those remain unknown rather than becoming pending/completed tests.

The initial view is empty until configured. If either harness `state.json` or
`config.json` is present, both must be valid; a broken checkpoint does not silently
fall back to native mode. No sample progress is substituted. `npm run preview`
serves static replay only; the progress
and replay-library APIs require `npm run dev`.

## What the view means

| Display | Source / boundary |
|---|---|
| Plan, state and accepted repeats | Harness `config.json` and `state.json`; accepted evidence is not a goal pass |
| File updated | Filesystem modification time, not a process heartbeat or original acquisition time |
| Last read | Time the local adapter read the files |
| Config | Numeric load/workload/goal fields from saved `config.json`; original file SHA-256 and modification time |
| Request starts | `metadata.request_start_ns` from standalone records or the latest harness attempt's native files |

The chart combines streams, includes failed requests with timestamps and uses up to
60 bins anchored at the first recorded start. The y-axis is recorded starts divided
by bin width (requests/s); lines connect bin samples, not individual arrivals.
It includes all exported request phases, not completions, target RPS or GPU activity.
Empty bins mean no starts in the **read export**, not proof of complete collection.
Partial/missing exports are marked. The final bin may be incomplete: do not read a
last-bin decrease as a sustained rate change. The timestamped count table is expandable.

Polling runs every five seconds after the previous response, with a four-second
request timeout. Failed reads retain the last readable snapshot and show an error.
An active checkpoint older than 30 seconds is marked stale; long work between
checkpoints can be normal. A responding viewer does not prove the runner is alive.
Finished snapshots remain saved results, never “live.” After a goal miss or request-error
stop, unrun tests remain pending; the completed test retains its outcome.

Config views exclude endpoints, headers, model identity, dataset paths, prompts,
observer commands and free-text notes. They are **not executable configs**. Benchmark,
stage and stream labels are still displayed: use non-sensitive labels. The viewer
does not verify the runner's acceptance manifests or independently approve results.
Native `inputs.json`, raw payload exports and saved CLI command strings are not served.
The suggested `make report` command contains a placeholder path; it is not a process observation.

## Access and limits

Keep the dev server on localhost. The API accepts same-origin local GETs, exposes
no filesystem-path parameter, executes no commands and makes no cluster requests.
Only select trusted operator-controlled output directories. Do not serve this app
as a multi-user service or expose it with `--host 0.0.0.0`.

The adapter rejects symlinked input files, non-regular files and unsupported schemas.
Each config/state/summary file is capped at 2 MiB; each native request export at 8 MiB.
It supports up to 200 rows, eight streams per row, 100 repeats and 5,000 directory
entries. Oversized request exports produce unavailable/partial traffic, not a sampled
graph; oversized config/state or unsupported structure produces an explicit error.
Split larger campaigns or extend these bounds with tests before using this view.

Validated against harness schema version 1 and native AIPerf 0.12.0 summary schema
1.4 using retained single-stream and mixed-stream loopback output. JSONL-only mode
validates the request metadata shape; unsupported summaries/states fail visibly.
This does not establish customer deployment compatibility. [AIPerf export reference](https://github.com/ai-dynamo/aiperf/blob/be53bf2953d30e46c500e6a80fc1f8b6f84bc718/docs/tutorials/working-with-profile-exports.md).

This is not a native AIPerf-to-replay converter. The existing replay requires its
compatible CSV schemas, not AIPerf summary CSV or arbitrary GuideLLM exports;
native server metrics do not currently populate Endpoint Picker/vLLM replay panels.

For remote execution, transfer the output directory using your approved method,
preserving timestamps. A local copy is historical unless your own synchronization
updates it; the viewer does not provide synchronization or port forwarding.

Use the harness CLI report and documented recovery procedure for stop reasons and
resumption. Check remote work has drained before resuming. No execution controls
are offered in this view.
