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

# Trae ACP reaches both public model endpoints and ByteDance internal services.
# Keep these direct-route defaults in the launcher so detached service processes
# cannot accidentally inherit only one shell-specific proxy spelling.
TRAE_NO_PROXY_DEFAULTS=(
  localhost
  127.0.0.1
  byted.org
  bytedance.net
  trae.com.cn
  byteintl.net
  copilot-cn.bytedance.net
)

append_no_proxy_rule() {
  local current="$1" candidate="$2" entry trimmed
  local -a entries=()
  local IFS=','
  read -r -a entries <<< "$current"
  for entry in "${entries[@]}"; do
    trimmed="${entry#"${entry%%[![:space:]]*}"}"
    trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"
    [[ "$trimmed" == "$candidate" ]] && { printf '%s' "$current"; return; }
  done
  [[ -z "$current" ]] && { printf '%s' "$candidate"; return; }
  printf '%s,%s' "$current" "$candidate"
}

normalise_no_proxy_environment() {
  # A few Node and CLI stacks consult only one casing. Merge both inputs, then
  # export both spellings with the same value so CodyWork and its ACP children
  # follow one deterministic direct-routing policy.
  local merged='' source rule
  local -a rules=()
  for source in "${no_proxy:-}" "${NO_PROXY:-}"; do
    local IFS=','
    read -r -a rules <<< "$source"
    for rule in "${rules[@]}"; do
      rule="${rule#"${rule%%[![:space:]]*}"}"
      rule="${rule%"${rule##*[![:space:]]}"}"
      [[ -n "$rule" ]] && merged="$(append_no_proxy_rule "$merged" "$rule")"
    done
  done
  for rule in "${TRAE_NO_PROXY_DEFAULTS[@]}"; do
    merged="$(append_no_proxy_rule "$merged" "$rule")"
  done
  export no_proxy="$merged"
  export NO_PROXY="$merged"

  local rule_count=0
  local IFS=','
  read -r -a rules <<< "$merged"
  rule_count="${#rules[@]}"
  # Do not print proxy URLs or host values: operators only need to know that
  # the detached process received a normalized direct-routing rule set.
  echo "CodyWork NO_PROXY rules active: $rule_count"
}

load_network_environment() {
  # CodyWork's App Server runs as a detached process, so it cannot rely on an
  # interactive shell having exported the corporate proxy variables. Read only
  # the small allowlist needed for outbound model/tool traffic from a local
  # runtime file. Do not `source` it: the file is configuration, not code.
  local environment_file="${CODYWORK_NETWORK_ENV_FILE:-$RUNTIME_DIR/codywork.network.env}"
  if [[ -r "$environment_file" ]]; then
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
  fi
  normalise_no_proxy_environment
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
      CODYWORK_HOST|CODYWORK_PORT|CODYWORK_PASSWORD|CODYWORK_PUBLIC_ORIGIN|CODYWORK_DB|CODYWORK_AI_REPORT_USER_HOME|CODYWORK_CODEX_HOME|CODYWORK_AI_REPORT_HOME|CODYWORK_TRAE_AI_REPORT_HOME|CODYWORK_AI_REPORT_EXPORT_BIN|CODYWORK_AI_REPORT_OUTBOX_BIN)
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
  local pid command requested_host requested_port health_host
  # A deployment may provide a checked local service.env, while an operator
  # still needs a one-off host/port/database override for an isolated worktree.
  # Capture explicit process settings before loading that file so it cannot
  # accidentally take over another checkout's listener or workspace registry.
  requested_host="${CODYWORK_HOST:-}"
  requested_port="${CODYWORK_PORT:-}"
  requested_db="${CODYWORK_DB:-}"
  load_service_environment
  HOST="${requested_host:-${CODYWORK_HOST:-$HOST}}"
  PORT="${requested_port:-${CODYWORK_PORT:-$PORT}}"
  [[ -n "$requested_db" ]] && export CODYWORK_DB="$requested_db"
  health_host="$HOST"
  [[ "$health_host" == '0.0.0.0' || "$health_host" == '::' ]] && health_host='127.0.0.1'
  if pid="$(read_pid 2>/dev/null)" && is_our_process "$pid"; then
    echo "CodyWork is already running (PID $pid)."
    return 0
  fi
  local port_in_use=false
  if command -v ss >/dev/null 2>&1; then
    ss -lnt | grep -Eq ":${PORT}[[:space:]]" && port_in_use=true
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 && port_in_use=true
  fi
  if [[ "$port_in_use" == true ]]; then
    echo "Port $PORT is already in use; refusing to start CodyWork." >&2
    return 1
  fi
  rm -f "$PID_FILE"
  echo "Starting CodyWork on $HOST:$PORT from $PROJECT_DIR..."
  (
    cd "$PROJECT_DIR"
    load_network_environment
    export CODY_SERVICE_ID="${CODY_SERVICE_ID:-codywork}"
    if command -v setsid >/dev/null 2>&1; then
      nohup setsid node "$ENTRYPOINT" --host "$HOST" --port "$PORT" >> "$LOG_FILE" 2>&1 < /dev/null &
    else
      # macOS does not ship `setsid`. The PID remains individually owned and
      # stop_owned_process deliberately falls back to signalling just it.
      nohup node "$ENTRYPOINT" --host "$HOST" --port "$PORT" >> "$LOG_FILE" 2>&1 < /dev/null &
    fi
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
    # A service bound to one development-machine address is not reachable
    # through loopback. Probe that exact address while retaining loopback for
    # wildcard binds.
    local health_host="$HOST"
    [[ "$health_host" == '0.0.0.0' || "$health_host" == '::' ]] && health_host='127.0.0.1'
    if node -e "const net=require('node:net');const socket=net.createConnection({host:'$health_host',port:$PORT});socket.setTimeout(1000);socket.once('connect',()=>{socket.end();process.exit(0)});socket.once('error',()=>process.exit(1));socket.once('timeout',()=>process.exit(1))"; then
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
  local pid requested_host requested_port
  requested_host="${CODYWORK_HOST:-}"
  requested_port="${CODYWORK_PORT:-}"
  load_service_environment
  HOST="${requested_host:-${CODYWORK_HOST:-$HOST}}"
  PORT="${requested_port:-${CODYWORK_PORT:-$PORT}}"
  if pid="$(read_pid 2>/dev/null)" && is_our_process "$pid"; then
    echo "running pid=$pid cwd=$(process_cwd "$pid") url=http://$HOST:$PORT log=$LOG_FILE"
    return 0
  fi
  echo 'stopped'
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-status}" in
    start) start_service ;;
    stop) stop_service ;;
    restart) stop_service; start_service ;;
    status) status_service ;;
    logs) touch "$LOG_FILE"; tail -n "${CODYWORK_LOG_LINES:-100}" -f "$LOG_FILE" ;;
    *) echo 'Usage: codywork-service.sh {start|stop|restart|status|logs}' >&2; exit 2 ;;
  esac
fi
