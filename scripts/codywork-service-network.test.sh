#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SCRIPT="$SCRIPT_DIR/codywork-service.sh"
TEST_RUNTIME_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_RUNTIME_DIR"' EXIT

assert_contains() {
  local value="$1" expected="$2"
  [[ ",$value," == *",$expected,"* ]] || {
    echo "expected NO_PROXY to contain $expected" >&2
    exit 1
  }
}

# The service script can be sourced for this focused test without invoking a
# lifecycle action. Start from the historical lower-case setting and confirm
# both spellings are normalized for the detached Node/ACP process tree.
export CODYWORK_RUNTIME_DIR="$TEST_RUNTIME_DIR"
export no_proxy='.byted.org'
unset NO_PROXY
source "$SERVICE_SCRIPT"
load_network_environment >/dev/null

[[ "$no_proxy" == "$NO_PROXY" ]] || { echo 'NO_PROXY aliases diverged' >&2; exit 1; }
for host in localhost 127.0.0.1 byted.org bytedance.net trae.com.cn byteintl.net copilot-cn.bytedance.net; do
  assert_contains "$NO_PROXY" "$host"
done

# An operator rule from the controlled data-only file must survive the merge.
printf 'NO_PROXY=operator.internal\n' > "$TEST_RUNTIME_DIR/codywork.network.env"
unset no_proxy NO_PROXY
load_network_environment >/dev/null
assert_contains "$NO_PROXY" 'operator.internal'
[[ "$no_proxy" == "$NO_PROXY" ]] || { echo 'file-based NO_PROXY aliases diverged' >&2; exit 1; }
