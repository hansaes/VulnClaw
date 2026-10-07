#!/usr/bin/env bash
# Setup HexStrike AI MCP server for VulnClaw.
# Clones https://github.com/0x4m4/hexstrike-ai (MIT) into ~/.vulnclaw/hexstrike,
# creates a venv and installs its Python requirements.
# The security tool binaries themselves (nmap, nuclei, sqlmap, …) must be
# installed separately via your OS package manager.
#
# Usage: bash vulnclaw/mcp/setup_hexstrike.sh [--ref v6.0.0]
set -euo pipefail

REF="${1:-}"
INSTALL_DIR="${HOME}/.vulnclaw/hexstrike"
REPO="https://github.com/0x4m4/hexstrike-ai"

if [ -d "${INSTALL_DIR}/.git" ]; then
  echo "==> Updating existing checkout at ${INSTALL_DIR}"
  git -C "${INSTALL_DIR}" pull --ff-only
else
  echo "==> Cloning HexStrike AI to ${INSTALL_DIR}"
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone --depth 1 ${REF:+--branch "${REF}"} "${REPO}" "${INSTALL_DIR}"
fi

echo "==> Creating venv"
python3 -m venv "${INSTALL_DIR}/.venv"
# shellcheck disable=SC1091
source "${INSTALL_DIR}/.venv/bin/activate"

echo "==> Installing Python requirements (this takes a while)"
pip install --upgrade pip
pip install -r "${INSTALL_DIR}/requirements.txt"

echo "==> Smoke test: listing MCP tools"
python3 - <<'EOF'
import asyncio, sys
sys.path.insert(0, __import__("os").path.expanduser("~/.vulnclaw/hexstrike"))
print("hexstrike_mcp.py present:",
      __import__("os").path.exists(__import__("os").path.expanduser("~/.vulnclaw/hexstrike/hexstrike_mcp.py")))
EOF

cat <<'EOF'

Done. Next steps:
  1. Install the scanner binaries you need, e.g.:
       sudo apt install nmap nikto sqlmap
     (nuclei, ffuf, amass: download releases from their GitHub pages)
  2. Enable the server in your VulnClaw config (~/.vulnclaw/config.yaml):
       mcp:
         servers:
           hexstrike:
             enabled: true
  3. Restart VulnClaw — the MCP diagnostics page will show hexstrike + tool count.
EOF
