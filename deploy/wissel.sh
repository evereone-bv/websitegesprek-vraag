#!/bin/bash
# Wisselscript van besluit 546.1 (blauw-groen): een nieuwe versie van de vraagbaak gaat pas live als de volledige
# testset slaagt; tot dan blijft de laatste goedgekeurde versie antwoorden. Aangeroepen door deploy/install.sh
# (nachtelijke update) en door vraag-poort.timer (elke 15 minuten). Voorwaarden: W1–W8 en V12–V16 van 546.1.
#
#   bash deploy/wissel.sh update            nieuw image websitegesprek-vraag:kandidaat testen en zo nodig wisselen
#   bash deploy/wissel.sh controle          herhaling na een technische fout (W5) en ongeteste instellingen (W2)
#   bash deploy/wissel.sh herhaal <sleutel> een gezakte sleutel toch opnieuw laten testen (V15b, alleen na akkoord Raymond)
#   bash deploy/wissel.sh terug             terug naar websitegesprek-vraag:vorige (eerste route bij terugdraaien)
#
# Bestanden (W12b): $VAR/goedgekeurd/<sleutel>.json, $VAR/gezakt/<sleutel>.json, $VAR/goedkeuring-live.json (alleen-
# lezen in de live container als /goedkeuring.json), $VAR/poort/stand.json (alleen-lezen als /poort), $VAR/poging.
# De omgevingsvariabelen hieronder zijn er alleen voor de automatische test (test/wissel.test.mjs).
set -euo pipefail

DOCKER="${DOCKER:-docker}"
SYSTEMCTL="${SYSTEMCTL:-systemctl}"
CURL="${CURL:-curl}"
VAR="${VRAAG_VAR:-/var/lib/vraag}"
ENVBESTAND="${VRAAG_ENV:-/etc/vraag/vraag.env}"
SLOT="${VRAAG_SLOT:-/run/vraag-wissel.lock}"
MEMINFO="${VRAAG_MEMINFO:-/proc/meminfo}"
MAXDUUR="${VRAAG_TEST_MAXDUUR:-5400}"        # W3: hooguit 90 minuten
TESTGEHEUGEN_MB="${VRAAG_TEST_GEHEUGEN_MB:-384}" # W3/V12: vaste grens; na meting op de server vastgelegd in het dossier
MARGE_MB=256                                 # V12: live + test + 256 MB marge moet passen
WACHT="${VRAAG_WACHT:-2}"                    # seconden tussen twee controles van /healthz
POGINGEN="${VRAAG_STARTPOGINGEN:-$((60 / WACHT))}" # W8/V15d: samen hooguit 60 seconden
IMG=websitegesprek-vraag
NU="${VRAAG_NU:-$(date +%s)}"

log() { echo "wissel: $*"; logger -t vraag-wissel -- "$*" 2>/dev/null || true; }

mappen() { mkdir -p "$VAR/goedgekeurd" "$VAR/gezakt" "$VAR/poort" "$VAR/uit"; }

# Stand voor /healthz (W11): alleen vaste woorden en een hexadecimale sleutel.
zet_stand() { # nieuwe_versie sleutel uitkomst reden
  local tmp="$VAR/poort/stand.json.tmp"
  printf '{"nieuwe_versie":"%s","laatste":{"sleutel":"%s","uitkomst":"%s","reden":"%s","tijd":%s}}\n' "$1" "$2" "$3" "$4" "$NU" > "$tmp"
  mv "$tmp" "$VAR/poort/stand.json"
}

image_bestaat() { "$DOCKER" image inspect "$1" >/dev/null 2>&1; }

servertestset() { # mount-optie voor de servertestset (besluit 480), alleen-lezen
  local pad
  pad="$("$DOCKER" volume inspect vraagdata -f '{{.Mountpoint}}' 2>/dev/null || true)/testset-server.json"
  if [ -f "$pad" ]; then echo "-v $pad:/tmp/k/testset-server.json:ro"; fi
}

