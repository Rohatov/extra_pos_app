#!/usr/bin/env bash
#
# build-win.sh — Cross-compile POS Offline for Windows from Linux.
#
# Handles the native better-sqlite3 module by downloading the
# official prebuilt Windows binary before running electron-builder.
#
# Usage:
#   ./scripts/build-win.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Resolve Electron version from the installed package ──────────────
ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
echo "==> Detected Electron version: $ELECTRON_VERSION"

# ── Step 1: Build frontend UI ───────────────────────────────────────
echo "==> Building frontend UI..."
(cd frontend && yarn build)

# ── Step 2: Download Windows prebuilt binary for better-sqlite3 ─────
echo "==> Downloading Windows prebuilt binary for better-sqlite3..."
SQLITE3_DIR="$PROJECT_DIR/node_modules/better-sqlite3"

# Backup the current (Linux) .node file
if [ -f "$SQLITE3_DIR/build/Release/better_sqlite3.node" ]; then
    cp "$SQLITE3_DIR/build/Release/better_sqlite3.node" \
       "$SQLITE3_DIR/build/Release/better_sqlite3.node.linux-bak"
fi

# Download the Windows prebuilt binary using prebuild-install
(cd "$SQLITE3_DIR" && npx prebuild-install \
    --platform win32 \
    --arch x64 \
    --runtime electron \
    --target "$ELECTRON_VERSION" \
    --tag-prefix v \
    --verbose)

# Verify it's actually a Windows PE binary
FILE_TYPE=$(file "$SQLITE3_DIR/build/Release/better_sqlite3.node" 2>&1)
if echo "$FILE_TYPE" | grep -q "PE32"; then
    echo "==> OK: Windows binary verified (PE32+)"
else
    echo "!!! ERROR: Downloaded binary is NOT a Windows PE file:"
    echo "    $FILE_TYPE"
    exit 1
fi

# ── Step 3: Run electron-builder for Windows ────────────────────────
echo "==> Building Windows installer with electron-builder..."
npx electron-builder --win --x64

# ── Step 4: Restore Linux binary ────────────────────────────────────
if [ -f "$SQLITE3_DIR/build/Release/better_sqlite3.node.linux-bak" ]; then
    mv "$SQLITE3_DIR/build/Release/better_sqlite3.node.linux-bak" \
       "$SQLITE3_DIR/build/Release/better_sqlite3.node"
    echo "==> Restored Linux native binary"
fi

echo ""
echo "==> Build complete! Check dist_electron/ for the installer."
ls -lh "$PROJECT_DIR/dist_electron/"*.exe 2>/dev/null || echo "(no .exe found — check dist_electron/ manually)"
