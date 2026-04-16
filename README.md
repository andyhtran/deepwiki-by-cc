# DeepWiki

Generate comprehensive, navigable wikis for any GitHub repository or local codebase using Claude or Codex.

Point DeepWiki at a repo and it will clone it, scan the source files, generate a structured outline and per-page documentation with Mermaid diagrams, and serve the result as a browsable wiki — all in a few minutes.

![Bun](https://img.shields.io/badge/Bun-1.0+-black?style=flat-square&logo=bun)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-2.50-FF3E00?style=flat-square&logo=svelte&logoColor=white)
![License](https://img.shields.io/github/license/andyhtran/deepwiki-by-cc?style=flat-square)
![Powered by Claudex](https://img.shields.io/badge/powered%20by-Claudex-8A5CF6?style=flat-square)

[Features](#features) · [Prerequisites](#prerequisites) · [Quick Start](#quick-start) · [How It Works](#how-it-works) · [MCP Server](#mcp-server) · [Self-Hosting](#self-hosting-with-docker)

<!-- TODO: add hero screenshot or GIF here -->

## Features

- **Claude or Codex** — pick between Claude Sonnet/Opus or Codex CLI (gpt-5.3-codex) per wiki, with streaming progress and configurable page concurrency.
- **GitHub or local** — point at `owner/repo`, a full GitHub URL, or any local directory. `.gitignore`-aware scanning that filters out binaries, lock files, and generated code.
- **Structured output** — AI-generated outline with sections and pages, rendered with Mermaid diagrams, syntax highlighting, sidebar navigation, and a per-page table of contents.
- **Semantic retrieval** — optional embeddings with hybrid (file-scoped + global fallback) search, token-aware chunking, and a built-in ANN index. Falls back to full-file context if embedding fails.
- **Versioned wikis** — keep multiple versions per repo, each tagged with the model and embedding config used to generate it. Switch between versions from the sidebar.
- **Sync & resume** — pull latest commits and selectively regenerate only the pages affected by the diff. Resume picks up where interrupted runs left off.
- **MCP server** — expose wikis to Claude Code and other MCP agents via stdio or Streamable HTTP transport, with keyword and semantic search tools.
- **Self-hosted** — one-command Docker setup with persistent credential volumes, private-repo support via `GH_TOKEN`, and ~850 MB image footprint.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` must be on your PATH) when using Claude models
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and authenticated (`codex` must be on your PATH) when using the Codex model
- [Git](https://git-scm.com) and [GitHub CLI](https://cli.github.com) (`gh`) for cloning GitHub repos

## Quick Start

```bash
git clone https://github.com/andyhtran/deepwiki-by-cc.git
cd deepwiki-by-cc
bun install
bun run dev
```

Open [http://localhost:5173](http://localhost:5173), paste a GitHub URL (or `owner/repo`), and watch the wiki generate in real time.

### Local repositories

You can also point DeepWiki at a local directory:

```
/path/to/your/project
~/Code/my-project
./relative/path
```

## How It Works

1. **Clone & scan** — clones the repo (or reads a local directory), walks the file tree while respecting `.gitignore`, and filters out binaries, lock files, generated code, and minified bundles.
2. **Generate outline** — sends the file tree and README to the selected generation model, which returns a structured wiki outline with sections, pages, and file assignments.
3. **Generate pages** — each page is generated in parallel (configurable concurrency), with relevant source files injected as context. Mermaid diagrams are included where they help explain architecture or flow.
4. **Serve** — the wiki is stored in SQLite and served through a SvelteKit app with syntax highlighting, Mermaid rendering, a sidebar navigation tree, and a table of contents.

### Keeping wikis up to date

- **Sync** — pulls latest commits and selectively regenerates only the pages affected by the diff. Page metadata (model, tokens, timing) is updated even when content doesn't change.
- **Resume** — if generation is interrupted or individual pages fail, resume picks up where it left off.
- **Regenerate** — full regeneration from scratch.

### Version metadata

Each wiki version records the generation model and embedding configuration that was active at creation time. When embeddings are enabled, the wiki stores the embedding model name and an endpoint fingerprint so that different embedding providers don't cross-contaminate search results. The version selector in the sidebar shows per-version stats and an "emb" indicator for embedding-enabled versions.

## Settings

Visit `/settings` in the UI to configure:

| Setting | Default | Options |
|---------|---------|---------|
| Model | Claude Sonnet 4.6 | Sonnet 4.6, Opus 4.6, gpt-5.3-codex |
| Parallel page limit | 2 | 1–5 |
| Embeddings retrieval | Disabled | Optional OpenAI-compatible endpoint + model |

When Codex is selected, DeepWiki uses `codex exec` with a fixed model (`gpt-5.3-codex`).

When embeddings are enabled, DeepWiki indexes file chunks in SQLite and retrieves top semantic chunks for page generation context. Configure the embedding endpoint as a full URL (for example, `https://api.openai.com/v1/embeddings` or your proxy equivalent). Advanced retrieval/chunking controls stay collapsed in the UI and default to a low-touch profile (`topK=10`, `maxContextChars=16000`, `chunkSize=1200`, `chunkOverlap=200`). If embedding retrieval fails, it falls back to full-file context injection.

### Retrieval Modes

DeepWiki uses different retrieval strategies depending on the surface:

| Surface | Default Mode | Top K | Max Context Chars | Description |
|---------|-------------|-------|-------------------|-------------|
| Generation | `constrained` | 10 | 16,000 | File-scoped retrieval using the page's assigned file paths |
| MCP/Chat | `hybrid_auto` | 20 | 32,000 | Tries constrained first, falls back to global if results look weak |

In `hybrid_auto` mode, constrained retrieval runs first. If the results are detected as weak (too few chunks, low similarity scores, or flat score distribution), DeepWiki automatically falls back to a global search across all indexed chunks in the repository, then merges and deduplicates the results.

**Weakness detection thresholds** (configurable in Settings > Advanced):
- Min chunks: 3 — triggers fallback if fewer chunks returned
- Min context chars: 4,000 — triggers if total context is too short
- Min top score: 0.3 — triggers if best match similarity is low
- Min score gap: 0.05 — triggers if scores are too flat (no clear winner)

**Token-aware chunking**: Chunks can be sized by token count instead of characters. When enabled (`tokenAware: true`), the chunker targets 700 tokens per chunk with 120 tokens of overlap, using the `cl100k_base` tokenizer.

**ANN index**: An ANN (approximate nearest neighbor) index manifest is built per repo after embedding indexing. Currently backed by exact cosine scan over all embeddings; the interface is forward-compatible with native ANN backends (HNSW, etc.) for larger repos.

## MCP Server

DeepWiki includes an MCP server that exposes generated wikis to Claude Code and other MCP-compatible agents. This lets an AI agent query your project's wiki as context while working.

### Stdio mode (local dev)

```bash
# Using the justfile
just mcp-add

# Or manually
claude mcp add deepwiki -s user -- bun /path/to/deepwiki-by-cc/src/mcp/server.ts
```

### HTTP mode (Docker / network access)

When running in Docker, the MCP server starts automatically in HTTP mode on port 3001:

```bash
# Test the endpoint
curl http://localhost:3001/health

# The MCP endpoint is at /mcp (Streamable HTTP transport)
```

You can also run HTTP mode locally:

```bash
bun run mcp:http   # starts on port 3001 (override with MCP_PORT)
```

### Available tools

| Tool | Description |
|------|-------------|
| `list_wikis` | List all wikis with their section/page outlines |
| `get_wiki_page` | Get the full markdown content of a single page |
| `get_section_pages` | Get all pages in a section at once |
| `search_wiki` | Keyword search across wiki content |
| `search_wiki_semantic` | Semantic (embedding-based) search with lexical fallback |

## Self-Hosting with Docker

```bash
git clone https://github.com/andyhtran/deepwiki-by-cc.git
cd deepwiki-by-cc
docker compose up -d
```

The web UI is served on port 8080 and the MCP HTTP server on port 3001.

### Authenticate Claude CLI (one-time)

The app uses model CLIs under the hood (Claude and optional Codex). Log in once inside the container — credentials are persisted in a Docker volume so you won't need to do this again.

```bash
docker compose exec deepwiki claude login
```

Follow the prompts to authenticate. Then verify it worked:

```bash
docker compose exec deepwiki claude -p "say hello" --max-turns 1
```

If you get a response, DeepWiki is ready at [http://localhost:8080](http://localhost:8080).

If you plan to use the Codex model, authenticate that CLI once as well:

```bash
docker compose exec deepwiki codex login
```

### Private repositories (optional)

To generate wikis for private GitHub repos, create a `.env.docker` file:

```bash
GH_TOKEN=ghp_...
```

Then restart:

```bash
docker compose up -d
```

### Resource usage

| | Size |
|---|---|
| Docker image | ~850 MB (includes Node.js, Git, GitHub CLI, Claude CLI, Codex CLI) |
| Memory at idle | ~30 MB |
| Memory during generation | ~100–200 MB (varies with repo size and page concurrency) |

### Rebuilding after updates

```bash
git pull
docker compose up -d --build
```

## Development

```bash
bun run dev       # Start dev server
bun test          # Run tests
bun run lint      # Lint (Biome)
bun run check     # Type check
bun run build     # Production build
bun run start     # Start production server (port 8080)
```

## Tech Stack

- **Frontend**: SvelteKit 5, Mermaid, highlight.js
- **Backend**: SvelteKit server routes, SQLite (better-sqlite3), background job queue
- **AI**: Claude CLI and Codex CLI (subprocess with streaming JSON output)
- **MCP**: `@modelcontextprotocol/sdk` with stdio and Streamable HTTP transports

## License

[MIT](LICENSE)
