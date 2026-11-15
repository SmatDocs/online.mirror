#!/usr/bin/env bash
# A separate incremental artifact; preserve the completed Writer-only baseline.
set -euo pipefail
TASK_WORK=/work
TASK_RECIPE=/recipe
task_status() {
    local task_rc=$?
    python3 - "$TASK_WORK/full-fonts-status.json" "$task_rc" <<'PY'
import datetime, json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'exitCode': int(sys.argv[2]),
    'finishedUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2) + '\n')
PY
}
trap task_status EXIT
stage() {
    python3 - "$TASK_WORK/full-fonts-progress.json" "$1" <<'PY'
import datetime, json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'phase': sys.argv[2],
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2) + '\n')
PY
}
export CCACHE_DIR="$TASK_WORK/ccache"
export CCACHE_MAXSIZE=1G
export CCACHE_COMPRESS=1
source "$TASK_WORK/sdk/emsdk_env.sh"
cd "$TASK_WORK/core"
test "$(git rev-parse HEAD)" = 7528c0d406012e10c6ce34c3f24bf277302ec695
test -f "$TASK_WORK/manifest.json"
test -f "$TASK_WORK/packed/soffice.wasm"
test ! -e "$TASK_WORK/packed-full-fonts"
stage source
git apply --check "$TASK_RECIPE/portable-font-registration.patch"
git apply "$TASK_RECIPE/portable-font-registration.patch"
git diff --check
cp autogen.input "$TASK_WORK/writer-only-autogen.input"
sed -e 's/^--with-wasm-module=.*/--with-wasm-module=calc writer impress/' \
    -e 's/^--with-parallelism=.*/--with-parallelism=4/' \
    "$TASK_RECIPE/reference-build/autogen.input" > autogen.input
printf '%s\n' "--with-external-tar=$TASK_WORK/tarballs" >> autogen.input
stage configure
timeout 30m ./autogen.sh > "$TASK_WORK/configure-full-fonts.log" 2>&1
grep -q '^export ENABLE_WASM_STRIP_BASIC_DRAW_MATH_IMPRESS=$' config_host.mk
grep -q '^export ENABLE_WASM_STRIP_CALC=$' config_host.mk
stage make
timeout --kill-after=30s 10h nice -n 19 make -j4 > "$TASK_WORK/make-full-fonts.log" 2>&1
stage make-again
timeout --kill-after=30s 1h nice -n 19 make -j4 >> "$TASK_WORK/make-full-fonts.log" 2>&1
stage pack
mkdir -p "$TASK_WORK/raw-full-fonts" "$TASK_WORK/packed-full-fonts"
for task_file in soffice.js soffice.wasm soffice.data soffice.data.js.metadata; do
    cp "instdir/program/$task_file" "$TASK_WORK/raw-full-fonts/$task_file"
done
timeout 20m bash "$TASK_RECIPE/reference-build/pack.sh" instdir/program "$TASK_WORK/packed-full-fonts" \
    > "$TASK_WORK/pack-full-fonts.log" 2>&1
python3 "$TASK_RECIPE/manifest.py" "$TASK_WORK" "$TASK_RECIPE" full-fonts
stage complete
