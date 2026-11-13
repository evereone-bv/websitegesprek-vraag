# Draaiboek vraagbaak – neerzetten, sleutel, bijwerken, uitval

## A. Nieuwe server (Hetzner Cloud, project Websitegesprek)

1. Primary IP `vraag-websitegesprek-ipv4` = 2.31.189.129 (Nuremberg). DNS bij Hostnet: A-record `vraag` → dat
   adres, TTL 600 (staat sinds 13 nov 2026).
2. Server aanmaken: locatie Nuremberg, Ubuntu 24.04, type CPX02 (1 vCPU, 1 GB; CX23 was 13 nov niet leverbaar in Nuremberg), naam `vraag-websitegesprek`,
   Networking: het Primary IP hierboven (IPv4), SSH-sleutel van Raymond, Cloud config: inhoud van
   `deploy/cloud-config.yaml`.
3. Firewall `fw-vraag`: inkomend TCP 80, TCP 443, ICMP. TCP 22 alleen tijdelijk, zolang de sleutel wordt gezet.
4. Na ca. 5 minuten: `https://vraag.websitegesprek.nl/healthz` geeft `{"ok":true,...,"sleutel_gezet":false}`.
   Installatielog op de server: `/var/log/vraag-install.log`.

## B. API-sleutel zetten of vervangen (Raymond)

1. Claude Console › werkruimte `vraagbaak` › API keys › Create key, naam `vraag-websitegesprek-server`.
   Van dit scherm geen schermafbeelding; de sleutel nergens anders bewaren.
2. Hetzner-firewall: tijdelijk TCP 22 open.
3. Op de Mac in Terminal: `ssh -t root@vraag.websitegesprek.nl vraag-sleutel-zetten` en de sleutel plakken
   (onzichtbaar). Het script controleert de sleutel bij Anthropic en slaat hem pas dan op.
4. Hetzner-firewall: TCP 22 weer dicht.
5. Controle: `/healthz` geeft `"sleutel_gezet":true`.
6. Elk kwartaal vervangen (herinnering), oude sleutel daarna intrekken in de Console.

## C. Bijwerken

- Automatisch elke zondag 04:37: code uit GitHub (main), nieuwste basis-image, herstart (`vraag-update.timer`).
- Beveiligingsupdates van Ubuntu dagelijks (unattended-upgrades).

## D. Uitval

1. Het venster op websitegesprek.nl valt na 12 s terug op WhatsApp en mail (ontwerp §3); de site lijdt er niet onder.
2. Nieuwe server: stap A en B opnieuw (alles staat in GitHub; het register staat dagelijks op rapportage).
