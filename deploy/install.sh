#!/bin/bash
# Zet de vraagbaak neer of werkt hem bij, op een kale Ubuntu 24.04-server (Hetzner of elders).
# Idempotent: mag vaker draaien. Aanroepen als root vanuit /opt/vraag: bash deploy/install.sh
# Geheimen staan alleen in /etc/vraag/vraag.env (rechten 600, root). Dit script maakt dat bestand leeg aan
# als het er nog niet is en overschrijft het nooit.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$(pwd)"
IMAGE=websitegesprek-vraag:latest

echo "== Pakketten"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io caddy git iptables unattended-upgrades ca-certificates curl
systemctl enable --now docker

echo "== Docker-logboek begrenzen"
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  printf '{\n  "log-driver": "json-file",\n  "log-opts": { "max-size": "10m", "max-file": "3" }\n}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi

echo "== Automatische beveiligingsupdates"
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

echo "== SSH: alleen met sleutel, nooit met wachtwoord"
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-vraag.conf
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true

echo "== Geheimenbestand (nooit overschrijven)"
install -d -m 0700 /etc/vraag
if [ ! -f /etc/vraag/vraag.env ]; then
  install -m 0600 /dev/null /etc/vraag/vraag.env
fi
chmod 0600 /etc/vraag/vraag.env
chown root:root /etc/vraag/vraag.env
install -m 0755 deploy/sleutel-zetten.sh /usr/local/sbin/vraag-sleutel-zetten

echo "== Netwerk en firewall voor de container"
docker network inspect vraagnet >/dev/null 2>&1 || docker network create --driver bridge --subnet 172.31.0.0/24 -o com.docker.network.bridge.name=br-vraag vraagnet
install -m 0755 deploy/firewall.sh /usr/local/sbin/vraag-firewall
cat > /etc/systemd/system/vraag-firewall.service <<'UNIT'
[Unit]
Description=Firewall vraagbaak Websitegesprek
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/vraag-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT

echo "== Image bouwen"
docker build --pull -t "$IMAGE" .

echo "== Dienst"
cat > /etc/systemd/system/vraag.service <<UNIT
[Unit]
Description=Vraagbaak Websitegesprek
After=docker.service vraag-firewall.service
Requires=docker.service vraag-firewall.service
[Service]
Restart=always
RestartSec=5
ExecStartPre=-/usr/bin/docker rm -f vraag
ExecStart=/usr/bin/docker run --rm --name vraag --network vraagnet -p 127.0.0.1:8090:8090 \\
  --memory=512m --pids-limit=256 --cap-drop=ALL --security-opt no-new-privileges \\
  --read-only --tmpfs /tmp:size=16m \\
  -v vraagdata:/data --env-file /etc/vraag/vraag.env $IMAGE
ExecStop=/usr/bin/docker stop -t 10 vraag
[Install]
WantedBy=multi-user.target
UNIT

echo "== Wekelijks bijwerken (zondag 04:37): code uit GitHub, nieuwste basis-image, herstart"
cat > /etc/systemd/system/vraag-update.service <<UNIT
[Unit]
Description=Vraagbaak bijwerken
[Service]
Type=oneshot
WorkingDirectory=$DIR
ExecStart=/bin/bash -c 'git fetch -q origin && git reset -q --hard origin/main && bash deploy/install.sh'
UNIT
cat > /etc/systemd/system/vraag-update.timer <<'UNIT'
[Unit]
Description=Vraagbaak wekelijks bijwerken
[Timer]
OnCalendar=Sun *-*-* 04:37:00
Persistent=true
[Install]
WantedBy=timers.target
UNIT

echo "== Caddy (https)"
install -m 0644 deploy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

systemctl daemon-reload
systemctl enable --now vraag-firewall.service
systemctl restart vraag-firewall.service
systemctl enable vraag.service vraag-update.timer
systemctl restart vraag.service
systemctl start vraag-update.timer
systemctl enable caddy
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "== Controle"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8090/healthz >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:8090/healthz && echo
echo "Klaar."
