#!/usr/bin/env bash
# Install everything needed to build Overten's Collabora on Ubuntu 24.04:
# the LibreOffice core (engine/, distro config CPLinux-LOKit) and Collabora Online.
#
# Usage (one command, needs sudo):
#   bash scripts/deploy/install_build_deps.sh
#
# Safe to run again: apt skips packages that are already installed.
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi

# Core (engine/) build tools and libraries. Verified on 2026-11-10: configure with
# --with-distro=CPLinux-LOKit stopped on gperf and then meson/ninja until these were present.
CORE_PACKAGES=(
  build-essential autoconf automake libtool pkg-config git zip unzip wget
  gperf nasm bison flex ccache meson ninja-build
  python3 python3-dev
  junit4 default-jdk ant ant-optional graphviz
  libkrb5-dev libnss3-dev libcups2-dev libfontconfig1-dev
  libxslt1-dev xsltproc libxml2-utils
  libx11-dev libxrandr-dev libxinerama-dev libxt-dev libgtk-3-dev
  libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev libavahi-client-dev
)

# Collabora Online (coolwsd + browser) build and runtime.
ONLINE_PACKAGES=(
  libpoco-dev libcppunit-dev libpng-dev libcap-dev libpam0g-dev libzstd-dev
  libssl-dev chrpath python3-polib python3-lxml nodejs npm
)

echo "[deps] Installing ${#CORE_PACKAGES[@]} core and ${#ONLINE_PACKAGES[@]} Online packages"
$SUDO apt-get update
$SUDO apt-get install -y "${CORE_PACKAGES[@]}" "${ONLINE_PACKAGES[@]}"
echo "[deps] Done. Configure the core with:"
echo "  cd engine && ./autogen.sh --with-distro=CPLinux-LOKit --without-package-format"
