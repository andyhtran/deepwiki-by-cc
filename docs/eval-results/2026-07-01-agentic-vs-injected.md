# Agentic vs. Injected Context — 2026-07-01

The experiment that made agentic exploration the only generation mode.

## Question

Does letting the page-writer model run as an agent inside the repo checkout (read-only Read/Grep/Glob tools, exploring the code itself) produce better wikis than the original one-shot approach (pre-assembled file contents injected into the prompt)?

## Setup

- **Golden repo:** this repo (`self`), pinned to public `origin/main` @ `b69e8cb20bfd462a6c60a0d892f543817eddffa7`
- **Four runs:** {Claude Sonnet 4.6, Codex gpt-5.5 medium} × {injected, agentic}
- **Judge:** claude-sonnet-4-6; 23 golden questions (14 floor + 9 depth); 8 pairwise topics, order-swapped
- Raw `run.json` / `scores.json` / pairwise verdicts with per-topic judge reasoning: in this directory

## Results

| | Claude injected | Claude agentic | Codex injected | Codex agentic |
|---|---|---|---|---|
| QA overall | 89% | **91%** | 85% | **93%** |
| QA floor | 89% | 89% | 89% | **100%** |
| QA depth | 89% | **94%** | 78% | **83%** |
| Core-file coverage | 92% | **100%** | 92% | **100%** |
| Citation validity | 91% | **93%** | 88% | **94%** |
| Mermaid validity | 5/5 | 3/3 | 9/9 | 10/10 |
| **Pairwise wins** | 0 | **4** (4 ties) | 2 | **6** (0 ties) |
| Duration | 12.9 min | 14.9 min | 8.3 min | 14.1 min |
| Cost | ~$4 (see note) | $3.35 | ~$3.37 est. | ~$5–7 est. (see note) |

## Conclusion

Agentic won or tied every category on both harnesses. Of 16 pairwise topics decided across the two harness pairs, injected won 2, agentic won 10, 4 tied. Qualitatively, the agentic pages carry behavioral specifics only reachable by reading the code (poll intervals, cancellation race guards, mutex behavior, concrete defaults), which is exactly what the depth questions and pairwise criteria measure.

Notes and caveats recorded at decision time:

- Single run per cell; individual QA deltas are within judge noise. The decision rests on the *consistency*: two harnesses × three instruments (QA depth, coverage, pairwise), all pointing the same way, with pairwise 10–2.
- Claude injected's recorded cost ($1.03) predates the cache-aware cost accounting fix; its true cost was ~$4 (per-page CLI-reported costs averaged ~$0.34). Codex agentic's recorded $16.77 predates cached-input discounting and also drew a 19-page outline by chance; the honest estimate is ~$5–7.
- Codex + `--output-schema` suppresses tool use entirely (the model answers instantly without exploring, hallucinating). Agentic Codex therefore runs schema-less with a final-message protocol. Discovered during this experiment; without the fix, agentic Codex silently doesn't explore.
- An earlier scoring round showed a phantom Mermaid regression (3/6) that turned out to be the metric counting *documentation about mermaid* (quoted fences in code blocks) as broken diagrams. Fixed with fence-aware counting — which also uncovered and fixed a real production bug where `diagram-policy.ts` could delete quoted example fences from page content.

## Reproduce

```bash
just eval my-label                      # current pipeline (agentic-only)
just eval-pairwise my-label other-label
```

The injected mode was removed after this experiment, so the injected cells are not reproducible from current code — that's what the archived JSONs in this directory are for.
