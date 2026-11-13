# Vraagbaak Websitegesprek (vraag.websitegesprek.nl)

Server van de chat op websitegesprek.nl: beantwoordt vragen van bezoekers alleen uit de gepubliceerde pagina's
van websitegesprek.nl, via de Claude-API (werkruimte "vraagbaak" van EVEReONE B.V.).

Ontwerp en besluiten: `docs/voorstellen/websitegesprek-ontwerp-vraagbaak.md` in `evereone-bv/websitegesprek`
(ontwerp 0.2, besluiten 398–402).

## Stand

Versie 0.0.x: alleen de basis (https, firewall, updates, gezondheidscontrole `GET /healthz`). De vraagbaak zelf
staat nog uit (`vraagbaak_actief: false`).

## Regels

1. Geen geheimen in deze repository (ze is openbaar). De API-sleutel staat alleen in `/etc/vraag/vraag.env` op de
   server en wordt gezet met `deploy/sleutel-zetten.sh` (zie DRAAIBOEK.md).
2. De instructie (systeemprompt) die later hier komt, wordt bewust als openbaar beschouwd: er staat niets geheims in.
3. Testen: `npm test`.
