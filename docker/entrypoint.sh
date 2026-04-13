#!/bin/bash
set -e

# Seed default Claude settings if none exist in the volume
if [ ! -f "$HOME/.claude/settings.json" ]; then
  mkdir -p "$HOME/.claude"
  cp /opt/claude-defaults/settings.json "$HOME/.claude/settings.json"
fi

exec "$@"
