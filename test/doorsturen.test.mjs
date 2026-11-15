// Besluit 480: export naar rapportage (review V4–V7, C3, C7, K5; Juridisch RV2, RV5). Nagebootst rapportage, geen netwerk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openOpslag } from '../src/opslag.mjs';
import { laadConfig } from '../src/config.mjs';
import {
  VELDEN, GRENZEN, sleutelGeldig, exportActief, korten, maakReeksen, onderteken, verwerkAntwoord, verstuur,
  stuurRegister, stuurProefregel, exportStatus, wisOudeRegels, wisAntwoord, kiesRegels,
  LABEL_WISLIJST, handtekeningGeldig, WIS_MAX,
} from '../src/doorsturen.mjs';

const SLEUTEL = 'a'.repeat(64);
const URL_R = 'https://rapportage.websitegesprek.nl/wp-json/wg/v1/vraagbaak-register';
const DAG = 86_400_000;
const NU = Date.UTC(2026, 10, 16, 2, 17);
const geenWacht = async () => {};

function cfg(extra = {}) {
  return laadConfig({ VRAAG_DATA_DIR: ':memory:', VRAAG_RAPPORTAGE_URL: URL_R, VRAAG_RAPPORTAGE_SLEUTEL: SLEUTEL, VRAAG_EXPORT: 'aan', ...extra });
}
let teller = 0;
function regel(opslag, { tijd = NU - 2 * 60 * 60_000, pagina = '/', vraag = 'Wat kost het?', antwoord = 'Het kost...', duim = null, id } = {}) {
  const nr = id || 'T-' + String(++teller).padStart(6, '0'); // T-: nooit een echt antwoordnummer in de repo
  opslag.db.prepare(`INSERT INTO register (id, tijd, pagina, vraag, antwoord, bron, onderwerp, zeker, doorverwezen, vervangen, reden, duim, kb_versie, model, kosten_milli_cent, taal, duur_ms)
    VALUES (?, ?, ?, ?, ?, 'https://websitegesprek.nl/', 'prijs', 1, 0, 0, '', ?, 'kb1', 'claude-sonnet-5-5', 9, 'nl', 2000)`).run(nr, tijd, pagina, vraag, antwoord, duim);
  return nr;
}
// Nagebootst rapportage: controleert de handtekening zoals de account-plugin dat doet.
function nepRapportage({ status = 200, antwoord = null, bewaard = new Set() } = {}) {
  const verzoeken = [];
  const fn = async (url, opts) => {
    const kop = opts.headers['x-wg-handtekening'];
    const [, t, v1] = kop.match(/^t=(\d+),v1=([0-9a-f]{64})$/);
    const verwacht = createHmac('sha256', SLEUTEL).update(`wg-export-v1.${t}.${opts.body}`).digest('hex');
    const body = JSON.parse(opts.body);
    verzoeken.push({ url, kop, t: Number(t), ok: verwacht === v1, body, bytes: Buffer.byteLength(opts.body) });
    const st = typeof status === 'function' ? status(verzoeken.length) : status;
    if (st !== 200) return new Response('nee', { status: st });
    let nieuw = 0; let al = 0;
    for (const r of body.regels) { if (bewaard.has(r.id)) al++; else { bewaard.add(r.id); nieuw++; } }
    const data = antwoord ? antwoord(body) : { ontvangen: body.regels.length, opgeslagen: nieuw, al_aanwezig: al, afgewezen: [] };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  fn.verzoeken = verzoeken;
  return fn;
}

test('480 S5: export alleen met adres, sleutel van 32 bytes én VRAAG_EXPORT=aan', () => {
  assert.equal(sleutelGeldig('a'.repeat(63)), false);
  assert.equal(sleutelGeldig(SLEUTEL), true);
  assert.equal(exportActief(cfg()), true);
  assert.equal(exportActief(cfg({ VRAAG_EXPORT: '' })), false);
  assert.equal(exportActief(cfg({ VRAAG_RAPPORTAGE_SLEUTEL: 'kort' })), false);
  assert.equal(exportActief(cfg({ VRAAG_RAPPORTAGE_URL: '' })), false);
});

test('480 RV1: zonder schakelaar gaan er geen regels mee (alleen de wislijst wordt opgehaald); zonder sleutel niets', async () => {
  const opslag = openOpslag(':memory:'); regel(opslag);
  const api = nepRapportage();
  const r = await stuurRegister({ config: cfg({ VRAAG_EXPORT: '' }), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.export, false);
  assert.equal(api.verzoeken.length, 1);
  assert.deepEqual(api.verzoeken[0].body.regels, []);
  const zonder = await stuurRegister({ config: cfg({ VRAAG_EXPORT: '', VRAAG_RAPPORTAGE_SLEUTEL: '' }), opslag, fetchFn: api, nu: () => NU });
  assert.deepEqual(zonder, { gedaan: false, reden: 'export_uit' });
  assert.equal(api.verzoeken.length, 1);
});

test('480 RV2: alleen de allowlist-velden, met geldige handtekening; nooit ip, token of beurten', async () => {
  const opslag = openOpslag(':memory:'); regel(opslag);
  opslag.db.exec("ALTER TABLE register ADD COLUMN iphash TEXT; UPDATE register SET iphash = 'geheim'");
  const api = nepRapportage();
  const r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.verstuurd, 1);
  const v = api.verzoeken[0];
  assert.ok(v.ok, 'handtekening klopt');
  assert.equal(v.url, URL_R);
  assert.deepEqual(Object.keys(v.body.regels[0]).sort(), [...VELDEN].sort());
  assert.ok(!/iphash|token|beurten|geheim/.test(JSON.stringify(v.body)));
});

test('480 V4b: velden ingekort op tekens en reeksen hooguit 400 kB en 500 regels', () => {
  assert.equal(korten('é'.repeat(700), 600).length, 600);
  assert.equal(Array.from(korten('😀'.repeat(700), 600)).length, 600);
  const groot = Array.from({ length: 900 }, (_, i) => ({ id: `V-${i}`, antwoord: 'x'.repeat(2000) }));
  const reeksen = maakReeksen(groot);
  for (const r of reeksen) {
    assert.ok(Buffer.byteLength(JSON.stringify({ regels: r })) <= GRENZEN.reeksBytes + 64);
    assert.ok(r.length <= GRENZEN.reeksRegels);
  }
  assert.equal(reeksen.flat().length, 900);
});

test('480 V4b: lange vraag en antwoord gaan ingekort de deur uit', async () => {
  const opslag = openOpslag(':memory:'); regel(opslag, { vraag: 'v'.repeat(900), antwoord: 'a'.repeat(5000) });
  const api = nepRapportage();
  await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  const r = api.verzoeken[0].body.regels[0];
  assert.equal(r.vraag.length, 600); assert.equal(r.antwoord.length, 2000);
});

test('480 V5: regels jonger dan 1 uur wachten; late invoeging met lagere tijd komt de volgende keer mee', async () => {
  const opslag = openOpslag(':memory:');
  const oud = regel(opslag, { tijd: NU - 3 * 3600_000 });
  regel(opslag, { tijd: NU - 10 * 60_000 }); // te jong
  const api = nepRapportage();
  let r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.verstuurd, 1);
  assert.equal(api.verzoeken[0].body.regels[0].id, oud);
  // Na de export komt een regel binnen met een tijd tussen cursor en nu − 1 uur (antwoord duurde lang): komt mee.
  const laat = regel(opslag, { tijd: NU - 2 * 3600_000 });
  r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU + 60_000 });
  assert.equal(r.verstuurd, 1);
  assert.equal(api.verzoeken[1].body.regels[0].id, laat);
});

