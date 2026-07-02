# Wiki Generation Evals

A local benchmarking harness for measuring wiki quality against golden repos pinned to specific commits. It exists so that pipeline changes ("this should make wikis better") can be proven or disproven with numbers instead of vibes.

## How to run

```bash
just eval <label>                 # generate + score + report in one go
just eval-run <label> [args]      # generate only (--model <id>, --repo <name>, --force)
just eval-score <label> [args]    # score an existing run (--skip-qa preserves prior QA results)
just eval-report <a> [<b>]        # print one run, or compare two side by side
just eval-pairwise <a> <b>        # topic-anchored A/B judgment between two runs
```

Runs are stored under `evals/results/<label>/` (gitignored — regenerable artifacts). Eval data is isolated from the real app database via `DEEPWIKI_DATA_DIR=evals/.data`, which also means you can browse generated eval wikis in the UI:

```bash
DEEPWIKI_DATA_DIR=evals/.data bun --bun run dev
```

## Golden repos

`evals/config.json` pins each golden repo to a commit SHA. The runner materializes a detached local clone of that SHA under `evals/.data/snapshots/`, so every run documents an identical codebase regardless of local branch state.

**Rebaselining:** when the pinned SHA gets stale, bump it in `evals/config.json`, review `evals/questions/<repo>.json` against the new tree (answers must stay true at the pin — prefer questions about stable architecture over volatile defaults), verify `coreFiles` still exist, and re-run a baseline before comparing anything against older runs.

## Metrics

### Deterministic (free, objective)

- **Citation validity** — % of file-path-looking references (inline code spans, link targets, GitHub blob URLs) that resolve to a real scanned file. Bare basenames and trailing path fragments match by suffix. Known non-citations are excluded: extension globs (`.min.js`), never-scannable paths (build artifacts, lock files, skip-listed secrets). Remaining invalids are a human review list, not a pure hallucination rate — quoted example paths from prompts/tests land here.
- **Core-file coverage** — % of hand-picked must-discuss files (per repo in `evals/config.json`) mentioned anywhere in the wiki. The direct measure of "documents files vs. explains the system".
- **Mermaid validity** — real diagram fences vs. diagrams passing the type validator. Counting is fence-aware (shared with `diagram-policy.ts`): wikis that document mermaid handling quote `` ```mermaid `` inside code spans and code blocks, and naive substring counting mistakes that documentation for broken diagrams.
- **Size stats** — sections/pages/words, for spotting bloat.

### QA (LLM judge, two calls per run)

Golden questions with verified answer keys live in `evals/questions/<repo>.json`. The judge answers every question **from the wiki corpus only** (instructed to be exhaustive — summary-level answering was measured to cost ~10 points against both sides equally), then a second call grades answers against the keys (`correct`/`partial`/`incorrect`, plus `unanswerable`).

Score = (correct + 0.5 × partial) / total, reported overall and split by tag:

- **floor** — questions any decent wiki answers (what/where/how-configured)
- **depth** — behavioral specifics that require reading the code closely (races, limits, retry math, edge cases)

### Pairwise (the discriminator)

Absolute QA saturates near the top. `evals/pairwise.ts` compares two runs topic by topic (topics + keywords per repo in `evals/config.json`): the best-matching page from each run is selected deterministically by keyword frequency, and a judge picks the page that better explains how the system *actually works* — judged twice with presentation order swapped; disagreement between orderings counts as a tie, which cancels position bias.

## Interpreting results

- Generation and judging are nondeterministic. A single-question QA delta is noise; rerun close comparisons and only trust deltas that survive. Consistent direction across multiple instruments (QA depth + coverage + pairwise) is the real signal.
- Cost numbers: Claude runs report exact CLI cost (cache-aware). Codex runs are estimates — cached input is priced at 10% of the input rate, but the CLI reports no authoritative cost.
- The judge model is set in `evals/config.json` (`judgeModel`); keep it fixed across runs you intend to compare.

## Historical results

Dated snapshots of decision-driving comparisons live in `docs/eval-results/`. The 2026-07-01 comparison (agentic vs. injected context, both harnesses) is what justified making agentic exploration the only generation mode.
