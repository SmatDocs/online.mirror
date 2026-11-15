#!/usr/bin/env bash
# Experimental build container only. Never run on an application host directly.
set -euo pipefail
test -f /.dockerenv
export DEBIAN_FRONTEND=noninteractive
apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=60 update
apt-get -o Acquire::Retries=2 -o Acquire::http::Timeout=60 install -y --no-install-recommends \
    build-essential autoconf automake libtool pkg-config git zip unzip wget curl \
    gperf nasm bison flex ccache meson ninja-build cmake patch gettext \
    python3 python3-dev python3-polib python3-lxml default-jdk ant ant-optional \
    graphviz libkrb5-dev libnss3-dev libcups2-dev libfontconfig1-dev \
    libxslt1-dev xsltproc libxml2-utils libx11-dev libxrandr-dev libxinerama-dev \
    libxt-dev libgtk-3-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev \
    libavahi-client-dev libpoco-dev libcppunit-dev libpng-dev libcap-dev \
    libpam0g-dev libzstd-dev libssl-dev chrpath nodejs npm gosu
dpkg-query -W > /work/packages.tsv
groupadd --gid 10001 builder
useradd --uid 10001 --gid 10001 --create-home builder
chown 10001:10001 /work /work/packages.tsv
# The upload is atomic; never unpack an incomplete source stream.
timeout 1h bash -c 'until test -f /work/source.tar.gz; do sleep 5; done'
exec gosu builder bash /recipe/build.sh