test('480 V5: een duim binnen 30 minuten na de vraag zit in de export', async () => {
  const opslag = openOpslag(':memory:');
  const id = regel(opslag, { tijd: NU - 50 * 60_000 });
  opslag.db.prepare('UPDATE register SET duim = 1 WHERE id = ?').run(id); // duim binnen het token van 30 min
  const api = nepRapportage();
  await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU + 15 * 60_000 });
  assert.equal(api.verzoeken[0].body.regels[0].duim, 1);
});

test('480 V6d: regels van /proef gaan nooit mee', async () => {
  const opslag = openOpslag(':memory:'); regel(opslag, { pagina: '/proef' });
  const api = nepRapportage();
  const r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.verstuurd, 0);
  assert.ok(api.verzoeken.every((v) => v.body.regels.length === 0));
});

test('480 V4a: opgeslagen maar antwoord na time-out: volgende keer al_aanwezig en de cursor schuift alsnog op', async () => {
  const opslag = openOpslag(':memory:'); regel(opslag); regel(opslag);
  const bewaard = new Set();
  let eerste = true;
  const api = nepRapportage({ bewaard });
  const traag = async (u, o) => { const r = await api(u, o); if (eerste) { eerste = false; const e = new Error('x'); e.name = 'AbortError'; throw e; } return r; };
  let r = await stuurRegister({ config: cfg(), opslag, fetchFn: traag, nu: () => NU, wacht: geenWacht });
  assert.equal(r.verstuurd, 2);
  assert.equal(r.al_aanwezig, 2, 'tweede poging ziet ze als al aanwezig');
  r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.verstuurd, 0, 'cursor staat erna');
});

