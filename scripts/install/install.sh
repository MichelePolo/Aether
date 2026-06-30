#!/usr/bin/env sh
# Aether installer (macOS / Linux). Usage:
#   curl -fsSL https://raw.githubusercontent.com/MichelePolo/Aether/main/scripts/install/install.sh | bash
set -e

REPO="github:MichelePolo/Aether#semver:*"
MIN_NODE=20

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

# 2. Install globally from the latest release tag
echo "Installing Aether (${REPO}) ..."
npm install -g "$REPO"

# 3. Start the daemon and open the browser
echo "Starting Aether ..."
aether daemon start --open
