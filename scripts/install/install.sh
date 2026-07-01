#!/usr/bin/env sh
# Aether installer (macOS / Linux). Usage:
#   curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash
set -e

TARBALL="https://github.com/MichelePolo/Aether/releases/latest/download/aether-core.tgz"
MIN_NODE=22

err() { printf 'aether-install: %s\n' "$1" >&2; }

# 1. Node check
if ! command -v node >/dev/null 2>&1; then
  err "Node.js >= ${MIN_NODE} is required but was not found."
  err "Install it from https://nodejs.org (or: brew install node / your distro's package manager), then re-run."
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$NODE_MAJOR" -lt "$MIN_NODE" ]; then
  err "Node.js >= ${MIN_NODE} required, found $(node -v)."
  exit 1
fi

# 2. Install the latest prebuilt release tarball (no build on the client)
echo "Installing Aether ..."
npm install -g "$TARBALL"

# 3. Start the daemon and open the browser
echo "Starting Aether ..."
aether daemon start --open
