#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

# Runtime checks never change the machine unless the operator explicitly passes
# --install-dependencies. Garmin credentials remain in Garmin's native window.
if [[ "${1:-}" == '--check' ]]; then
  shift
  exec node "$workspace_dir/scripts/setup-sdk-manager.mjs" --data-dir "$workspace_dir/data" --check "$@"
fi
exec node "$workspace_dir/scripts/setup-sdk-manager.mjs" --data-dir "$workspace_dir/data" --launch "$@"
