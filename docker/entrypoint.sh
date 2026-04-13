#!/bin/bash
set -e

# Seed default Claude settings if none exist in the volume
if [ ! -f "$HOME/.claude/settings.json" ]; then
  mkdir -p "$HOME/.claude"
  cp /opt/claude-defaults/settings.json "$HOME/.claude/settings.json"
fi

# Start MCP HTTP server in the background if enabled
if [ "${MCP_HTTP:-false}" = "true" ]; then
    DB_PATH="$HOME/app/data/deepwiki.db" node build/mcp/server.js &
fi

exec "$@"
