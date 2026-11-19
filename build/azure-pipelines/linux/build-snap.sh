#!/usr/bin/env bash
set -e

snapcraft --version

sudo sh -c 'echo "Acquire::Retries \"5\";" > /etc/apt/apt.conf.d/80-retries'

for src in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$src" ] || continue
  sudo sed -i \
    -e 's|http://archive.ubuntu.com|http://azure.archive.ubuntu.com|g' \
    -e 's|http://ports.ubuntu.com|http://azure.ports.ubuntu.com|g' \
    "$src"
done

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get install -y curl apt-transport-https ca-certificates

SNAP_ROOT="$(pwd)/.build/linux/snap/$VSCODE_ARCH"

BUILD_VERSION="$(date +%s)"
SNAP_FILENAME="code-$VSCODE_QUALITY-$VSCODE_ARCH-$BUILD_VERSION.snap"
SNAP_PATH="$SNAP_ROOT/$SNAP_FILENAME"
case $VSCODE_ARCH in
  x64) SNAPCRAFT_TARGET_ARGS="" ;;
  *) SNAPCRAFT_TARGET_ARGS="--target-arch $VSCODE_ARCH" ;;
esac
(cd $SNAP_ROOT/code-* && sudo --preserve-env snapcraft snap $SNAPCRAFT_TARGET_ARGS --output "$SNAP_PATH")