test('480 V4c: afgewezen regel wordt overgeslagen en geteld, nooit opnieuw gestuurd', async () => {
  const opslag = openOpslag(':memory:'); const a = regel(opslag); regel(opslag);
  const api = nepRapportage({ antwoord: (b) => ({ ontvangen: b.regels.length, opgeslagen: b.regels.length - 1, al_aanwezig: 0, afgewezen: [{ id: a, reden: 'tekst_te_lang' }] }) });
  const r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.afgewezen, 1);
  const r2 = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r2.verstuurd, 0);
  assert.equal(exportStatus({ config: cfg(), opslag, nu: NU }).afgewezen_totaal, 1);
  assert.ok(opslag.db.prepare("SELECT COUNT(*) AS n FROM logboek WHERE tekst LIKE 'afgewezen %'").get().n === 1);
});

test('480 K5: ontvangen ≠ verstuurd telt als fout, cursor blijft staan, geen nieuwe poging', async () => {
  assert.deepEqual(verwerkAntwoord({ ontvangen: 1, opgeslagen: 1 }, 2), { ok: false, label: 'aantal_klopt_niet' });
  const opslag = openOpslag(':memory:'); regel(opslag); regel(opslag);
  const api = nepRapportage({ antwoord: () => ({ ontvangen: 1, opgeslagen: 1, al_aanwezig: 0, afgewezen: [] }) });
  const r = await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU, wacht: geenWacht });
  assert.equal(r.fout, 'aantal_klopt_niet');
  assert.equal(api.verzoeken.length, 1);
  assert.equal(opslag.staat('export:cursor', null), null);
});

test('480: 202 (sgcaptcha), 5xx en time-out hooguit 3 pogingen met nieuwe handtekening; 401/413/429 meteen stoppen', async () => {
  for (const [status, verwacht, pogingen] of [[202, 'sgcaptcha', 3], [503, 'http_5xx', 3], [401, 'http_401', 1], [413, 'http_413', 1], [429, 'http_429', 1]]) {
    const api = nepRapportage({ status });
    let klok = NU;
    const r = await verstuur({ url: URL_R, sleutel: SLEUTEL, body: '{"regels":[]}', fetchFn: api, nu: () => (klok += 2000), wacht: geenWacht });
    assert.equal(r.label, verwacht);
    assert.equal(api.verzoeken.length, pogingen, String(status));
    if (pogingen > 1) assert.notEqual(api.verzoeken[0].kop, api.verzoeken[1].kop, 'nieuwe handtekening per poging');
  }
  const stil = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await verstuur({ url: URL_R, sleutel: SLEUTEL, body: '{}', fetchFn: stil, wacht: geenWacht })).label, 'netwerk');
});

test('480 C3/C7: /healthz-veld zonder geheimen; alarm na twee mislukte nachten of 7 dagen achterstand', async () => {
  const opslag = openOpslag(':memory:'); regel(opslag, { tijd: NU - 8 * DAG });
  const api = nepRapportage({ status: 401 });
  await stuurRegister({ config: cfg(), opslag, fetchFn: api, nu: () => NU });
  let s = exportStatus({ config: cfg(), opslag, nu: NU });
  assert.equal(s.laatste_fout, 'http_401');
  assert.equal(s.oudste_niet_verstuurd_dagen, 8);
  assert.equal(s.alarm, true, '7 dagen achterstand');
  assert.ok(!JSON.stringify(s).includes(SLEUTEL) && !JSON.stringify(s).includes('Wat kost'));
  const opslag2 = openOpslag(':memory:'); regel(opslag2);
  await stuurRegister({ config: cfg(), opslag: opslag2, fetchFn: api, nu: () => NU });
  assert.equal(exportStatus({ config: cfg(), opslag: opslag2, nu: NU }).alarm, false);
  await stuurRegister({ config: cfg(), opslag: opslag2, fetchFn: api, nu: () => NU + DAG });
  s = exportStatus({ config: cfg(), opslag: opslag2, nu: NU + DAG });
  assert.equal(s.mislukte_nachten, 2); assert.equal(s.alarm, true);
  assert.ok(opslag2.db.prepare("SELECT COUNT(*) AS n FROM logboek WHERE soort = 'alarm'").get().n >= 1);
});

