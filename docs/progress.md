# Benchmark progress

The **Benchmark progress** tab reads a single output directory from the
[inference benchmark harness](https://github.com/rh-aiservices-bu/inference-benchmark-harness).
It does not launch, stop, resume or modify a benchmark.

## Connect

Run the harness separately using its README. Verification precedes inference.
One benchmark config is enough for verification, smoke and a single-workload sweep.
A matrix is optional; supply one or generate it with the harness's `matrix-create`,
then inspect `matrix-plan` before execution. No serving settings are chosen here.

Point at the **output directory**, not the input config or campaign parent:

```sh
FLOW_PROGRESS_RUN=/absolute/path/to/results npm run dev
```

Open the printed localhost URL and select **Benchmark progress**. For a persistent
setting, put `FLOW_PROGRESS_RUN=/absolute/path/to/results` in `.env.local` and restart
the server. That file is ignored by Git. Paths with spaces must be quoted in the shell.

The initial view is empty until configured. Missing `state.json` or `config.json`
shows an error and retries; start the runner or correct the path. No sample progress
is silently substituted. `npm run preview` serves static replay only; the progress
and replay-library APIs require `npm run dev`.

## What the view means

| Display | Source / boundary |
|---|---|
| State and accepted repeats | `state.json`; accepted evidence is not a goal pass |
| State file updated | Filesystem modification time, not a process heartbeat or original acquisition time |
| Last read | Time the local adapter read the files |
| Config | Numeric load/workload/goal fields from saved `config.json`; original file SHA-256 and modification time |
| Request arrivals | `metadata.request_start_ns` from the latest attempt's native `profile_export.jsonl` files |

The chart combines streams, includes failed requests with timestamps and uses up to
60 bins anchored at the first recorded start. It counts starts, not completions,
target RPS or GPU activity. Empty bins mean no starts in the **read export**, not proof
of complete collection. Partial/missing exports are marked. The final bin may cover
only part of its interval; the y-axis is **count per bin**, not measured rate.

Polling runs every five seconds after the previous response, with a four-second
request timeout. Failed reads retain the last readable snapshot and show an error.
An active checkpoint older than 30 seconds is marked stale; long work between
checkpoints can be normal. A responding viewer does not prove the runner is alive.
Finished snapshots remain saved results, never “live.”

Config views exclude endpoints, headers, model identity, dataset paths, prompts,
observer commands and free-text notes. They are **not executable configs**. Benchmark,
stage and stream labels are still displayed: use non-sensitive labels. The viewer
does not verify the runner's acceptance manifests or independently approve results.

## Access and limits

Keep the dev server on localhost. The API accepts same-origin local GETs, exposes
no filesystem-path parameter, executes no commands and makes no cluster requests.
Only select trusted operator-controlled output directories. Do not serve this app
as a multi-user service or expose it with `--host 0.0.0.0`.

The adapter rejects symlinked input files, non-regular files and unsupported schemas.
Each config/state file is capped at 2 MiB; each native request export at 8 MiB.
It supports up to 200 rows, eight streams per row, 100 repeats and 5,000 directory
entries. Oversized request exports produce unavailable/partial traffic, not a sampled
graph; oversized config/state or unsupported structure produces an explicit error.
Split larger campaigns or extend these bounds with tests before using this view.

Validated against harness schema version 1, organization revision `8e48e27`, using
single-stream and mixed-stream AIPerf loopback output. This does not establish
customer deployment compatibility. Unknown future states fail visibly.

For remote execution, transfer the output directory using your approved method,
preserving timestamps. A local copy is historical unless your own synchronization
updates it; the viewer does not provide synchronization or port forwarding.

Use the harness CLI report and documented recovery procedure for stop reasons and
resumption. Check remote work has drained before resuming. No execution controls
are offered in this view.
