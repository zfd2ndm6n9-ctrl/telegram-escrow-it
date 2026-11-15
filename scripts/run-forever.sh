#!/usr/bin/env bash
# Riavvio automatico del bot in long-polling (utile su VM/agent o VPS).
# Uso: TELEGRAM_BOT_TOKEN=... ./scripts/run-forever.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "Manca TELEGRAM_BOT_TOKEN" >&2
  exit 1
fi

export NODE_ENV="${NODE_ENV:-production}"
export PORT="${PORT:-8080}"
export DATA_DIR="${DATA_DIR:-data}"

if [[ ! -f dist/index.js ]]; then
  npm ci
  npm run build
fi

backoff=1
while true; do
  echo "[run-forever] avvio $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  node dist/index.js
  code=$?
  set -e
  echo "[run-forever] exit=$code — restart tra ${backoff}s" >&2
  sleep "$backoff"
  if (( backoff < 60 )); then
    backoff=$((backoff * 2))
  fi
done