test('480 wisregel server: zonder export 30 dagen; met export pas als verstuurd, uiterlijk 35 dagen (geteld)', async () => {
  const zonder = openOpslag(':memory:'); regel(zonder, { tijd: NU - 31 * DAG });
  assert.equal(wisOudeRegels({ config: cfg({ VRAAG_EXPORT: '' }), opslag: zonder, nu: NU }), 1);

  const opslag = openOpslag(':memory:');
  const verstuurd = regel(opslag, { tijd: NU - 31 * DAG - 1000 });
  await stuurRegister({ config: cfg(), opslag, fetchFn: nepRapportage(), nu: () => NU - 31 * DAG + 3 * 3600_000 });
  const nietVerstuurd31 = regel(opslag, { tijd: NU - 31 * DAG });
  // cursor wijst naar 'verstuurd'.
  opslag.zetStaat('export:cursor', { tijd: NU - 31 * DAG - 1000, id: verstuurd });
  wisOudeRegels({ config: cfg(), opslag, nu: NU });
  const over = opslag.db.prepare('SELECT id FROM register').all().map((r) => r.id);
  assert.ok(!over.includes(verstuurd), 'verstuurd en ouder dan 30 dagen: weg');
  assert.ok(over.includes(nietVerstuurd31), 'niet verstuurd, 31 dagen: blijft');

  // Export liep nooit (geen cursor): na 35 dagen toch weg, en geteld.
  const vast = openOpslag(':memory:');
  const r31 = regel(vast, { tijd: NU - 31 * DAG });
  const r36 = regel(vast, { tijd: NU - 36 * DAG });
  wisOudeRegels({ config: cfg(), opslag: vast, nu: NU });
  const rest = vast.db.prepare('SELECT id FROM register').all().map((r) => r.id);
  assert.ok(rest.includes(r31) && !rest.includes(r36));
  assert.equal(vast.db.prepare("SELECT COUNT(*) AS n FROM logboek WHERE tekst LIKE '%na 35 dagen gewist'").get().n, 1);
});

test('480 RV5: één regel wissen op antwoordnummer; logt alleen het nummer', () => {
  const opslag = openOpslag(':memory:');
  const id = regel(opslag, { vraag: 'Mijn naam is Jan, wat kost het?' });
  assert.deepEqual(wisAntwoord(opslag, 'onzin'), { ok: false, reden: 'ongeldig_nummer' });
  assert.deepEqual(wisAntwoord(opslag, id.toLowerCase()), { ok: true, gewist: 1, id });
  assert.equal(opslag.db.prepare('SELECT COUNT(*) AS n FROM register').get().n, 0);
  const log = opslag.db.prepare("SELECT tekst FROM logboek WHERE soort = 'wissen'").all().map((r) => r.tekst).join(' ');
  assert.ok(log.includes(id) && !log.includes('Jan'));
});

test('480 V8a: proefregel bevat geen gegevens van bezoekers en bewijst de verbinding', async () => {
  const api = nepRapportage();
  const r = await stuurProefregel({ config: cfg({ VRAAG_EXPORT: '' }), fetchFn: api, nu: () => NU });
  assert.equal(r.ok, true);
  assert.match(api.verzoeken[0].body.regels[0].id, /^T-PROEF\d+$/);
  assert.ok(api.verzoeken[0].ok);
});

test('480 V7: install.sh zet de export-timer aan, 03:17, vóór de update van 04:37', () => {
  const sh = readFileSync(new URL('../deploy/install.sh', import.meta.url), 'utf8');
  assert.match(sh, /vraag-export\.timer/);
  assert.match(sh, /OnCalendar=\*-\*-\* 03:17:00/);
  assert.match(sh, /systemctl enable --now vraag-export\.timer/);
  assert.match(sh, /src\/beheer\.mjs stuur-register/);
});

