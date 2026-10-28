#!/bin/sh
set -eu

VAULT_PATH="${VAULT_PATH:-/vault}"
PORT="${PORT:-8000}"
MCP_PATH="${MCP_PATH:-/mcp}"
SESSION_TIMEOUT="${SESSION_TIMEOUT:-60000}"
LOG_LEVEL="${LOG_LEVEL:-info}"

case "$PORT" in
  ''|*[!0-9]*)
    echo "PORT must be a number, got: $PORT" >&2
    exit 1
    ;;
esac

case "$SESSION_TIMEOUT" in
  ''|*[!0-9]*)
    echo "SESSION_TIMEOUT must be a number, got: $SESSION_TIMEOUT" >&2
    exit 1
    ;;
esac

case "$MCP_PATH" in
  /*) ;;
  *) MCP_PATH="/$MCP_PATH" ;;
esac

if [ ! -d "$VAULT_PATH" ]; then
  echo "Vault path does not exist or is not a directory: $VAULT_PATH" >&2
  echo "Mount your Obsidian vault into the container, for example: -v /volume1/Notes/Vault:/vault:rw" >&2
  exit 1
fi

echo "Starting MCPVault gateway on port $PORT at $MCP_PATH"
echo "Vault path: $VAULT_PATH"

exec supergateway \
  --stdio "node /app/docker/mcpvault-stdio.mjs" \
  --outputTransport streamableHttp \
  --stateful \
  --sessionTimeout "$SESSION_TIMEOUT" \
  --port "$PORT" \
  --streamableHttpPath "$MCP_PATH" \
  --healthEndpoint /healthz \
  --healthCheck server \
  --logLevel "$LOG_LEVEL" \
  "$@"
