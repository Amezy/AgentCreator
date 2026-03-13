#!/usr/bin/env bash
# ============================================================
# AgentCreator - Packaging Script
# Creates a distributable tarball for deployment
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d%H%M%S)
PACKAGE_NAME="agent-creator-${TIMESTAMP}"
BUILD_DIR="/tmp/${PACKAGE_NAME}"

echo "============================================"
echo " AgentCreator Packager"
echo "============================================"
echo " Project root: $PROJECT_ROOT"

# 1. Clean up previous build
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# 2. Copy source code
echo "Copying source files..."
cp -r "$PROJECT_ROOT/src" "$BUILD_DIR/"
cp -f "$PROJECT_ROOT/pyproject.toml" "$BUILD_DIR/"

# 3. Copy deploy scripts
echo "Copying deploy scripts..."
cp -r "$PROJECT_ROOT/deploy" "$BUILD_DIR/"

# 4. Remove development / cache files
echo "Cleaning up cache files..."
find "$BUILD_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -type d -name ".ruff_cache" -exec rm -rf {} + 2>/dev/null || true
find "$BUILD_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true
find "$BUILD_DIR" -type f -name ".DS_Store" -delete 2>/dev/null || true

# 5. Create tarball
OUTPUT_DIR="${PROJECT_ROOT}/dist"
mkdir -p "$OUTPUT_DIR"
TARBALL="${OUTPUT_DIR}/${PACKAGE_NAME}.tar.gz"

echo "Creating tarball: $TARBALL"
tar czf "$TARBALL" -C /tmp "$PACKAGE_NAME"

# 6. Cleanup
rm -rf "$BUILD_DIR"

SIZE=$(du -h "$TARBALL" | cut -f1)
echo ""
echo "============================================"
echo " Package created successfully!"
echo "============================================"
echo " File: $TARBALL"
echo " Size: $SIZE"
echo ""
echo " Deploy:"
echo "   scp $TARBALL user@server:/home/user/"
echo "   ssh user@server"
echo "   sudo tar xzf ${PACKAGE_NAME}.tar.gz -C /opt/aibox/"
echo "   cd /opt/aibox/${PACKAGE_NAME}/deploy && sudo bash install.sh"
echo "============================================"
