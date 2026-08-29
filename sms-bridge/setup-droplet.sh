#!/usr/bin/env bash
# Run ONCE on a fresh Ubuntu 24.04 droplet, as root.
set -euo pipefail

# Node 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# unprivileged user + app dir
id -u bridge &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin bridge
mkdir -p /opt/sms-bridge
chown -R bridge:bridge /opt/sms-bridge

# firewall: SSH only, nothing else inbound (the bridge exposes no port)
ufw allow OpenSSH
ufw --force enable

node --version
echo "OK. Next: scp index.js package.json sms-bridge.service install-service.sh into /opt/sms-bridge,"
echo "create /opt/sms-bridge/.env, then run: bash /opt/sms-bridge/install-service.sh"
