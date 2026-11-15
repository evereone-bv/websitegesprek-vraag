# Vraagbaak Websitegesprek (vraag.websitegesprek.nl)

Server van de chat op websitegesprek.nl: beantwoordt vragen van bezoekers alleen uit de gepubliceerde pagina's
van websitegesprek.nl, via de Claude-API (werkruimte "vraagbaak" van EVEReONE B.V., inference geo alleen "us").

Ontwerp en besluiten: `docs/voorstellen/websitegesprek-ontwerp-vraagbaak.md` in `evereone-bv/websitegesprek`
(ontwerp 0.2, besluiten 398–402, voorwaarden Juridisch V1–V7 en VB1–VB10).

## Hoe het werkt (versie 0.1.3)

```
websitegesprek.nl  vast blok (venster/blok-websitegesprek.html), laadt niets tot de tik
   └─ tik → https://vraag.websitegesprek.nl/v1/venster.js (chatvenster, geen cookies)
        POST /v1/puzzel  → rekenpuzzel (proof-of-work, ~1 s)          besluit 401
        POST /v1/token   → gesprekstoken (30 min, 20 vragen, aan IP-hash gebonden)
        POST /v1/vraag   → antwoord + bron + antwoord-ID               ontwerp §4
        POST /v1/duim    → duim omhoog/omlaag in het register          besluit 402 fase 1
   GET /healthz  stand (aan/uit, reden, kennisbank, kosten vandaag) – nooit de sleutel
   GET /proef    uitslag van de volledige testset op de server (geen bezoekersgegevens)
```

1. **Kennisbank** (`src/kennisbank.mjs`): elke 6 uur de openbare pagina's uit de sitemap plus /start/, /opzeggen/,
   /proberen/; schone tekst, menu/footer één keer. Nieuwe versie pas actief na een proef van 10 vragen (als de
   vraagbaak aan staat) en niet bij een grote wijziging (>40%). Lukt ophalen niet (bijv. botcontrole van de hosting),
   dan blijft de vorige versie; zonder kennisbank wordt `kennisbank/snapshot.json` gebruikt.
2. **Antwoord** (`src/claude.mjs`, `src/instructie.mjs`, besluit 447): elke pagina als `search_result`-blok met
   citations aan, in de cache; geen tools; `inference_geo: "us"`. Het antwoord is gewone tekst; de API haalt de
   citaten zelf letterlijk uit de pagina's (Anthropic "Search results" en "Citations"; die gaan niet samen met
   structured outputs). Vaste codes `[DOORVERWIJZEN]` en `[BUITEN_ONDERWERP]` → vaste teksten uit de code.
   Nadenken: `low` (adaptief) of `uit`; de volledige testset draait beide en kiest.
3. **Controle in code** (`src/controle.mjs`): zonder bronvermelding geen antwoord, elke bron moet een pagina van de
   kennisbank zijn, elk getal met eenheid moet in de kennisbank staan, geen valuta omrekenen, risicowoorden (korting,
   garantie, geld terug…) alleen als een geciteerde pagina ze zelf noemt, links eruit. Faalt iets: doorverwijzing naar
   WhatsApp/mail. Anderstalig: zin dat de Nederlandse tekst geldt (VB7).
   **Testset** (`testset/testset.json`, `src/proef.mjs`, `src/beoordelaar.mjs`, besluit 448): harde codecontroles plus
   een vaste AI-beoordelaar (Sonnet 5.5, structured outputs) die juist, gegrond, beantwoordt en geen toezegging toetst.
4. **Grenzen en uitzetten** (`src/vraagbaak.mjs`): per gesprek, per IP-hash (dagelijks wisselend zout), per server;
   €2/uur en €8/dag (tijdelijk, vanzelf weer aan); blijvend uit bij sleutel-/tegoedfout, >20% API-fouten in 15 min,
   kostenpiek of rode dagelijkse proef; weer aan alleen na akkoord (`node src/beheer.mjs aan`).
   Aan/uit voor bezoekers: blok op websitegesprek.nl met `data-aan="1"` + geslaagde testset (DRAAIBOEK B2).
5. **Register** (`register` in SQLite): opgeschoonde vraag, antwoord, bron, onderwerp, doorverwezen, duim, kosten;
   geen IP of token; 30 dagen.

## Regels

1. Deze repository is bewust openbaar (VA2, Juridisch 14 nov): nooit sleutels, bezoekersgegevens, exports of
   logboeken. De API-sleutel staat alleen in `/etc/vraag/vraag.env`; de test `VA2` controleert dit bij elke `npm test`.
2. Testen: `npm test` (48 tests, nagebootste API). Echte testset alleen op de server (draait vanzelf).
3. IP-codes (hash met dagelijks wisselend zout) staan nooit langer dan 24 uur in de opslag (VA3): tellers verlopen na
   23 u 50 min, opruimen elke 5 minuten, SQLite met `secure_delete`.
4. Prijzen in `src/config.mjs` controleren bij elke modelwissel (Haiku 5.5: $0,10/$0,50 per miljoen tokens tot 100.000
   tokens; x1,1 voor inference geo "us").

## Wijzigingen

1. 0.1.3 (14 nov 2026) – voorwaarden Juridisch: VA1 link 'Privacy' in het venster; VA2 repo bewust openbaar, test
   zonder geheimen; VA3 IP-codes max. 24 uur; microfoon S1–S6: pas na een tik, stopt na het resultaat, na 30 s of bij
   sluiten (S1), `processLocally` waar de browser het kent (S2), tekst in het invoerveld en de bezoeker verstuurt zelf
   (S3), geen eigen geluidsopname (S4), vaste uitlegregel NL/EN onder het invoerveld (S5), voorlezen alleen met een
   stem op het toestel (`localService`) (S6). Knop rechtsonder 48 px, even groot als de naar-boven-knop (Raymond 14 nov).
   Microfoon voor bezoekers pas aan met privacyverklaring 1.8 (S7, `data-spraak="1"`).
2. 0.1.2 – spraak (besluit 409) en venster in huisstijl.
3. 0.1.1 – aan/uit via het blok op websitegesprek.nl (besluit 400).
