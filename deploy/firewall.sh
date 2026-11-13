#!/bin/bash
# Firewall voor de container van de vraagbaak. Wordt bij elke start opnieuw gezet (vraag-firewall.service).
# De container mag alleen naar openbare adressen op poort 443 (+ DNS): de Claude-API, websitegesprek.nl en
# rapportage. Nooit naar interne netwerken, de metadata van de server (169.254.169.254) of de server zelf.
set -euo pipefail

BRIDGE=br-vraag
CHAIN=VRAAG-EGRESS
PRIVATE_V4="0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4"

iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"
iptables -A "$CHAIN" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
for net in $PRIVATE_V4; do
  iptables -A "$CHAIN" -d "$net" -j DROP
done
iptables -A "$CHAIN" -p udp --dport 53 -j RETURN
iptables -A "$CHAIN" -p tcp --dport 53 -j RETURN
iptables -A "$CHAIN" -p tcp --dport 443 -j RETURN
iptables -A "$CHAIN" -j DROP

iptables -D DOCKER-USER -i "$BRIDGE" -j "$CHAIN" 2>/dev/null || true
iptables -I DOCKER-USER 1 -i "$BRIDGE" -j "$CHAIN"

iptables -D INPUT -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || true
iptables -D INPUT -i "$BRIDGE" -j DROP 2>/dev/null || true
iptables -I INPUT 1 -i "$BRIDGE" -j DROP
iptables -I INPUT 1 -i "$BRIDGE" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT

echo "Firewall vraagbaak gezet."
