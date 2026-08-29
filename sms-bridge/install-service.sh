#!/usr/bin/env bash
# Run on the droplet as root AFTER the files and /opt/sms-bridge/.env are in place.
set -euo pipefail
cd /opt/sms-bridge

if [ ! -f .env ]; then
  echo "ERROR: /opt/sms-bridge/.env is missing. Create it first (see .env.example)." >&2
  exit 1
fi

chown -R bridge:bridge /opt/sms-bridge
chmod 600 .env
sudo -u bridge npm install --omit=dev

cp sms-bridge.service /etc/systemd/system/sms-bridge.service
systemctl daemon-reload
systemctl enable --now sms-bridge
sleep 3
systemctl status sms-bridge --no-pager || true
echo
echo "Follow logs with: journalctl -u sms-bridge -f"
