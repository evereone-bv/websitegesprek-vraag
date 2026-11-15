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

Testmodus (besluit 421): `data-aan="1"` plus `data-zichtbaar="test"` = server aan, maar bezoekers zien de chat alleen met
`?vraagbaak=test` in het adres. Voor de livegang `data-zichtbaar` weghalen.

Livegang (voorwaarde Juridisch bij 421): zodra de site voor het eerst `data-aan="1"` zonder `data-zichtbaar="test"` heeft,
maakt de server het register één keer leeg (testvragen weg); zie `register_gewist_bij_live` in /healthz. Handmatig kan het
ook: `node src/beheer.mjs wis-register` in de container.

Uitzetten: `data-aan="0"` op de site (binnen 15 minuten uit op de server; de knop verdwijnt meteen).
Noodgeval: `VRAAG_ACTIEF=0` in `/etc/vraag/vraag.env` zet hem altijd uit (vraagt SSH).
Live pas met privacyverklaring 1.8 en na de eindtoets van Juridisch (V7/VB8).

## C. Bijwerken

- Automatisch elke nacht 04:37 (besluit 449, was wekelijks): code uit GitHub (main), nieuwste basis-image, herstart (`vraag-update.timer`).
- Direct bijwerken (alleen als het niet tot de nacht kan wachten): TCP 22 tijdelijk open in `fw-vraag`, dan op de Mac
  `ssh -i ~/.ssh/websitegesprek_vraag root@vraag.websitegesprek.nl 'systemctl start vraag-update.service && echo GELUKT'`, daarna TCP 22 weer dicht.
- Beveiligingsupdates van Ubuntu dagelijks (unattended-upgrades).

## D. Uitval

1. Het venster op websitegesprek.nl valt na 12 s terug op WhatsApp en mail (ontwerp §3); de site lijdt er niet onder.
2. Nieuwe server: stap A en B opnieuw (alles staat in GitHub; het register staat dagelijks op rapportage).

## B3. Microfoonknop aan of uit (besluit 409)

1. Pas na akkoord van Juridisch.
2. Werkbon op websitegesprek.nl: in het zwevende kaartje `data-spraak="0"` vervangen door `data-spraak="1"` (staat naast `data-aan`).
3. Zonder akkoord is de knop alleen te zien met `?vraagbaak=test&spraak=1`. De gewone testlink toont het venster zoals bezoekers het zien, zonder microfoon. Voorlezen is vervallen (besluit 456).

## E. Model en testset (besluit 467)

1. Bezoekers krijgen het model dat de volledige testset kiest: Sonnet 5.5 (met en zonder nadenken) en Haiku 5.5 (met nadenken) draaien allemaal; de meeste goede antwoorden wint, bij precies gelijk de snelste.
2. Haiku valt alleen in bij drukte, een time-out of een netwerkfout van het gekozen model.
3. De beoordelaar van de testset is Opus 5.5 (sterker dan het model dat hij nakijkt).
4. Een volledige testset met drie varianten duurt ongeveer een half uur tot drie kwartier; tot hij klaar is, staat de vraagbaak uit als het de eerste keer is na een wijziging.
5. Faalt een controle die het model kan verbeteren (geen bron, een getal of woord dat niet op de site staat, te lang), dan vraagt de server het één keer opnieuw met precies wat er mis was; pas daarna volgt de doorverwijzing.

## F. Kosten en budget (besluit 468)

1. Per bezoeker: 30 vragen per uur, 100 per dag, 20 per gesprek; vragen hooguit 500 tekens (OWASP LLM10: rate limiting en invoergrenzen).
2. Zuinige stand: vanaf 70% van het uurbudget (€ 10) of dagbudget (€ 30), of bij een kostenpiek (vanaf € 3 in een uur en 3x het gemiddelde), gebruikt de vraagbaak het goedkopere model, maar alleen als dat de testset ook haalde. Zichtbaar op /healthz onder `budget`.
3. Harde grens: bij € 10 in een uur of € 30 op een dag tijdelijk "even niet beschikbaar" met WhatsApp en mail (een mens als terugval).
4. Laatste vangnet bij Anthropic (eenmalig, door Raymond): Console › Settings › Workspaces › werkruimte van de vraagbaak › Spend limits: maandgrens en een melding ruim daaronder.
5. Een kostenpiek zet de vraagbaak niet meer uit; uit gaat hij alleen bij een ongeldige sleutel, op tegoed, veel API-fouten of een rode dagelijkse proef.
