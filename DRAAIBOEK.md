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

## G. Vragen naar rapportage (besluit 480)

Ontwerp en voorwaarden: websitegesprek-reviewdossier-vraagbaak-register-v2 en -aanvulling (review V1–V13), Juridisch RV1–RV9.

0. **Ondertekenen (V20.1):** elk bericht van de vraagserver naar rapportage is ondertekend over `wg-export-v1.<tijd>.<body>`, elk antwoord
   van rapportage met de wislijst over `wg-wislijst-v1.<tijd>.<body>` (HMAC-SHA256, venster 300 s). Een bericht met het label van de
   andere richting telt niet.
1. **Wat:** elke nacht om 03:17 stuurt `vraag-export.timer` (geïnstalleerd door `deploy/install.sh`) de regels van het register
   die ouder zijn dan 1 uur ondertekend naar rapportage (`src/doorsturen.mjs`). Alleen de vaste velden (RV2), nooit IP-code, token
   of gesprek. Rapportage bewaart 12 maanden. Stand zonder inhoud: `/healthz` › `export` (alarm bij 2 mislukte nachten of 7 dagen achterstand).
2. **Staat uit tot:** (a) de proefrun langs de botcontrole van SiteGround is geslaagd (stap 4), (b) Juridisch schriftelijk akkoord gaf,
   ook op de herbevestiging van 15 nov 21:30 (V8, V13, RV1). Zonder `VRAAG_EXPORT=aan` doet de timer niets.
3. **Sleutel zetten (Raymond, nooit via chat):** TCP 22 tijdelijk open, dan `ssh -t -i ~/.ssh/websitegesprek_vraag root@vraag.websitegesprek.nl vraag-sleutel-zetten rapportage`.
   De nieuwe sleutel (32 bytes) staat één keer op je scherm; zet hem in wp-config.php van rapportage als `WG_VRAAG_SLEUTEL`. TCP 22 weer dicht.
4. **Proefrun (V8a):** in de container `node src/beheer.mjs stuur-proefregel`. Verwacht `"ok":true`. Komt `sgcaptcha` terug, dan houdt
   de botcontrole van SiteGround de server tegen: export blijft uit en er komt eerst een nieuw besluit. De proefregel (id `T-PROEF…`) daarna
   op rapportage wissen (stap 7).
5. **Aanzetten (na akkoord):** `VRAAG_EXPORT=aan` in `/etc/vraag/vraag.env` en `systemctl restart vraag.service`.
6. **Sleutel vervangen zonder uitval (S5):** in wp-config.php de huidige sleutel eerst ook als `WG_VRAAG_SLEUTEL_OUD` zetten, dan stap 3
   (nieuwe sleutel als `WG_VRAAG_SLEUTEL`), na één geslaagde nacht `WG_VRAAG_SLEUTEL_OUD` weghalen. Halfjaarlijks, samen met de API-sleutel.
7. **Eén regel wissen op verzoek van een bezoeker (RV5, V16, H4, H5):**
   - **Tot account-plugin 1.9.0 live is (HB7):** Raymond meldt het verzoek met het antwoordnummer in een chat in WG - Doorontwikkeling.
     Claude wist binnen een week na die melding op de vraagserver: TCP 22 tijdelijk open, in de container `node src/beheer.mjs wis-antwoord V-XXXXXX`
     (logt alleen het nummer), TCP 22 weer dicht. Staat de export al aan, dan ook op rapportage (vaste actie, zodra er is).
   - **Met 1.9.0:** Raymond typt in een chat "wis antwoord V-XXXXXX" en keurt de goedkeuringslink goed. Rapportage wist meteen en zet het nummer
     40 dagen op de wislijst (alleen nummer en datum, H4). De vraagserver haalt de wislijst elke nacht op in het ondertekende antwoord
     (label `wg-wislijst-v1`, ook als de export uit staat), wist de regel en meldt het nummer de nacht erna terug. Een niet of verkeerd
     ondertekende wislijst wordt genegeerd en alleen geteld (H6; zie `/healthz` › `export.wislijst`).
   - **Antwoord aan de bezoeker (H5):** "gewist" pas als rapportage gewist heeft, het nummer op de wislijst staat en een verwerkchat met dat
     nummer verwijderd is. Bij een onbekend nummer letterlijk: "Onder dit antwoordnummer staat bij ons niets (meer)." Geen inhoud van de vraag
     terugsturen. Uiterlijk binnen een maand. Daarna het bericht van de bezoeker verwijderen (H4).
   - **Na een echte terugzetting van rapportage (H7):** de wis-antwoorden van de laatste 40 dagen opnieuw uitvoeren met de nummers uit het
     logboek van de vraagserver (`node src/beheer.mjs logboek`, regels `wissen`).
8. **Wissen:** vraagserver na 30 dagen (met export: als verstuurd, uiterlijk na 35 dagen, dan geteld in het logboek); rapportage na 12 maanden.
   Dit is de vastgelegde uitzondering op "nooit definitief verwijderen" (besluit 480, K4).
9. **Terugdraaien (C6), in deze volgorde:** (a) eerst rapportage: account-plugin terug naar 1.8.5 via `evereone/orders action=account_update`
   (binnen een uur, zonder FTP); (b) dan de vraagserver: `VRAAG_EXPORT` weghalen, of een commit die in `install.sh` `systemctl disable --now vraag-export.timer`
   zet (voert de nachtelijke update uit). Na terugdraaien naar 1.8.5 binnen 30 dagen opnieuw aanzetten of de tabel op rapportage legen
   met akkoord van Raymond (V12).
10. **Testvragen uit bezoekersvragen (review V18, keuze 18.1):** nooit in deze openbare repository. Alleen op de server in
    `/data/testset-server.json` (zelfde vorm als `testset/testset.json`, in eigen woorden). Ze draaien mee in de volledige testset;
    `/proef` toont van die vragen alleen id en uitkomst. Een GitHub-workflow draait `npm test` bij elke pull request, met een test die
    antwoordnummers in bestanden, commitberichten en de pull request weigert en hard faalt als hij zijn bron niet kan lezen (V18.6).
