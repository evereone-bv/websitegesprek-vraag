# CLAUDE.md – websitegesprek-vraag (vraagbaak op websitegesprek.nl)

1. Leidend zijn instructies-algemeen en de overdrachtsdocumenten van WG – Doorontwikkeling; ontwerp:
   `docs/voorstellen/websitegesprek-ontwerp-vraagbaak.md` in `evereone-bv/websitegesprek` (0.2, besluiten 398–402,
   voorwaarden Juridisch V1–V7 en VB1–VB10).
2. Deze repository is openbaar: nooit sleutels, tokens, IP-adressen of bezoekersvragen in code, commits of logs.
3. `main` wordt elke zondag 04:37 door de server zelf opgehaald (vraag-update.timer). Werk op een eigen branch;
   samenvoegen in `main` alleen na `npm test` groen en akkoord van Raymond.
4. Instructie (`src/instructie.mjs`), model of controle wijzigen = testset opnieuw (draait vanzelf op de server; uitslag
   op https://vraag.websitegesprek.nl/proef). Live alleen bij geslaagd (≥90% en 0 fouten op valkuilen, 3x gedraaid).
5. De vraagbaak is voor bezoekers alleen aan als de testset geslaagd is én het blok op websitegesprek.nl `data-aan="1"` heeft
   (besluit 400, DRAAIBOEK B2). Live alleen met privacyverklaring 1.8 en na de eindtoets van Juridisch (V7/VB8).
6. Testen: `npm test` (nagebootste API, geen sleutel nodig, geen kosten).
