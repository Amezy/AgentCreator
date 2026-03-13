#!/usr/bin/env bash
# ============================================================
# AgentCreator - Installation Script
# Run as root (sudo bash install.sh)
# ============================================================
set -euo pipefail

INSTALL_DIR="/opt/aibox/agent-creator"
SERVICE_NAME="agent-creator"
SERVICE_USER="boxsystem"
PYTHON_MIN="3.12"

echo "============================================"
echo " AgentCreator Installer"
echo "============================================"

# 1. Check running as root
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: This script must be run as root (sudo bash install.sh)"
    exit 1
fi

# 2. Check Python version
PYTHON_BIN=""
for candidate in python3.12 python3 python; do
    if command -v "$candidate" &>/dev/null; then
        ver=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        if python3 -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)" 2>/dev/null; then
            PYTHON_BIN="$candidate"
            break
        fi
    fi
done

if [[ -z "$PYTHON_BIN" ]]; then
    echo "ERROR: Python >= ${PYTHON_MIN} is required but not found."
    exit 1
fi
echo "Using Python: $PYTHON_BIN ($($PYTHON_BIN --version))"

# 3. Ensure service user exists
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "Creating service user: $SERVICE_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# 4. Create directories
echo "Setting up directories..."
mkdir -p "$INSTALL_DIR/data/chroma"
mkdir -p "$INSTALL_DIR/data/logs"

# 5. Copy application files (assumes we're running from the extracted tarball)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$(dirname "$SCRIPT_DIR")"

echo "Copying application files from $APP_SRC ..."
# Copy source and config files
cp -r "$APP_SRC/src" "$INSTALL_DIR/"
cp -f "$APP_SRC/pyproject.toml" "$INSTALL_DIR/"
# Copy deploy scripts
cp -r "$APP_SRC/deploy" "$INSTALL_DIR/"

# 6. Create virtual environment and install dependencies
echo "Setting up Python virtual environment..."
if [[ ! -d "$INSTALL_DIR/.venv" ]]; then
    "$PYTHON_BIN" -m venv "$INSTALL_DIR/.venv"
fi
"$INSTALL_DIR/.venv/bin/pip" install --upgrade pip
"$INSTALL_DIR/.venv/bin/pip" install -e "$INSTALL_DIR"

# 7. Set permissions
echo "Setting file permissions..."
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
chmod -R 755 "$INSTALL_DIR"

# 8. Install systemd service
echo "Installing systemd service..."
cp -f "$INSTALL_DIR/deploy/systemd/$SERVICE_NAME.service" "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# 9. Start / restart service
echo "Starting $SERVICE_NAME service..."
systemctl restart "$SERVICE_NAME"

echo ""
echo "============================================"
echo " Installation Complete!"
echo "============================================"
echo " Service: $SERVICE_NAME"
echo " Status:  systemctl status $SERVICE_NAME"
echo " Logs:    journalctl -u $SERVICE_NAME -f"
echo " API:     http://localhost:8100/api/v1/health"
echo "============================================"
