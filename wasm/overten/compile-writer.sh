#!/usr/bin/env bash
# Exact upstream reference core/patches; Writer-only application selection.
set -euo pipefail
TASK_WORK=/work
TASK_RECIPE=/recipe
TASK_CORE=7528c0d406012e10c6ce34c3f24bf277302ec695
TASK_SDK=62a853cd3b3134398ce85cde8bb5cbb2ef0194cb
export CCACHE_DIR="$TASK_WORK/ccache"
export CCACHE_MAXSIZE=1G
export CCACHE_COMPRESS=1
retry() {
    local attempt
    for attempt in 1 2 3; do
        if "$@"; then return 0; fi
        if [ "$attempt" -lt 3 ]; then sleep "$((attempt * 2))"; fi
    done
    return 1
}
stage() {
    python3 - "$TASK_WORK/progress.json" "$1" <<'PY'
import datetime, json, pathlib, sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'phase': sys.argv[2],
    'utc': datetime.datetime.now(datetime.timezone.utc).isoformat()}, indent=2) + '\n')
PY
}
stage source
mkdir -p "$TASK_WORK/core" "$TASK_WORK/sdk" "$TASK_WORK/tarballs"
if [ ! -f "$TASK_WORK/source-prepared" ]; then
    git -C "$TASK_WORK/core" init -q
    retry timeout 30m git -C "$TASK_WORK/core" fetch --depth 1 https://github.com/LibreOffice/core.git "$TASK_CORE"
    git -C "$TASK_WORK/core" checkout --detach FETCH_HEAD
    test "$(git -C "$TASK_WORK/core" rev-parse HEAD)" = "$TASK_CORE"
    git -C "$TASK_WORK/core" apply "$TASK_RECIPE/reference-build/lo-source.patch"
    for task_patch in "$TASK_RECIPE"/reference-build/patches/*.patch; do
        git -C "$TASK_WORK/core" apply "$task_patch"
    done
    git -C "$TASK_WORK/core" diff --check
    touch "$TASK_WORK/source-prepared"
fi
stage toolchain
if [ ! -f "$TASK_WORK/sdk/emsdk" ]; then
    git -C "$TASK_WORK/sdk" init -q
    retry timeout 10m git -C "$TASK_WORK/sdk" fetch --depth 1 https://github.com/emscripten-core/emsdk.git "$TASK_SDK"
    git -C "$TASK_WORK/sdk" checkout --detach FETCH_HEAD
fi
test "$(git -C "$TASK_WORK/sdk" rev-parse HEAD)" = "$TASK_SDK"
retry timeout 30m "$TASK_WORK/sdk/emsdk" install 4.0.10
"$TASK_WORK/sdk/emsdk" activate 4.0.10
source "$TASK_WORK/sdk/emsdk_env.sh"
stage configure
sed -e 's/^--with-wasm-module=.*/--with-wasm-module=writer/' \
    -e 's/^--with-parallelism=.*/--with-parallelism=4/' \
    "$TASK_RECIPE/reference-build/autogen.input" > "$TASK_WORK/core/autogen.input"
printf '%s\n' "--with-external-tar=$TASK_WORK/tarballs" >> "$TASK_WORK/core/autogen.input"
cd "$TASK_WORK/core"
timeout 30m ./autogen.sh > "$TASK_WORK/configure.log" 2>&1
stage make
timeout --kill-after=30s 10h nice -n 19 make -j4 > "$TASK_WORK/make.log" 2>&1
# Upstream requires a second make to link against the current filesystem image.
stage make-again
timeout --kill-after=30s 1h nice -n 19 make -j4 >> "$TASK_WORK/make.log" 2>&1
stage pack
mkdir -p "$TASK_WORK/raw" "$TASK_WORK/packed"
for task_file in soffice.js soffice.wasm soffice.data soffice.data.js.metadata; do
    cp "instdir/program/$task_file" "$TASK_WORK/raw/$task_file"
done
timeout 20m bash "$TASK_RECIPE/reference-build/pack.sh" instdir/program "$TASK_WORK/packed" > "$TASK_WORK/pack.log" 2>&1
python3 "$TASK_RECIPE/manifest.py" "$TASK_WORK" "$TASK_RECIPE"
stage complete