sleutel_van() { # image → sleutel van deze versie met de instellingen van de server (leeg bij een oude versie)
  # shellcheck disable=SC2046
  "$DOCKER" run --rm --network none --read-only --tmpfs /tmp --cap-drop=ALL --security-opt no-new-privileges \
    --env-file "$ENVBESTAND" -e VRAAG_DATA_DIR=/tmp/k $(servertestset) "$1" \
    node --disable-warning=ExperimentalWarning src/kandidaat.mjs sleutel 2>/dev/null | tr -cd '0-9a-f' || true
}

sleutel_in() { # goedkeuringsbestand → sleutel
  [ -f "$1" ] && grep -o '"sleutel":"[0-9a-f]*"' "$1" | head -1 | cut -d'"' -f4 || true
}

geheugen_vrij_mb() { awk '/^MemAvailable:/ { print int($2 / 1024) }' "$MEMINFO"; }

# V13/W3: kostengrens per run: 3 keer de kosten van de laatste geslaagde run, minimaal € 5.
plafond() {
  local k
  k="$(grep -o '"kosten_euro":[0-9.]*' "$VAR/goedkeuring-live.json" 2>/dev/null | cut -d: -f2 || true)"
  awk -v k="${k:-0}" 'BEGIN { p = 3 * k; if (p < 5) p = 5; printf "%.2f", p }'
}

# Volledige testset in de testcontainer (W3). Geeft 0 geslaagd, 1 gezakt, 2 technische fout.
test_kandidaat() { # image sleutel
  local image="$1" sleutel="$2" code=0
  "$DOCKER" rm -f vraag-kandidaat >/dev/null 2>&1 || true # W4: achtergebleven testcontainer eerst weg
  if [ "$(geheugen_vrij_mb)" -lt $((TESTGEHEUGEN_MB + MARGE_MB)) ]; then
    log "te weinig vrij geheugen voor de testcontainer (V12); test niet gestart"
    return 2
  fi
  rm -f "$VAR/uit/uitslag.json"
  chown 1000:1000 "$VAR/uit" 2>/dev/null || true
  zet_stand bezig "$sleutel" bezig ""
  # shellcheck disable=SC2046
  timeout "$MAXDUUR" "$DOCKER" run --rm --name vraag-kandidaat --network vraagnet \
    --read-only --tmpfs /tmp:size=64m --cap-drop=ALL --security-opt no-new-privileges --pids-limit=256 \
    --memory="${TESTGEHEUGEN_MB}m" --memory-swap="${TESTGEHEUGEN_MB}m" --oom-score-adj=1000 \
    --env-file "$ENVBESTAND" -e VRAAG_DATA_DIR=/tmp/k -e VRAAG_TEST_PLAFOND="$(plafond)" \
    -v "$VAR/uit:/uit" $(servertestset) "$image" \
    node --disable-warning=ExperimentalWarning src/kandidaat.mjs test /uit || code=$?
  "$DOCKER" rm -f vraag-kandidaat >/dev/null 2>&1 || true
  if [ "$code" -eq 0 ] && [ "$(sleutel_in "$VAR/uit/uitslag.json")" = "$sleutel" ] && grep -q '"geslaagd":true' "$VAR/uit/uitslag.json"; then
    cp "$VAR/uit/uitslag.json" "$VAR/goedgekeurd/$sleutel.json"
    return 0
  fi
  if [ "$code" -eq 1 ]; then return 1; fi
  return 2 # tijdslimiet (124), geheugen, API- of netwerkfout: technisch (W5)
}

