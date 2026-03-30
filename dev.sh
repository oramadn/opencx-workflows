#!/usr/bin/env bash
set -euo pipefail

SESSION="workflows"
ROOT="$(cd "$(dirname "$0")" && pwd)"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "tmux session '$SESSION' already exists — attaching."
  exec tmux attach -t "$SESSION"
fi

# 1: shell — empty terminal at project root
tmux new-session -d -s "$SESSION" -c "$ROOT" -n shell

# 2: docker — just start; avoids tearing down the volume
tmux new-window -t "$SESSION" -n docker -c "$ROOT"
tmux send-keys -t "$SESSION:docker" "docker compose up" Enter

# 3: backend
tmux new-window -t "$SESSION" -n backend -c "$ROOT"
tmux send-keys -t "$SESSION:backend" "pnpm backend:dev" Enter

# 4: frontend
tmux new-window -t "$SESSION" -n frontend -c "$ROOT"
tmux send-keys -t "$SESSION:frontend" "pnpm frontend" Enter

# 5: ngrok — kill any existing agent before starting
tmux new-window -t "$SESSION" -n ngrok -c "$ROOT"
tmux send-keys -t "$SESSION:ngrok" "pkill -f 'ngrok http' 2>/dev/null; sleep 1; ngrok http 3001" Enter

# 6: psql
tmux new-window -t "$SESSION" -n psql -c "$ROOT"
tmux send-keys -t "$SESSION:psql" "psql postgresql://postgres:12345@localhost:5432/workflows" Enter

tmux select-window -t "$SESSION:shell"
exec tmux attach -t "$SESSION"
