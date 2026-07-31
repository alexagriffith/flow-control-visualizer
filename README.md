# Flow Control Flight Recorder

An interactive replay UI for llm-d flow-control experiments. It synchronizes three views over a
single time cursor:

- client traffic and in-flight pressure by tenant;
- Endpoint Picker (EPP) admission queues by priority and fairness ID;
- vLLM running, waiting, KV-cache, and continuous-batching pressure.

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
`concurrency_samples.csv`, `metric_samples.csv`, and optionally `summary.json`:

```bash
npm run ingest -- --run-dir /absolute/path/to/a/run
npm run dev
```

It writes `public/data/run.json`, which is ignored by git. Reload the page and choose **Loaded run**
from the run selector. Use `--output` to choose another destination.

```bash
npm run ingest -- --run-dir /absolute/path/to/a/run --output /tmp/run.json
```

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
