#!/usr/bin/env bash
# Point the cloudcli systemd unit at this fork and restart it.
# The restart terminates the current CloudCLI chat process; sessions persist in
# ~/.claude and are resumable after the UI reconnects.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(dirname "${REPO_DIR}")"
DROPIN_DIR="/etc/systemd/system/cloudcli.service.d"
DROPIN="${DROPIN_DIR}/zz-live-view.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

if [ ! -f "${REPO_DIR}/dist-server/server/modules/cli/cli.js" ]; then
  echo "Build is missing. Run: cd ${REPO_DIR} && npm ci && npm run build" >&2
  exit 1
fi

mkdir -p "${DROPIN_DIR}"

if [ -f "${DROPIN}" ] && ! grep -q "live-view fork" "${DROPIN}" 2>/dev/null; then
  backup="${DROPIN}.bak.$(date +%Y%m%d-%H%M%S)"
  cp -a "${DROPIN}" "${backup}"
  echo "Existing drop-in backed up to ${backup}"
fi

cat > "${DROPIN}" <<EOF
[Service]
# live-view fork: run the modified build from ${REPO_DIR}
Environment=LIVE_VIEW_ROOTS=${WORKSPACE_ROOT}
ExecStart=
ExecStart=/usr/bin/node ${REPO_DIR}/dist-server/server/modules/cli/cli.js start
EOF

chmod 644 "${DROPIN}"
systemctl daemon-reload
systemctl restart cloudcli
systemctl --no-pager --lines=0 status cloudcli || true

echo
echo "CloudCLI now runs from ${REPO_DIR}"
echo "Open the UI and hard-reload (Ctrl+Shift+R) if the Live View panel is not visible."
