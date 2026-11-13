#!/bin/bash
# Zet of vervangt de Claude API-sleutel van de vraagbaak. Alleen voor Raymond, via SSH vanaf zijn eigen computer:
#   ssh -t root@vraag.websitegesprek.nl vraag-sleutel-zetten
# De sleutel wordt niet getoond, niet gelogd en alleen opgeslagen in /etc/vraag/vraag.env (rechten 600).
set -euo pipefail
ENVF=/etc/vraag/vraag.env

if [ "$(id -u)" != "0" ]; then echo "Draai dit als root."; exit 1; fi
if [ ! -t 0 ]; then echo "Gebruik ssh -t, zodat je de sleutel onzichtbaar kunt plakken."; exit 1; fi

printf 'Plak de API-sleutel (je ziet niets verschijnen) en druk op Enter: '
IFS= read -rs KEY
echo
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"

case "$KEY" in
  sk-ant-*) ;;
  *) echo "Dit lijkt geen Claude API-sleutel (moet beginnen met sk-ant-). Er is niets opgeslagen."; exit 1 ;;
esac

echo "Controleren bij Anthropic..."
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
  -H @<(printf 'x-api-key: %s\n' "$KEY") -H 'anthropic-version: 2023-06-01' https://api.anthropic.com/v1/models || true)"
if [ "$CODE" != "200" ]; then
  echo "Anthropic accepteert deze sleutel niet (antwoord $CODE). Er is niets opgeslagen."
  unset KEY
  exit 1
fi

umask 077
TMP="$(mktemp /etc/vraag/.vraag.env.XXXXXX)"
grep -v '^ANTHROPIC_API_KEY=' "$ENVF" 2>/dev/null > "$TMP" || true
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$TMP"
unset KEY
chmod 0600 "$TMP"
mv "$TMP" "$ENVF"

systemctl restart vraag.service
sleep 3
if curl -fsS http://127.0.0.1:8090/healthz | grep -q '"sleutel_gezet":true'; then
  echo "Gelukt: de sleutel is opgeslagen en de vraagbaak ziet hem."
else
  echo "Sleutel opgeslagen, maar de dienst bevestigt hem nog niet. Laat Claude meekijken (geen sleutel in de chat)."
fi
