#!/usr/bin/env bash
# Resume only the already-configured isolated experiment; retain completed objects.
set -euo pipefail
test -f /.dockerenv
test "$(head -n 1 /work/source-revision.txt)" = d5d43ba0a1e0215c38da101a41d523d199374794
test -f /work/source/engine/config_host.mk
cd /work
exec > >(tee -a /work/build.log) 2>&1
trap 'code=$?; printf "exit=%s finished=%s\n" "$code" "$(date -u +%FT%TZ)" >> /work/build-status.txt' EXIT
printf 'resumed=%s reason=host-load-gate\n' "$(date -u +%FT%TZ)" > /work/build-status.txt
sha256sum /recipe/resume-native.sh >> /work/source.sha256
export CCACHE_DIR=/work/ccache CCACHE_MAXSIZE=2G CCACHE_COMPRESS=1
export LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC
cd /work/source/engine
# The host load includes unrelated containers. The Docker cgroup already enforces
# four CPUs and low shares; do not let make's host-wide -l12 serialize this job.
make -j4 build LOADLIMIT=
printf 'core-built=%s\n' "$(date -u +%FT%TZ)" >> /work/build-status.txt
for module in sw sd; do
    set +e
    timeout --kill-after=30s 30m make -j4 "CppunitTest_${module}_vector_rendering" LOADLIMIT= \
        > "/work/${module}-vector-test.log" 2>&1
    test_code=$?
    set -e
    printf '%s-vector-test-exit=%s\n' "$module" "$test_code" >> /work/build-status.txt
done
cp /work/sw-vector-test.log /work/writer-vector-test.log
cd /work/source
./autogen.sh
./configure --enable-silent-rules --disable-debug --disable-branding \
    --with-lokit-path=/work/source/engine/include --with-lo-path=/work/source/engine/instdir
make -j4
printf 'online-built=%s\n' "$(date -u +%FT%TZ)" >> /work/build-status.txt
du -sh engine/instdir engine/workdir /work/tarballs /work/ccache > /work/footprint.txt
artifact_paths=(engine/instdir coolwsd coolforkit-ns coolforkit-caps coolmount browser/dist discovery.xml coolwsd.xml config.h)
if test -d engine/workdir/VectorRenderingReference; then
    artifact_paths+=(engine/workdir/VectorRenderingReference)
fi
tar --dereference -czf /work/artifacts/writer-native.tar.gz "${artifact_paths[@]}"
cd /work/artifacts
sha256sum writer-native.tar.gz > SHA256SUMS
