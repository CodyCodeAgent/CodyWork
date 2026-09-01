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

load_network_environment() {
  # CodyWork's App Server runs as a detached process, so it cannot rely on an
  # interactive shell having exported the corporate proxy variables. Read only
  # the small allowlist needed for outbound model/tool traffic from a local
  # runtime file. Do not `source` it: the file is configuration, not code.
  local environment_file="${CODYWORK_NETWORK_ENV_FILE:-$RUNTIME_DIR/codywork.network.env}"
  [[ -r "$environment_file" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    if [[ "$line" != *=* ]]; then
      echo "Ignoring malformed CodyWork network setting in $environment_file" >&2
      continue
    fi
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|http_proxy|https_proxy|all_proxy|no_proxy)
        export "$key=$value"
        ;;
      *)
        echo "Ignoring unsupported CodyWork network setting: $key" >&2
        ;;
    esac
  done < "$environment_file"
  echo "Loaded CodyWork network configuration from $environment_file"
}

load_service_environment() {
  # Password/host settings are data-only deployment configuration. Keep this
  # separate from proxy settings and never source it as shell code.
  local environment_file="${CODYWORK_SERVICE_ENV_FILE:-$RUNTIME_DIR/service.env}"
  [[ -r "$environment_file" ]] || return 0

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == export\ * ]] && line="${line#export }"
    if [[ "$line" != *=* ]]; then
      echo "Ignoring malformed CodyWork service setting in $environment_file" >&2
      continue
    fi
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      CODYWORK_HOST|CODYWORK_PORT|CODYWORK_PASSWORD)
        export "$key=$value"
        ;;
      *)
        echo "Ignoring unsupported CodyWork service setting: $key" >&2
        ;;
    esac
  done < "$environment_file"
  echo "Loaded CodyWork service configuration from $environment_file"
}

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

process_group_id() {
  local pid="$1"
  ps -p "$pid" -o pgid= 2>/dev/null | tr -d '[:space:]'
}

stop_owned_process() {
  local pid="$1" signal="$2" pgid
  pgid="$(process_group_id "$pid")"
  # setsid makes the service PID the leader of a private group. Only then is
  # it safe to signal the group and clean up its App Server child process.
  if [[ "$pgid" == "$pid" ]]; then
    kill "-$signal" -- "-$pgid"
  else
    kill "-$signal" "$pid"
  fi
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
  stop_owned_process "$pid" TERM
  for _ in {1..50}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "CodyWork did not stop gracefully; sending SIGKILL to its owned process group."
    stop_owned_process "$pid" KILL
  fi
  rm -f "$PID_FILE"
}

start_service() {
  local pid command
  load_service_environment
  HOST="${CODYWORK_HOST:-$HOST}"
  PORT="${CODYWORK_PORT:-$PORT}"
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
    load_network_environment
    export CODY_SERVICE_ID="${CODY_SERVICE_ID:-codywork}"
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
    if node -e "fetch('http://127.0.0.1:$PORT/api/health').then(async r=>{const body=await r.json();process.exit(r.ok&&body?.ok===true&&body?.data?.service==='codywork'?0:1)}).catch(()=>process.exit(1))"; then
      echo "CodyWork is running (PID $pid). Log: $LOG_FILE"
      return 0
    fi
    sleep 0.2
  done
  echo "CodyWork process is running but did not become ready. See $LOG_FILE" >&2
  stop_owned_process "$pid" TERM || true
  rm -f "$PID_FILE"
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
