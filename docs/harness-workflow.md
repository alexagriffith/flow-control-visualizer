# From harness inputs to the test plan

Based on the [Red Hat AI Services harness example](https://github.com/rh-aiservices-bu/inference-benchmark-harness/blob/74b4aed5f2b95a0bf3597a30e4222bb23a3e830e/examples/matrix.json),
checked against `bench/matrix.py` and `Makefile` at `74b4aed` (September 18, 2026).
These are demonstration budgets, not calibrated serving settings.

For a first run, follow the harness [configure → verify → smoke → benchmark instructions](https://github.com/rh-aiservices-bu/inference-benchmark-harness/blob/74b4aed5f2b95a0bf3597a30e4222bb23a3e830e/README.md#install-and-configure).
`make configure` creates `benchmark.local.json`; default outputs are `results/smoke`
and `results/benchmark`. A matrix is optional, requires explicit `MATRIX`, and defaults
to `results/matrix`. The four-row example below is the mixed-workload path, not a first-run requirement.
See the [configuration reference](https://github.com/rh-aiservices-bu/inference-benchmark-harness/blob/74b4aed5f2b95a0bf3597a30e4222bb23a3e830e/docs/configuration.md) for all fields and defaults.

## Inputs

- `benchmark.json`: interactive endpoint/model, workload, limits, goals and metrics.
- `background.json`: the corresponding settings for background traffic.
- `matrix.json`: names the scenarios, references those two files and overrides load.

Keep the three files together when copying the examples; references are relative to
the matrix file. Edit endpoints and workloads before executing. In the example,
interactive requests use 128 input / 64 output tokens; background uses 256 / 128.
Goals are empty and no server metrics or priority headers are configured.
Naming a stream `interactive` does **not** give it higher serving priority.

## Four rows, three repeats each

| Scenario ID | Interactive | Background |
|---|---:|---:|
| `interactive-alone` | 0.5 requests/s | None |
| `interactive-alone` | 1 request/s | None |
| `interactive-with-background` | 0.5 requests/s | 0.5 requests/s |
| `interactive-with-background` | 0.5 requests/s | 1 request/s |

Rows run sequentially. Streams **within** a row run together. A matrix repeat is
the whole concurrent group, not a repeat for each stream independently.
`2/3` means two accepted groups out of three planned groups, not a 2/3 goal pass.
Replacement attempts do not count as extra accepted repeats.

The matrix overrides the base files' concurrency lists with the specified rates;
`max_concurrency: 4` remains a client-side execution limit, not an llm-d detector setting.
The example requires five seconds of traffic overlap for a mixed repeat.

## Commands — in the harness checkout

Replace `/path` with the directory containing your edited inputs. First verify and
smoke each workload configuration using the harness README; these example commands
show the interactive workload. Smoke sends inference; verify does not.

```sh
make verify CONFIG=/path/benchmark.json
make smoke CONFIG=/path/benchmark.json RUN=/path/results/interactive-smoke
```

Then preview the expanded matrix without traffic; execute only after review:

```sh
make matrix-plan MATRIX=/path/matrix.json RUN=/path/results/matrix
make matrix-run MATRIX=/path/matrix.json RUN=/path/results/matrix
make report RUN=/path/results/matrix
```

For a single-workload sweep, use `make plan` and `make benchmark` with `CONFIG`.
The unmodified single-workload example tests concurrency 1, 2 and 4, three repeats each.
The harness does not install, enable or tune flow control.

## What the visualizer reads

Point `FLOW_PROGRESS_RUN` at `/path/results/matrix`. Saved `config.json` contains
expanded rows; `state.json` records current position, accepted attempts and outcomes.
The viewer uses the latest attempt's native AIPerf request timestamps for the chart.
Pending rows come from the saved plan, never from guessing which test comes next.

The plan-only command prints a preview; it does not create a runnable result directory.
Without harness state, native AIPerf still supplies recorded traffic but no planned
tests or repeat progress. Raw commands may contain credentials and are not displayed.
