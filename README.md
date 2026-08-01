# Flow Control Flight Recorder

An interactive replay UI for llm-d flow-control experiments. Its default component diagram shows
requests moving through the Endpoint Picker's priority/fairness queues and into the vLLM local
queue, scheduler, and continuously rebuilt batch. A synchronized telemetry view provides:

- client traffic and in-flight pressure by tenant;
- Endpoint Picker (EPP) admission queues by priority and fairness ID;
- vLLM running, waiting, KV-cache, and continuous-batching pressure.
- incoming and completed requests per second.

The UI is careful about evidence boundaries. Aggregate metrics are presented as aggregate metrics;
it does not invent a request route or exact vLLM batch membership when the run did not record them.

## Run the demo

```bash
npm install
npm run dev
```

The built-in synthetic run demonstrates the interface without private experiment data.

## Load an experiment

The ingestion script accepts a directory containing `client_samples.csv`,
`concurrency_samples.csv`, `metric_samples.csv`, and optionally `summary.json` and
`benchmark_config.json`:

```bash
npm run ingest -- --run-dir /absolute/path/to/a/run
npm run dev
```

It writes `public/data/run.json`, which is ignored by git. Reload the page and choose **Loaded run**
from the run selector. Use `--output` to choose another destination.

```bash
npm run ingest -- --run-dir /absolute/path/to/a/run --output /tmp/run.json
```

## Browse a run library

Set one or more artifact roots in an ignored `.env.local` file. Separate roots with the operating
system's path delimiter (`:` on macOS/Linux):

```bash
FLOW_RUN_ROOTS=/absolute/path/to/campaign-a:/absolute/path/to/campaign-b
```

Restart `npm run dev`. The experiment selector inventories every directory containing
`client_samples.csv` and loads a selected run on demand. It labels entries as:

- **Full replay:** client concurrency, EPP flow queues, and vLLM pressure.
- **Queues + runtime:** EPP/vLLM replay without sampled client concurrency.
- **Client/partial:** client timing plus whichever older metric fields remain compatible.

The configured roots and selected source data stay local; `.env.local` and generated JSON are
ignored by git.

### Run configuration

The replay derives tenants from the captured client data. Runtime limits and routing-band display
metadata can be supplied with the run instead of changing the UI:

```json
{
  "vllm_runtime": {
    "max_num_seqs": 128,
    "max_num_batched_tokens": 8192
  },
  "epp_runtime": {
    "priority_bands": [
      { "priority": 100, "label": "Premium", "color": "#2d5bff" },
      { "priority": 0, "label": "Standard", "color": "#168f82" }
    ]
  }
}
```

Any number of bands and tenants is supported. The continuous-batch grid uses `max_num_seqs` as its
configured size. vLLM does not expose a configured waiting-queue capacity, so the waiting grid uses
the exact observed peak for that run and labels it as an observation rather than a limit.

## Data boundary

The current artifacts support accurate post-run playback at the metric sampling interval. Exact
request waterfalls and exact vLLM iteration membership require request/trace correlation, router
dispatch events, and opt-in vLLM iteration telemetry. The interface calls these gaps out rather than
estimating them.

## Commands

```bash
npm run dev       # Vite development server
npm run ingest    # Convert a benchmark run into the UI data contract
npm test          # Unit tests
npm run build     # Type-check and production build
npm run preview   # Preview the production build
```
