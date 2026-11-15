#!/usr/bin/env bash
set -euo pipefail
cd /work
exec > >(tee -a /work/build.log) 2>&1
trap 'code=$?; printf "exit=%s finished=%s\n" "$code" "$(date -u +%FT%TZ)" > /work/build-status.txt' EXIT
printf 'started=%s\n' "$(date -u +%FT%TZ)" > /work/build-status.txt
sha256sum source.tar.gz source-support.tar.gz /recipe/bootstrap.sh /recipe/build.sh | tee source.sha256
mkdir -p source tarballs artifacts
tar -xzf source.tar.gz -C source
tar -xzf source-support.tar.gz -C source
test -f source/engine/configure.ac
test ! -e source/.env
cp /work/source-revision.txt source/dist_git_hash
cp /work/source-revision.txt source/engine/dist_git_hash
export CCACHE_DIR=/work/ccache
export CCACHE_MAXSIZE=2G
export CCACHE_COMPRESS=1
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
export TZ=UTC
cd /work/source/engine
./autogen.sh --with-distro=CPLinux-LOKit --without-package-format \
    --with-parallelism=4 --disable-symbols --with-lang=en-US --with-external-tar=/work/tarballs
make -j4 build
printf 'core-built=%s\n' "$(date -u +%FT%TZ)" >> /work/build-status.txt
# Record a focused real-core check; retain the build even if its test fails.
set +e
timeout --kill-after=30s 30m make -j4 CppunitTest_sw_vector_rendering > /work/writer-vector-test.log 2>&1
test_code=$?
set -e
printf 'writer-vector-test-exit=%s\n' "$test_code" >> /work/build-status.txt
cd /work/source
./autogen.sh
./configure --enable-silent-rules --disable-debug --disable-branding \
    --with-lokit-path=/work/source/engine/include --with-lo-path=/work/source/engine/instdir
make -j4
printf 'online-built=%s\n' "$(date -u +%FT%TZ)" >> /work/build-status.txt
du -sh /work/source/engine/instdir /work/source/engine/workdir /work/tarballs /work/ccache > /work/footprint.txt
tar --dereference -czf /work/artifacts/writer-native.tar.gz \
    engine/instdir coolwsd coolforkit-ns coolforkit-caps coolmount browser/dist \
    discovery.xml coolwsd.xml config.h
cd /work/artifacts
sha256sum writer-native.tar.gz > SHA256SUMS
