// Besluit 480: het register elke nacht ondertekend naar rapportage sturen (12 maanden bewaren).
// Geen taalmodel, geen open eindpunt: de vraagserver duwt, rapportage controleert handtekening, tijd en velden.
// Ontwerp: websitegesprek-reviewdossier-vraagbaak-register-v2 (review V1–V13) en voorwaarden Juridisch RV1–RV9.
import { createHmac } from 'node:crypto';

// RV2: alleen deze velden; nooit IP-code, token, gesprek of beurten.
export const VELDEN = ['id', 'tijd', 'pagina', 'vraag', 'antwoord', 'bron', 'onderwerp', 'zeker', 'doorverwezen', 'vervangen',
  'reden', 'duim', 'kb_versie', 'model', 'taal', 'kosten_milli_cent', 'duur_ms'];
const TEKSTGRENS = { vraag: 600, antwoord: 2000 }; // overige tekstvelden 200 (V4b)
export const GRENZEN = { reeksBytes: 400 * 1024, reeksRegels: 500, verzoekenPerNacht: 20, timeoutMs: 5000, rijpMs: 60 * 60_000 };
export const WACHT_MS = [2000, 8000]; // hooguit 3 pogingen
const DAG = 86_400_000;
const ID = /^[A-Z]-[A-Z0-9]{1,12}$/;

// S5: minstens 32 willekeurige bytes (64 hex-tekens).
export function sleutelGeldig(s) { return /^[0-9a-f]{64,}$/i.test(String(s || '')); }

// Export draait alleen met adres, geldige sleutel én een expliciete schakelaar (RV1: pas aan na V8/V13).
export function exportActief(config) {
  return !!(config.rapportageUrl && sleutelGeldig(config.rapportageSleutel) && config.exportAan);
}

// Inkorten op tekens (code points), nooit midden in een UTF-8-teken.
export function korten(waarde, max) {
  if (typeof waarde !== 'string') return waarde;
  const tekens = Array.from(waarde);
  return tekens.length > max ? tekens.slice(0, max).join('') : waarde;
}

export function schoonRegel(r) {
  const uit = {};
  for (const v of VELDEN) {
    const w = r[v] ?? null;
    uit[v] = typeof w === 'string' ? korten(w, TEKSTGRENS[v] || 200) : w;
  }
  return uit;
}

// V5 en V6d: alleen regels ouder dan 1 uur (late invoegingen en duimen zijn dan binnen), nooit '/proef'.
export function kiesRegels(db, cursor, nu, limiet = GRENZEN.reeksRegels * GRENZEN.verzoekenPerNacht) {
  const c = cursor || { tijd: 0, id: '' };
  return db.prepare(`SELECT ${VELDEN.join(', ')} FROM register
    WHERE (pagina IS NULL OR pagina != '/proef') AND tijd < ? AND (tijd > ? OR (tijd = ? AND id > ?))
    ORDER BY tijd, id LIMIT ?`).all(nu - GRENZEN.rijpMs, c.tijd, c.tijd, c.id, limiet);
}

// V4b: reeksen van hooguit 400 kB en 500 regels.
export function maakReeksen(regels) {
  const reeksen = [];
  let huidig = [];
  let bytes = 2;
  for (const r of regels) {
    const n = Buffer.byteLength(JSON.stringify(r)) + 1;
    if (huidig.length && (bytes + n > GRENZEN.reeksBytes || huidig.length >= GRENZEN.reeksRegels)) {
      reeksen.push(huidig);
      huidig = [];
      bytes = 2;
    }
    huidig.push(r);
    bytes += n;
  }
  if (huidig.length) reeksen.push(huidig);
  return reeksen;
}

// Zoals Stripe: HMAC-SHA256 over "t.ruwe_body"; bij elke poging een nieuwe tijd en handtekening.
export function onderteken(body, sleutel, tSec) {
  const v1 = createHmac('sha256', sleutel).update(`${tSec}.${body}`).digest('hex');
  return `t=${tSec},v1=${v1}`;
}

// C7: alleen vaste labels, nooit tekst uit een antwoord.
export function foutLabel(status) {
  if (status === 202) return 'sgcaptcha';
  if ([400, 401, 403, 404, 413, 429].includes(status)) return `http_${status}`;
  if (status >= 500) return 'http_5xx';
  return `http_${status || 0}`;
}
const OPNIEUW = new Set(['sgcaptcha', 'http_5xx', 'tijd', 'netwerk']);