gezond() { # commando... → binnen 60 seconden gezond
  local _
  for _ in $(seq 1 "$POGINGEN"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep "$WACHT"
  done
  return 1
}

# W8/V15d: eerst de nieuwe versie onder een andere naam starten en controleren; pas dan live vervangen. Lukt live
# daarna niet binnen 60 seconden, dan automatisch terug naar de vorige versie.
wissel_naar() { # image goedkeuringsbestand sleutel
  local image="$1" gk="$2" sleutel="$3"
  "$DOCKER" rm -f vraag-startcontrole >/dev/null 2>&1 || true
  "$DOCKER" run -d --name vraag-startcontrole --network vraagnet --read-only --tmpfs /tmp --cap-drop=ALL \
    --security-opt no-new-privileges --memory=256m -e VRAAG_ACTIEF=0 -e VRAAG_DATA_DIR=/tmp/d -e ANTHROPIC_API_KEY= \
    "$image" >/dev/null
  if ! gezond "$DOCKER" exec vraag-startcontrole node -e "fetch('http://127.0.0.1:8090/healthz').then((r)=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    "$DOCKER" rm -f vraag-startcontrole >/dev/null 2>&1 || true
    log "nieuwe versie $sleutel start niet; live blijft ongewijzigd"
    echo "{\"reden\":\"start\",\"tijd\":$NU}" > "$VAR/gezakt/$sleutel.json"
    zet_stand gezakt "$sleutel" gezakt start
    return 1
  fi
  "$DOCKER" rm -f vraag-startcontrole >/dev/null 2>&1 || true
  if image_bestaat "$IMG:live" && [ "$image" != "$IMG:live" ]; then "$DOCKER" tag "$IMG:live" "$IMG:vorige"; fi
  cp "$VAR/goedkeuring-live.json" "$VAR/goedkeuring-vorige.json" 2>/dev/null || true
  [ "$image" != "$IMG:live" ] && "$DOCKER" tag "$image" "$IMG:live"
  cp "$gk" "$VAR/goedkeuring-live.json"
  "$SYSTEMCTL" restart vraag
  if gezond "$CURL" -fsS http://127.0.0.1:8090/healthz; then
    log "live: $sleutel"
    zet_stand live "$sleutel" geslaagd ""
    return 0
  fi
  log "live start niet na de wissel; terug naar de vorige versie"
  terug
  echo "{\"reden\":\"start\",\"tijd\":$NU}" > "$VAR/gezakt/$sleutel.json"
  zet_stand gezakt "$sleutel" gezakt start
  return 1
}

terug() {
  if ! image_bestaat "$IMG:vorige"; then log "geen vorige versie"; return 1; fi
  "$DOCKER" tag "$IMG:vorige" "$IMG:live"
  if [ -f "$VAR/goedkeuring-vorige.json" ]; then cp "$VAR/goedkeuring-vorige.json" "$VAR/goedkeuring-live.json"; fi
  "$SYSTEMCTL" restart vraag
}

# W5: na een technische fout opnieuw na 15 minuten, 1 uur en 4 uur; daarna gezakt.
poging_na_fout() { # sleutel image
  local sleutel="$1" image="$2" n=0
  if [ -f "$VAR/poging" ] && [ "$(cut -d' ' -f1 "$VAR/poging")" = "$sleutel" ]; then n="$(cut -d' ' -f2 "$VAR/poging")"; fi
  n=$((n + 1))
  if [ "$n" -gt 3 ]; then
    rm -f "$VAR/poging"
    echo "{\"reden\":\"technisch\",\"tijd\":$NU}" > "$VAR/gezakt/$sleutel.json"
    zet_stand gezakt "$sleutel" fout technisch
    log "nieuwe versie $sleutel: 4 keer een technische fout; gezakt"
    return
  fi
  local wacht=(0 900 3600 14400)
  echo "$sleutel $n $((NU + wacht[n])) $image" > "$VAR/poging"
  zet_stand bezig "$sleutel" fout technisch
  log "nieuwe versie $sleutel: technische fout, poging $n van 3 over $((wacht[n] / 60)) minuten"
}

beoordeel() { # image sleutel
  local image="$1" sleutel="$2" code=0
  if [ -f "$VAR/goedgekeurd/$sleutel.json" ]; then
    wissel_naar "$image" "$VAR/goedgekeurd/$sleutel.json" "$sleutel" || true; return
  fi
  if [ -f "$VAR/gezakt/$sleutel.json" ]; then
    log "sleutel $sleutel is eerder gezakt; niet opnieuw getest (V15b)"; zet_stand gezakt "$sleutel" gezakt eerder; return
  fi
  test_kandidaat "$image" "$sleutel" || code=$?
  case "$code" in
    0) rm -f "$VAR/poging"; wissel_naar "$image" "$VAR/goedgekeurd/$sleutel.json" "$sleutel" || true ;;
    1) rm -f "$VAR/poging"; echo "{\"reden\":\"inhoudelijk\",\"tijd\":$NU}" > "$VAR/gezakt/$sleutel.json"
       zet_stand gezakt "$sleutel" gezakt inhoudelijk; log "nieuwe versie $sleutel gezakt; live blijft" ;;
    *) poging_na_fout "$sleutel" "$image" ;;
  esac
}

