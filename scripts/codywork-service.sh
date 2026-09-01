#!/usr/bin/env bash
set -euo pipefail

# CodyWork keeps its local Workspace registry relative to the project working
# directory. Always launch from PROJECT_DIR: invoking node through an absolute
# script path alone silently creates a second, empty registry in the caller's
# cwd after SSH deployment.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${CODYWORK_RUNTIME_DIR:-$PROJECT_DIR/.runtime}"
PID_FILE="$RUNTIME_DIR/server.pid"
LOG_FILE="${CODYWORK_LOG_FILE:-$RUNTIME_DIR/server.log}"
HOST="${CODYWORK_HOST:-0.0.0.0}"
PORT="${CODYWORK_PORT:-3001}"
ENTRYPOINT="$PROJECT_DIR/apps/workbench-server/dist/index.js"
mkdir -p "$RUNTIME_DIR"

read_pid() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(tr -dc '0-9' < "$PID_FILE")"
  [[ -n "$pid" ]] || return 1
  printf '%s' "$pid"
}

process_cwd() {
  local pid="$1"
  [[ -L "/proc/$pid/cwd" ]] && readlink "/proc/$pid/cwd" 2>/dev/null || true
}

is_our_process() {
  local pid="$1" command cwd
  kill -0 "$pid" 2>/dev/null || return 1
  command="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  [[ "$command" == *"node"* && "$command" == *"apps/workbench-server/dist/index.js"* ]] || return 1
  [[ "$command" == *"$ENTRYPOINT"* ]] && return 0
  cwd="$(process_cwd "$pid")"
  [[ "$cwd" == "$PROJECT_DIR" ]]
}

stop_service() {
  local pid
  if ! pid="$(read_pid 2>/dev/null)" || ! is_our_process "$pid"; then
    echo 'CodyWork is not running from this project.'
    rm -f "$PID_FILE"
    return 0
  fi
  echo "Stopping CodyWork (PID $pid)..."
  kill -TERM "$pid"
  for _ in {1..50}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "CodyWork did not stop gracefully; sending SIGKILL to PID $pid."
    kill -KILL "$pid"
  fi
  rm -f "$PID_FILE"
}

start_service() {
  local pid command
  if pid="$(read_pid 2>/dev/null)" && is_our_process "$pid"; then
    echo "CodyWork is already running (PID $pid)."
    return 0
  fi
  if ss -lnt | grep -Eq ":${PORT}[[:space:]]"; then
    echo "Port $PORT is already in use; refusing to start CodyWork." >&2
    return 1
  fi
  rm -f "$PID_FILE"
  echo "Starting CodyWork on $HOST:$PORT from $PROJECT_DIR..."
  (
    cd "$PROJECT_DIR"
    nohup setsid node "$ENTRYPOINT" --host "$HOST" --port "$PORT" >> "$LOG_FILE" 2>&1 < /dev/null &
    printf '%s\n' "$!" > "$PID_FILE"
  )
  pid="$(read_pid)"
  for _ in {1..50}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      echo "CodyWork exited during startup. See $LOG_FILE" >&2
      tail -n 30 "$LOG_FILE" >&2 || true
      rm -f "$PID_FILE"
      return 1
    fi
    if node -e "fetch('http://127.0.0.1:$PORT/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"; then
      echo "CodyWork is running (PID $pid). Log: $LOG_FILE"
      return 0
    fi
    sleep 0.2
  done
  echo "CodyWork process is running but did not become ready. See $LOG_FILE" >&2
  return 1
}

status_service() {
  local pid
  if pid="$(read_pid 2>/dev/null)" && is_our_process "$pid"; then
    echo "running pid=$pid cwd=$(process_cwd "$pid") url=http://$HOST:$PORT log=$LOG_FILE"
    return 0
  fi
  echo 'stopped'
  return 1
}

case "${1:-status}" in
  start) start_service ;;
  stop) stop_service ;;
  restart) stop_service; start_service ;;
  status) status_service ;;
  logs) touch "$LOG_FILE"; tail -n "${CODYWORK_LOG_LINES:-100}" -f "$LOG_FILE" ;;
  *) echo 'Usage: codywork-service.sh {start|stop|restart|status|logs}' >&2; exit 2 ;;
esac
