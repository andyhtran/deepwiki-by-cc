default:
    @just --list --unsorted

# Start dev server with hot reload
[group('dev')]
dev:
    bun run dev

# Run test suite
[group('dev')]
test *args:
    bun test {{ args }}

# Run linter
[group('dev')]
lint:
    bun run lint

# Type check with zvelte-check
[group('dev')]
check:
    bun run check

# Build for production
[group('build')]
build:
    bun run build

# Remove build artifacts and dependencies
[group('build')]
clean:
    rm -rf build .svelte-kit .vite node_modules

# Install dependencies
[group('build')]
deps:
    bun install

# Start production server
[group('build')]
start: build
    bun run start

# Start Docker containers
[group('docker')]
up *args:
    docker compose up -d {{ args }}

# Stop Docker containers
[group('docker')]
down:
    docker compose down

# Full eval: generate wiki for the pinned golden repo, score it, print report
[group('eval')]
eval label *args:
    bun evals/run.ts --label {{ label }} {{ args }}
    bun evals/score.ts --label {{ label }}
    bun evals/report.ts {{ label }}

# Generate a wiki for the pinned golden repo (no scoring)
[group('eval')]
eval-run label *args:
    bun evals/run.ts --label {{ label }} {{ args }}

# Score an existing eval run (deterministic metrics + LLM QA grading)
[group('eval')]
eval-score label *args:
    bun evals/score.ts --label {{ label }} {{ args }}

# Print metrics for one run, or compare two runs side by side
[group('eval')]
eval-report *labels:
    bun evals/report.ts {{ labels }}

# Pairwise A/B judgment between two runs (topic-anchored, order-swapped)
[group('eval')]
eval-pairwise a b:
    bun evals/pairwise.ts {{ a }} {{ b }}