test('480 V20.1: ondertekening is HMAC-SHA256 over "label.t.body", met een vast label per richting', () => {
  const kop = onderteken('{"a":1}', SLEUTEL, 1700000000);
  assert.equal(kop, `t=1700000000,v1=${createHmac('sha256', SLEUTEL).update('wg-export-v1.1700000000.{"a":1}').digest('hex')}`);
  const w = onderteken('{"a":1}', SLEUTEL, 1700000000, LABEL_WISLIJST);
  assert.ok(handtekeningGeldig(w, '{"a":1}', SLEUTEL, 1700000000 * 1000));
  assert.ok(!handtekeningGeldig(kop, '{"a":1}', SLEUTEL, 1700000000 * 1000), 'label van de andere richting geweigerd');
  assert.ok(!handtekeningGeldig(w, '{"a":2}', SLEUTEL, 1700000000 * 1000), 'andere body geweigerd');
  assert.ok(!handtekeningGeldig(w, '{"a":1}', SLEUTEL, (1700000000 + 301) * 1000), 'buiten het venster geweigerd');
});

test('480: kiesRegels houdt (tijd, id) als cursor aan, ook bij gelijke tijd', () => {
  const opslag = openOpslag(':memory:');
  const t = NU - 2 * 3600_000;
  regel(opslag, { tijd: t, id: 'T-AAAAA1' }); regel(opslag, { tijd: t, id: 'T-AAAAA2' });
  const na = kiesRegels(opslag.db, { tijd: t, id: 'T-AAAAA1' }, NU);
  assert.deepEqual(na.map((r) => r.id), ['T-AAAAA2']);
});

