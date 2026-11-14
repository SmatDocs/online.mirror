#!/usr/bin/env bash
# Isolated experimental build. Run inside the capped container, never an API host.
set -euo pipefail
TASK_WORK=/work
TASK_RECIPE=/recipe
TASK_PHASE=packages
task_status() {
    local task_rc=$?
    python3 - "$TASK_WORK/status.json" "$TASK_PHASE" "$task_rc" <<'PY'
import datetime, json, pathlib, sys
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({'phase': sys.argv[2], 'exitCode': int(sys.argv[3]),
    'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2) + '\n')
PY
}
trap task_status EXIT
retry() {
    local attempt
    for attempt in 1 2 3; do
        if "$@"; then return 0; fi
        if [ "$attempt" -lt 3 ]; then sleep "$((attempt * 2))"; fi
    done
    return 1
}
export DEBIAN_FRONTEND=noninteractive
retry timeout 10m apt-get -o Acquire::Retries=2 update -q
retry timeout 20m apt-get -o Acquire::Retries=2 install -y -q --no-install-recommends \
    build-essential autoconf automake bison ccache flex gettext gperf libtool \
    pkg-config nasm cmake ninja-build git curl ca-certificates python3 python3-dev \
    nodejs zip unzip xz-utils bzip2 file libarchive-zip-perl libfont-ttf-perl \
    libxml-parser-perl libxml2-utils xsltproc libxml2-dev libxslt1-dev libnss3-dev \
    libssl-dev libfontconfig-dev libfreetype-dev zlib1g-dev uuid-dev libcups2-dev \
    libkrb5-dev libxrandr-dev
TASK_PHASE=build-user
if ! id wasm-builder >/dev/null 2>&1; then useradd --uid 10001 --create-home wasm-builder; fi
chown wasm-builder:wasm-builder "$TASK_WORK"
TASK_PHASE=compile
runuser -u wasm-builder -- bash "$TASK_RECIPE/compile-writer.sh"
TASK_PHASE=complete
