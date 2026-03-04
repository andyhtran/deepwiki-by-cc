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

# Register deepwiki MCP server globally in Claude Code
[group('mcp')]
mcp-add:
    claude mcp add deepwiki -s user -- bun {{justfile_directory()}}/src/mcp/server.ts

# Remove deepwiki MCP server from Claude Code
[group('mcp')]
mcp-remove:
    claude mcp remove deepwiki -s user
