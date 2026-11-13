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

## Stand 13 nov 2026

Server `vraag-websitegesprek` (CPX02, Ubuntu 24.04, Nuremberg) draait; firewall `fw-vraag` met ICMP, TCP 80, TCP 443
(TCP 22 weer dicht). SSH-sleutel `vraag-websitegesprek` staat alleen op de Mac van Raymond (`~/.ssh/websitegesprek_vraag`).
API-sleutel `vraag-websitegesprek-server` (werkruimte vraagbaak) gezet; verloopt 13 feb 2027 (herinnering 1 feb 2027).

## B. API-sleutel zetten of vervangen (Raymond)

1. Claude Console › werkruimte `vraagbaak` › API keys › Create key, naam `vraag-websitegesprek-server`.
   Van dit scherm geen schermafbeelding; de sleutel nergens anders bewaren.
2. Hetzner-firewall: tijdelijk TCP 22 open.
3. Op de Mac in Terminal: `ssh -t -i ~/.ssh/websitegesprek_vraag root@vraag.websitegesprek.nl vraag-sleutel-zetten` en de sleutel plakken
   (onzichtbaar). Het script controleert de sleutel bij Anthropic en slaat hem pas dan op.
4. Hetzner-firewall: TCP 22 weer dicht.
5. Controle: `/healthz` geeft `"sleutel_gezet":true`.
6. Elk kwartaal vervangen (herinnering), oude sleutel daarna intrekken in de Console.

## B2. Vraagbaak aan- en uitzetten voor bezoekers (zonder SSH, besluit 400)

De server is aan als alle drie kloppen (modus "auto", standaard):
1. de volledige testset voor het huidige model en de huidige instructie is geslaagd (https://vraag.websitegesprek.nl/proef);
2. het blok op websitegesprek.nl heeft `data-aan="1"` (de server leest dat elke 15 minuten; Claude zet het met een
   werkbon na 'publiceren' van Raymond);
3. er is geen storing (sleutel, tegoed, foutpercentage, kostenpiek, rode dagproef) en geen plafond bereikt.

Uitzetten: `data-aan="0"` op de site (binnen 15 minuten uit op de server; de knop verdwijnt meteen).
Noodgeval: `VRAAG_ACTIEF=0` in `/etc/vraag/vraag.env` zet hem altijd uit (vraagt SSH).
Live pas met privacyverklaring 1.8 en na de eindtoets van Juridisch (V7/VB8).

## C. Bijwerken

- Automatisch elke zondag 04:37: code uit GitHub (main), nieuwste basis-image, herstart (`vraag-update.timer`).
- Beveiligingsupdates van Ubuntu dagelijks (unattended-upgrades).

## D. Uitval

1. Het venster op websitegesprek.nl valt na 12 s terug op WhatsApp en mail (ontwerp §3); de site lijdt er niet onder.
2. Nieuwe server: stap A en B opnieuw (alles staat in GitHub; het register staat dagelijks op rapportage).