// ---- 0.4.1: wislijst (V16, V20, H4, H6) ----
// Nagebootst rapportage dat een wislijst teruggeeft, ondertekend met label (standaard wg-wislijst-v1).
function rapportageMetWislijst({ lijst, label = 'wg-wislijst-v1', sleutel = SLEUTEL, tijd = () => Math.floor(NU / 1000), kop = true } = {}) {
  const verzoeken = [];
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    verzoeken.push(body);
    const ruw = JSON.stringify({ ontvangen: body.regels.length, opgeslagen: body.regels.length, al_aanwezig: 0, afgewezen: [], wislijst: lijst });
    const t = tijd();
    const v1 = createHmac('sha256', sleutel).update(`${label}.${t}.${ruw}`).digest('hex');
    return new Response(ruw, { status: 200, headers: kop ? { 'x-wg-handtekening': `t=${t},v1=${v1}` } : {} });
  };
  fn.verzoeken = verzoeken;
  return fn;
}
const NR = (s) => 'V-' + s; // opbouw in de test, zodat er geen los antwoordnummer in de broncode staat
test('480 V16: ondertekende wislijst wist op de vraagserver, ook als de export uit staat; volgende keer gemeld (V20.3)', async () => {
  const opslag = openOpslag(':memory:');
  const a = NR('ABCDEF'); const b = NR('GHJKLM');
  regel(opslag, { id: a }); regel(opslag, { id: b });
  const api = rapportageMetWislijst({ lijst: [{ id: a, datum: '2026-11-15' }] });
  const r = await stuurRegister({ config: cfg({ VRAAG_EXPORT: '' }), opslag, fetchFn: api, nu: () => NU });
  assert.equal(r.gewist, 1);
  const over = opslag.db.prepare('SELECT id FROM register').all().map((x) => x.id);
  assert.deepEqual(over, [b]);
  await stuurRegister({ config: cfg({ VRAAG_EXPORT: '' }), opslag, fetchFn: rapportageMetWislijst({ lijst: [] }), nu: () => NU + 60_000 });
  // tweede run meldt het gewiste nummer, daarna is de meldlijst leeg
  assert.equal(exportStatus({ config: cfg(), opslag, nu: NU }).wislijst.te_melden, 0);
});
test('480 V20.3: de vraagserver meldt welke nummers hij wiste in het eerste verzoek van de volgende run', async () => {
  const opslag = openOpslag(':memory:');
  const a = NR('ABCDEF'); regel(opslag, { id: a });
  await stuurRegister({ config: cfg(), opslag, fetchFn: rapportageMetWislijst({ lijst: [a] }), nu: () => NU });
  const tweede = rapportageMetWislijst({ lijst: [] });
  await stuurRegister({ config: cfg(), opslag, fetchFn: tweede, nu: () => NU + 60_000 });
  assert.deepEqual(tweede.verzoeken[0].gewist, [a]);
});
test('480 H6: niet of verkeerd ondertekende wislijst wordt genegeerd en alleen geteld', async () => {
  for (const variant of [{ kop: false }, { label: 'wg-export-v1' }, { sleutel: 'b'.repeat(64) }, { tijd: () => Math.floor(NU / 1000) - 400 }]) {
    const opslag = openOpslag(':memory:');
    const a = NR('ABCDEF'); regel(opslag, { id: a });
    const r = await stuurRegister({ config: cfg(), opslag, fetchFn: rapportageMetWislijst({ lijst: [a], ...variant }), nu: () => NU });
    assert.equal(r.gewist, 0, JSON.stringify(Object.keys(variant)));
    assert.equal(opslag.db.prepare('SELECT COUNT(*) AS n FROM register').get().n, 1);
    assert.equal(exportStatus({ config: cfg(), opslag, nu: NU }).wislijst.genegeerd, 1);
    const log = opslag.db.prepare("SELECT tekst FROM logboek WHERE soort = 'wissen'").all().map((x) => x.tekst).join(' ');
    assert.ok(!log.includes(a), 'logt alleen aantallen');
  }
});
test('480 V20.2: hooguit 500 nummers, elk op het vaste patroon; de rest overgeslagen en geteld', async () => {
  const opslag = openOpslag(':memory:');
  const lijst = ['onzin', 'X-ABCDEF', NR('ABCDE1'), ...Array.from({ length: 510 }, () => NR('ABCDEF'))];
  const r = await stuurRegister({ config: cfg(), opslag, fetchFn: rapportageMetWislijst({ lijst }), nu: () => NU });
  assert.equal(r.gewist, 0);
  assert.equal(WIS_MAX, 500);
  assert.equal(exportStatus({ config: cfg(), opslag, nu: NU }).wislijst.overgeslagen, 3 + (lijst.length - 500));
});
test('480 V20.2: te groot antwoord wist niets en telt als fout; volgende nacht opnieuw', async () => {
  const opslag = openOpslag(':memory:'); const a = NR('ABCDEF'); regel(opslag, { id: a });
  const groot = async () => new Response('x'.repeat(300 * 1024), { status: 200 });
  const r = await stuurRegister({ config: cfg(), opslag, fetchFn: groot, nu: () => NU, wacht: geenWacht });
  assert.equal(r.fout, 'antwoord_te_groot');
  assert.equal(opslag.db.prepare('SELECT COUNT(*) AS n FROM register').get().n, 1);
});

// ---- 0.4.1: testvragen uit bezoekersvragen alleen op de server (V18, keuze 18.1) ----
test('480 V18.1: servertestset draait mee, /proef toont van die vragen geen tekst', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { laadTestset, verbergServerVragen, SERVER_TESTSET } = await import('../src/proef.mjs');
  const map = mkdtempSync(join(tmpdir(), 'wg-ts-'));
  const basis = laadTestset(map);
  writeFileSync(join(map, SERVER_TESTSET), JSON.stringify({ items: [{ id: 's01', vraag: 'Geheime vraag van een bezoeker', soort: 'feit', verwacht: {} }] }));
  const samen = laadTestset(map);
  assert.equal(samen.items.length, basis.items.length + 1);
  assert.notEqual(samen.versie, basis.versie, 'versie verandert, dus de testset draait opnieuw');
  assert.equal(samen.items.at(-1).server, true);
  const uitslag = { varianten: [{ resultaten: [{ id: 's01', vraag: 'Geheime vraag van een bezoeker', antwoord: 'x', goed: true }, { id: 'f01', vraag: 'Wat kost het?', goed: true }] }] };
  const open = verbergServerVragen(uitslag, new Set(['s01']));
  assert.ok(!JSON.stringify(open).includes('Geheime vraag'));
  assert.deepEqual(open.varianten[0].resultaten[0], { id: 's01', server: true, goed: true });
  assert.equal(open.varianten[0].resultaten[1].vraag, 'Wat kost het?');
});