update() {
  local sleutel
  image_bestaat "$IMG:kandidaat" || { log "geen kandidaat"; return 0; }
  sleutel="$(sleutel_van "$IMG:kandidaat")"
  [ -n "$sleutel" ] || { log "sleutel van de kandidaat onbekend"; zet_stand gezakt "" fout sleutel; return 0; }
  # Gelijke sleutel als live: de antwoorden veranderen niet (bijv. export, beheer, nieuw basisimage); de goedkeuring
  # van live geldt dan ook voor de kandidaat, en beoordeel() wisselt zonder nieuwe testset.
  if [ "$(sleutel_in "$VAR/goedkeuring-live.json")" = "$sleutel" ] && [ ! -f "$VAR/goedgekeurd/$sleutel.json" ]; then
    cp "$VAR/goedkeuring-live.json" "$VAR/goedgekeurd/$sleutel.json"
  fi
  beoordeel "$IMG:kandidaat" "$sleutel"
}

controle() {
  # W5: een geplande herhaling na een technische fout.
  if [ -f "$VAR/poging" ]; then
    local sleutel n volgende image
    read -r sleutel n volgende image < "$VAR/poging"
    if [ "$NU" -ge "$volgende" ]; then
      local code=0
      test_kandidaat "$image" "$sleutel" || code=$?
      case "$code" in
        0) rm -f "$VAR/poging"; wissel_naar "$image" "$VAR/goedgekeurd/$sleutel.json" "$sleutel" || true ;;
        1) rm -f "$VAR/poging"; echo "{\"reden\":\"inhoudelijk\",\"tijd\":$NU}" > "$VAR/gezakt/$sleutel.json"; zet_stand gezakt "$sleutel" gezakt inhoudelijk ;;
        *) poging_na_fout "$sleutel" "$image" ;;
      esac
    fi
    return 0
  fi
  # W2: past de goedkeuring niet bij de live versie met de huidige instellingen (bijv. na een wijziging in vraag.env),
  # dan één testrun voor die sleutel; de live versie blijft intussen antwoorden.
  image_bestaat "$IMG:live" || return 0
  local live
  live="$(sleutel_van "$IMG:live")"
  [ -n "$live" ] || return 0
  [ "$(sleutel_in "$VAR/goedkeuring-live.json")" = "$live" ] && return 0
  beoordeel "$IMG:live" "$live"
}

hoofd() {
  mappen
  exec 9>"$SLOT"
  if ! flock -n 9; then log "wisselscript draait al; niets gedaan (W4)"; exit 0; fi
  case "${1:-}" in
    update) update ;;
    controle) controle ;;
    herhaal) [ -n "${2:-}" ] && rm -f "$VAR/gezakt/${2//[^0-9a-f]/}.json" && log "sleutel $2 mag opnieuw getest worden" ;;
    terug) terug ;;
    *) echo "Gebruik: wissel.sh update | controle | herhaal <sleutel> | terug"; exit 64 ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then hoofd "$@"; fi
