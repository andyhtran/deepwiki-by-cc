## Commands

Always use `bun run` commands, never run tools directly:

```bash
bun run dev          # Start dev server
bun run check        # Type checking (zvelte-check)
bun run lint         # Lint (biome)
bun test             # Run tests (bun native)
bun run build        # Build for production
bun run start        # Start production server
```

**Do NOT run these directly:**
```bash
zvelte-check         # Use bun run check
biome check          # Use bun run lint
```

## Type Checking

Uses **zvelte-check** via `bun run check`. tsconfig.json extends `./.svelte-kit/tsconfig.json` (requires `svelte-kit sync` first; the check script runs it automatically).

## Testing

Uses **bun test** (native bun test runner, not vitest). Test files use `import { describe, test, expect } from "bun:test"`.