async function eenPoging({ url, sleutel, body, fetchFn, nu }) {
  const ctrl = new AbortController();
  const klok = setTimeout(() => ctrl.abort(), GRENZEN.timeoutMs);
  try {
    const r = await fetchFn(url, { method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/json',
      'x-wg-handtekening': onderteken(body, sleutel, Math.floor(nu() / 1000)) }, body });
    if (r.status !== 200) return { ok: false, label: foutLabel(r.status) };
    try { return { ok: true, data: await r.json() }; } catch { return { ok: false, label: 'antwoord_onleesbaar' }; }
  } catch (e) {
    return { ok: false, label: e?.name === 'AbortError' ? 'tijd' : 'netwerk' };
  } finally { clearTimeout(klok); }
}

// Hooguit 3 pogingen met oplopende wachttijd; 401/413/429 en onleesbaar niet opnieuw (SRE: geen eindeloze herhaling).
export async function verstuur({ url, sleutel, body, fetchFn, nu = Date.now, wacht = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let laatste = null;
  for (let i = 0; i < 3; i++) {
    if (i > 0) await wacht(WACHT_MS[i - 1]);
    laatste = await eenPoging({ url, sleutel, body, fetchFn, nu });
    if (laatste.ok || !OPNIEUW.has(laatste.label)) return { ...laatste, pogingen: i + 1 };
  }
  return { ...laatste, pogingen: 3 };
}

// V4a/V4c/K5: cursor alleen verder als ontvangen gelijk is aan verstuurd; afgewezen regels tellen, nooit opnieuw.
export function verwerkAntwoord(data, verstuurd) {
  const n = (x) => (Number.isInteger(x) && x >= 0 ? x : -1);
  const ontvangen = n(data?.ontvangen);
  const afgewezen = Array.isArray(data?.afgewezen) ? data.afgewezen.filter((a) => ID.test(String(a?.id || ''))) : [];
  if (ontvangen !== verstuurd) return { ok: false, label: 'aantal_klopt_niet' };
  return { ok: true, opgeslagen: Math.max(0, n(data.opgeslagen)), al_aanwezig: Math.max(0, n(data.al_aanwezig)), afgewezen };
}

function cursorVan(regel) { return { tijd: regel.tijd, id: regel.id }; }

function noteerFout(opslag, label, nu) {
  const s = opslag.staat('export:status', {}) || {};
  const nacht = new Date(nu).toISOString().slice(0, 10);
  const mislukt = s.laatste_mislukte_nacht === nacht ? s.mislukte_nachten || 1 : (s.mislukte_nachten || 0) + 1;
  opslag.zetStaat('export:status', { ...s, laatste_fout: label, laatste_fout_tijd: nu, mislukte_nachten: mislukt, laatste_mislukte_nacht: nacht });
  opslag.log('export', `mislukt: ${label}`);
  if (mislukt >= 2) opslag.log('alarm', `export ${mislukt} nachten op rij mislukt (${label})`);
}

function noteerGeslaagd(opslag, nu, afgewezenErbij) {
  const s = opslag.staat('export:status', {}) || {};
  opslag.zetStaat('export:status', { ...s, laatst_geslaagd: nu, mislukte_nachten: 0, afgewezen_totaal: (s.afgewezen_totaal || 0) + afgewezenErbij });
}

// Eén nachtelijke run. Geeft een samenvatting zonder inhoud terug.
export async function stuurRegister({ config, opslag, fetchFn = fetch, nu = Date.now, wacht }) {
  if (!exportActief(config)) return { gedaan: false, reden: 'export_uit' };
  const t = nu();
  const regels = kiesRegels(opslag.db, opslag.staat('export:cursor', null), t).map(schoonRegel);
  const samen = { gedaan: true, verstuurd: 0, opgeslagen: 0, al_aanwezig: 0, afgewezen: 0, reeksen: 0 };
  for (const reeks of maakReeksen(regels).slice(0, GRENZEN.verzoekenPerNacht)) {
    const body = JSON.stringify({ regels: reeks });
    const r = await verstuur({ url: config.rapportageUrl, sleutel: config.rapportageSleutel, body, fetchFn, nu, wacht });
    const v = r.ok ? verwerkAntwoord(r.data, reeks.length) : r;
    if (!v.ok) { noteerFout(opslag, v.label, t); return { ...samen, fout: v.label }; }
    for (const a of v.afgewezen) opslag.log('export', `afgewezen ${a.id}: ${String(a.reden || '').replace(/[^a-z_]/g, '').slice(0, 30)}`);
    opslag.zetStaat('export:cursor', cursorVan(reeks[reeks.length - 1]));
    Object.assign(samen, { verstuurd: samen.verstuurd + reeks.length, opgeslagen: samen.opgeslagen + v.opgeslagen,
      al_aanwezig: samen.al_aanwezig + v.al_aanwezig, afgewezen: samen.afgewezen + v.afgewezen.length, reeksen: samen.reeksen + 1 });
  }
  noteerGeslaagd(opslag, t, samen.afgewezen);
  opslag.log('export', `geslaagd: ${samen.verstuurd} verstuurd, ${samen.opgeslagen} nieuw, ${samen.al_aanwezig} al aanwezig, ${samen.afgewezen} afgewezen`);
  return samen;
}

// V8a: proefrun met één vaste nepregel, zonder gegevens van bezoekers.
export function proefRegel(nu = Date.now()) {
  return { id: 'T-PROEF' + String(nu).slice(-5), tijd: nu, pagina: '/proef-export', vraag: 'Proefregel export, geen bezoeker.',
    antwoord: 'Proefregel.', bron: 'https://websitegesprek.nl/', onderwerp: 'proef', zeker: 1, doorverwezen: 0, vervangen: 0,
    reden: '', duim: null, kb_versie: '', model: '', taal: 'nl', kosten_milli_cent: 0, duur_ms: 0 };
}

export async function stuurProefregel({ config, fetchFn = fetch, nu = Date.now, wacht }) {
  if (!config.rapportageUrl || !sleutelGeldig(config.rapportageSleutel)) return { ok: false, label: 'geen_sleutel_of_adres' };
  const regel = proefRegel(nu());
  const r = await verstuur({ url: config.rapportageUrl, sleutel: config.rapportageSleutel, body: JSON.stringify({ regels: [regel] }), fetchFn, nu, wacht });
  const v = r.ok ? verwerkAntwoord(r.data, 1) : r;
  return { ...v, id: regel.id, pogingen: r.pogingen };
}

// Voor /healthz: alleen getallen en vaste labels (C3, C7).
export function exportStatus({ config, opslag, nu = Date.now() }) {
  const actief = exportActief(config);
  const s = opslag.staat('export:status', {}) || {};
  const c = opslag.staat('export:cursor', null) || { tijd: 0, id: '' };
  const r = opslag.db.prepare(`SELECT COUNT(*) AS n, MIN(tijd) AS oudste FROM register
    WHERE (pagina IS NULL OR pagina != '/proef') AND (tijd > ? OR (tijd = ? AND id > ?))`).get(c.tijd, c.tijd, c.id);
  const oudsteDagen = r.oudste ? Math.floor((nu - r.oudste) / DAG) : 0;
  const mislukt = s.mislukte_nachten || 0;
  return {
    actief,
    laatst_geslaagd: s.laatst_geslaagd ? new Date(s.laatst_geslaagd).toISOString() : null,
    laatste_fout: s.laatste_fout || null,
    achterstand_regels: actief ? r.n : null,
    oudste_niet_verstuurd_dagen: actief ? oudsteDagen : null,
    afgewezen_totaal: s.afgewezen_totaal || 0,
    mislukte_nachten: mislukt,
    alarm: actief && (mislukt >= 2 || oudsteDagen >= 7),
  };
}

// Wisregel op de server (VB6, review 7.2): zonder export na 30 dagen; met export na 30 dagen als verstuurd,
// en uiterlijk na 35 dagen (dan geteld als verloren). Uitzondering op 'nooit definitief verwijderen' (K4).
export function wisOudeRegels({ config, opslag, nu = Date.now() }) {
  const grens = nu - (config.registerDagen || 30) * DAG;
  if (!exportActief(config)) return opslag.db.prepare('DELETE FROM register WHERE tijd < ?').run(grens).changes;
  const c = opslag.staat('export:cursor', null) || { tijd: 0, id: '' };
  const verstuurd = opslag.db.prepare('DELETE FROM register WHERE tijd < ? AND (tijd < ? OR (tijd = ? AND id <= ?))').run(grens, c.tijd, c.tijd, c.id).changes;
  const verloren = opslag.db.prepare("DELETE FROM register WHERE tijd < ? AND (pagina IS NULL OR pagina != '/proef')").run(nu - 35 * DAG).changes;
  opslag.db.prepare("DELETE FROM register WHERE tijd < ? AND pagina = '/proef'").run(grens);
  if (verloren) opslag.log('export', `${verloren} regels niet verstuurd en na 35 dagen gewist`);
  return verstuurd + verloren;
}

// RV5: één regel wissen op antwoordnummer (verzoek van een bezoeker). Logt alleen het nummer.
export function wisAntwoord(opslag, id) {
  const nr = String(id || '').trim().toUpperCase();
  if (!ID.test(nr)) return { ok: false, reden: 'ongeldig_nummer' };
  const n = opslag.db.prepare('DELETE FROM register WHERE id = ?').run(nr).changes;
  opslag.log('wissen', `antwoord ${nr}: ${n ? 'gewist' : 'niet gevonden'}`);
  return { ok: true, gewist: n, id: nr };
}
