# CLAUDE.md – websitegesprek-vraag (vraagbaak op websitegesprek.nl)

1. Leidend zijn instructies-algemeen en de overdrachtsdocumenten van WG – Doorontwikkeling; ontwerp:
   `docs/voorstellen/websitegesprek-ontwerp-vraagbaak.md` in `evereone-bv/websitegesprek` (0.2, besluiten 398–402,
   voorwaarden Juridisch V1–V7 en VB1–VB10).
2. Deze repository is openbaar: nooit sleutels, tokens, IP-adressen of bezoekersvragen in code, commits of logs.
3. `main` wordt elke nacht om 04:37 door de server zelf opgehaald (vraag-update.timer, besluit 449). Werk op een eigen branch;
   samenvoegen in `main` zodra `npm test` groen is en Raymond akkoord gaf op het besluit of de opdracht; een apart akkoord
   voor het samenvoegen is niet nodig (Raymond 15 nov 10:42, past bij besluit 287: hooguit twee keer akkoord per klus).
   Wel apart akkoord voor alles wat bezoekers gaan zien: data-aan/data-zichtbaar of data-spraak op de site wijzigen (live).
4. Instructie (`src/instructie.mjs`), model of controle wijzigen = testset opnieuw (draait vanzelf op de server; uitslag
   op https://vraag.websitegesprek.nl/proef). Live alleen bij geslaagd (≥90% en 0 fouten op valkuilen, 3x gedraaid).
5. De vraagbaak is voor bezoekers alleen aan als de testset geslaagd is én het blok op websitegesprek.nl `data-aan="1"` heeft
   (besluit 400, DRAAIBOEK B2). Live alleen met privacyverklaring 1.8 en na de eindtoets van Juridisch (V7/VB8).
6. Testen: `npm test` (nagebootste API, geen sleutel nodig, geen kosten).
7. Antwoorden via search_result-blokken met citations (besluit 447); geen eigen JSON-uitvoer (Citations en structured outputs
   gaan volgens Anthropic niet samen). Testset met harde codecontroles plus vaste AI-beoordelaar (besluit 448,
   `src/beoordelaar.mjs`); de volledige testset draait beide nadenk-varianten (`low` en `uit`) en kiest.
8. Eerst officiële documentatie (platform.claude.com/docs) en marktpraktijk, dan pas bouwen; bronnen noemen in PR en voorstel.
