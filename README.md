# DeepWiki

Generate comprehensive, navigable wikis for any GitHub repository or local codebase using Claude AI.

Point DeepWiki at a repo and it will clone it, scan the source files, generate a structured outline and per-page documentation with Mermaid diagrams, and serve the result as a browsable wiki — all in a few minutes.

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated (`claude` must be on your PATH)
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
2. **Generate outline** — sends the file tree and README to Claude, which returns a structured wiki outline with sections, pages, and file assignments.
3. **Generate pages** — each page is generated in parallel (configurable concurrency), with relevant source files injected as context. Mermaid diagrams are included where they help explain architecture or flow.
4. **Serve** — the wiki is stored in SQLite and served through a SvelteKit app with syntax highlighting, Mermaid rendering, a sidebar navigation tree, and a table of contents.

### Keeping wikis up to date

- **Sync** — pulls latest commits and selectively regenerates only the pages affected by the diff.
- **Resume** — if generation is interrupted or individual pages fail, resume picks up where it left off.
- **Regenerate** — full regeneration from scratch.

## Settings

Visit `/settings` in the UI to configure:

| Setting | Default | Options |
|---------|---------|---------|
| Model | Claude Sonnet 4.6 | Sonnet 4.6, Opus 4.6 |
| Parallel page limit | 2 | 1–5 |

## MCP Server

DeepWiki includes an MCP server that exposes generated wikis to Claude Code and other MCP-compatible agents. This lets an AI agent query your project's wiki as context while working.

### Register with Claude Code

```bash
# Using the justfile
just mcp-add

# Or manually
claude mcp add deepwiki -s user -- bun /path/to/deepwiki-by-cc/src/mcp/server.ts
```

### Available tools

| Tool | Description |
|------|-------------|
| `list_wikis` | List all wikis with their section/page outlines |
| `get_wiki_page` | Get the full markdown content of a single page |
| `get_section_pages` | Get all pages in a section at once |
| `search_wiki` | Keyword search across wiki content |

## Self-Hosting with Docker

```bash
git clone https://github.com/andyhtran/deepwiki-by-cc.git
cd deepwiki-by-cc
docker compose up -d
```

### Authenticate Claude CLI (one-time)

The app uses the Claude CLI under the hood. You need to log in once inside the container — credentials are persisted in a Docker volume so you won't need to do this again.

```bash
docker compose exec deepwiki claude login
```

Follow the prompts to authenticate. Then verify it worked:

```bash
docker compose exec deepwiki claude -p "say hello" --max-turns 1
```

If you get a response, DeepWiki is ready at [http://localhost:8080](http://localhost:8080).

### Private repositories (optional)

To generate wikis for private GitHub repos, create a `.env` file:

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
| Docker image | ~825 MB (includes Node.js, Git, GitHub CLI, Claude CLI) |
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
- **AI**: Claude CLI (subprocess with streaming JSON output)
- **MCP**: `@modelcontextprotocol/sdk` with stdio transport

## License

[MIT](LICENSE)
