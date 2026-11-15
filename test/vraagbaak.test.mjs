// Van begin tot eind met een nagebootste Claude-API (geen echte sleutel, geen kosten).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { laadConfig } from '../src/config.mjs';
import { openOpslag } from '../src/opslag.mjs';
import { maakVraagbaak } from '../src/vraagbaak.mjs';
import { maakServer, maakProef } from '../src/server.mjs';
import { losPuzzelOp } from '../src/beveiliging.mjs';

const kb = JSON.parse(readFileSync(new URL('./fixtures/kennisbank.json', import.meta.url), 'utf8'));
const GOED = { antwoord: 'Je kunt Websitegesprek 3 dagen gratis proberen, zonder betaalgegevens.', bron: 'https://websitegesprek.nl/proberen/', citaat: 'Probeer Websitegesprek 3 dagen gratis' };
const OORDEEL_GOED = { juist: true, gegrond: true, beantwoordt: true, toezegging: false, helder: true, toelichting: '' };

// Nagebootste API: antwoorden met citations (besluit 447) en oordelen van de beoordelaar (besluit 448).
function nepApi({ uitvoer = GOED, status = 200, fout = null, oordeel = OORDEEL_GOED, usage = { input_tokens: 50, cache_creation_input_tokens: 4000, output_tokens: 80 } } = {}) {
  const aanroepen = [];
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    aanroepen.push({ url, body, headers: opts.headers });
    let data;
    if (status !== 200) data = { error: { type: fout || 'api_error', message: fout || 'x' } };
    else if (body.output_config?.format) data = { content: [{ type: 'text', text: JSON.stringify(oordeel) }], usage, model: body.model, stop_reason: 'end_turn' };
    else data = { content: [{ type: 'text', text: uitvoer.antwoord, citations: uitvoer.bron ? [{ type: 'search_result_location', source: uitvoer.bron, title: 't', cited_text: uitvoer.citaat, search_result_index: 0, start_block_index: 0, end_block_index: 1 }] : [] }], usage, model: 'claude-haiku-5-5', stop_reason: 'end_turn' };
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.aanroepen = aanroepen;
  fn.vraagbaakAanroepen = () => aanroepen.filter((x) => !x.body.output_config?.format);
  return fn;
}

function opzet(env = {}, api = nepApi()) {
  const config = laadConfig({ VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:', VRAAG_PUZZEL_BITS: '4', ...env });
  const opslag = openOpslag(':memory:');
  const vb = maakVraagbaak({ config, opslag, fetchFn: api });
  vb.zetKennisbank(kb, true);
  return { config, opslag, vb, api };
}

function gesprek(vb, ip = '10.0.0.1') {
  const p = vb.puzzel({ ip });
  const t = vb.token({ ip, uitdaging: p.uitdaging, oplossing: losPuzzelOp(p.uitdaging, p.bits) });
  assert.ok(t.token, JSON.stringify(t));
  return t;
}

test('standaard (auto): uit tot de schakelaar op de site aan staat én de testset geslaagd is', async () => {
  let siteHtml = '<html><div id="wg-vraag-blok" data-aan="0" hidden></div></html>';
  const api = nepApi();
  const fetchFn = async (url, opts) => (String(url).startsWith('https://websitegesprek.nl') ? new Response(siteHtml, { status: 200 }) : api(url, opts));
  const { vb, opslag } = opzet({ VRAAG_ACTIEF: '' }, fetchFn);
  assert.equal(vb.status().reden, 'schakelaar_site_uit');
  await vb.leesSchakelaar();
  assert.equal(vb.status().reden, 'schakelaar_site_uit');
  siteHtml = '<html><div id="wg-vraag-blok" data-aan="1"></div></html>';
  await vb.leesSchakelaar();
  assert.equal(vb.status().reden, 'testset_niet_geslaagd');
  const { INSTRUCTIE_VERSIE } = await import('../src/instructie.mjs');
  opslag.zetStaat('proef:volledig', { geslaagd: true, model: 'claude-haiku-5-5', instructie: INSTRUCTIE_VERSIE });
  assert.equal(vb.status().aan, true);
  opslag.zetStaat('proef:volledig', { geslaagd: true, model: 'claude-sonnet-5-5', instructie: INSTRUCTIE_VERSIE });
  assert.equal(vb.status().reden, 'testset_niet_geslaagd', 'testset voor een ander model telt niet');
  opslag.zetStaat('proef:volledig', { geslaagd: true, model: 'claude-haiku-5-5', instructie: INSTRUCTIE_VERSIE });
  // Site onbereikbaar of botcontrole: vorige stand blijft; na 2 uur zonder bevestiging uit.
  siteHtml = '<html><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/"></html>';
  assert.equal((await vb.leesSchakelaar()).ok, false);
  assert.equal(vb.status().aan, true);
  opslag.zetStaat('site:aan', { aan: true, tijd: Date.now() - 3 * 3_600_000 });
  assert.equal(vb.status().reden, 'schakelaar_site_uit');
});

test('VRAAG_ACTIEF=0 is altijd uit', async () => {
  const { vb } = opzet({ VRAAG_ACTIEF: '0' });
  const t = gesprek(vb);
  assert.equal(t.aan, false);
  const r = await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Hoi' });
  assert.equal(r.uit, true);
});

test('vraag → antwoord met bron en antwoord-ID; instructie, cache en geo in de aanroep', async () => {
  const { vb, api, opslag } = opzet();
  const t = gesprek(vb);
  assert.equal(t.aan, true);
  assert.ok(t.v1.nl.includes('AI-assistent'));
  const r = await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Hoe lang kan ik proberen? Mail me op jan@x.nl', pagina: 'https://websitegesprek.nl/start/' });
  assert.equal(r.antwoord, GOED.antwoord);
  assert.equal(r.bron, 'https://websitegesprek.nl/proberen/');
  assert.match(r.id, /^V-/);
  const body = api.aanroepen[0].body;
  assert.equal(body.inference_geo, 'us');
  assert.equal(body.system.length, 1);
  assert.equal(body.system[0].cache_control?.type, 'ephemeral');
  // Besluit 447: de pagina's als search_result-blokken met citations, laatste blok in de cache.
  const bronnen = body.messages[0].content.filter((b) => b.type === 'search_result');
  assert.equal(bronnen.length, kb.paginas.length + (kb.algemeen ? 1 : 0));
  assert.ok(bronnen.every((b) => b.citations?.enabled === true));
  assert.equal(bronnen.at(-1).cache_control?.type, 'ephemeral');
  assert.ok(!('output_config' in body && body.output_config.format), 'citations en structured outputs gaan niet samen');
  assert.ok(!('tools' in body));
  assert.ok(!JSON.stringify(body.messages).includes('jan@x.nl'), 'persoonsgegevens weg vóór de API');
  const reg = opslag.db.prepare('SELECT * FROM register WHERE id = ?').get(r.id);
  assert.equal(reg.pagina, '/start/');
  assert.ok(!JSON.stringify(reg).includes('10.0.0.1'));
  assert.ok(reg.kosten_milli_cent > 0);
});

test('geschiedenis staat op de server; de browser stuurt alleen de nieuwe vraag', async () => {
  const { vb, api } = opzet();
  const t = gesprek(vb);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Eerste vraag' });
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Tweede vraag' });
  const m = api.aanroepen[1].body.messages;
  assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
  assert.equal(m[1].content, GOED.antwoord);
});

test('foute modeluitvoer wordt vervangen door de doorverwijzing', async () => {
  const { vb } = opzet({}, nepApi({ uitvoer: { ...GOED, antwoord: 'Je krijgt 50% korting!' } }));
  const t = gesprek(vb);
  const r = await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Korting?' });
  assert.equal(r.doorverwezen, true);
  assert.match(r.antwoord, /WhatsApp/);
});

test('token: ander IP, verkeerde puzzel en hergebruik geweigerd', async () => {
  const { vb } = opzet();
  const p = vb.puzzel({ ip: '10.0.0.1' });
  const o = losPuzzelOp(p.uitdaging, p.bits);
  assert.ok(vb.token({ ip: '10.0.0.2', uitdaging: p.uitdaging, oplossing: o }).fout);
  assert.ok(vb.token({ ip: '10.0.0.1', uitdaging: p.uitdaging, oplossing: o }).token);
  assert.equal(vb.token({ ip: '10.0.0.1', uitdaging: p.uitdaging, oplossing: o }).fout, 'puzzel_hergebruikt');
  const t = gesprek(vb, '10.0.0.3');
  const r = await vb.vraag({ ip: '10.0.0.4', tokenWaarde: t.token, vraagTekst: 'x' });
  assert.equal(r.status, 401);
});

test('grenzen: lengte, per gesprek en dagplafond (vanzelf weer aan)', async () => {
  const { vb, opslag } = opzet({ VRAAG_PER_TOKEN: '2', VRAAG_PLAFOND_DAG: '0.0001' });
  const t = gesprek(vb);
  assert.equal((await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'x'.repeat(501) })).status, 413);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'a' });
  const s = vb.status();
  assert.equal(s.aan, false);
  assert.equal(s.reden, 'dagplafond');
  assert.equal(s.tijdelijk, true);
  assert.equal(opslag.staat('uit', null), null, 'plafond is tijdelijk, geen blijvende uit-stand');
  const r = await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'b' });
  assert.equal(r.reden, 'even_niet');
});

test('sleutelfout zet de vraagbaak blijvend uit tot akkoord', async () => {
  const { vb } = opzet({}, nepApi({ status: 401, fout: 'authentication_error' }));
  const t = gesprek(vb);
  const r = await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Hoi' });
  assert.equal(r.doorverwezen, true);
  assert.deepEqual([vb.status().aan, vb.status().reden], [false, 'sleutelfout']);
  vb.zetAan();
  assert.equal(vb.status().aan, true);
});

test('veel API-fouten → uit (foutpercentage)', async () => {
  const { vb } = opzet({ VRAAG_PER_TOKEN: '100' }, nepApi({ status: 500 }));
  const t = gesprek(vb);
  for (let i = 0; i < 10; i++) await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'v' + i });
  assert.equal(vb.status().reden, 'foutpercentage');
});

test('kennisbank: grote wijziging of te klein wordt niet actief', async () => {
  const { vb } = opzet();
  const groot = { ...kb, versie: 'groot0000001', paginas: [...kb.paginas, ...kb.paginas.map((p) => ({ ...p, url: p.url + 'x/' }))] };
  assert.equal((await vb.ververs({ bouw: async () => groot })).reden, 'grote_wijziging');
  assert.equal(vb.kb.versie, kb.versie);
  assert.equal((await vb.ververs({ bouw: async () => ({ versie: 'klein', algemeen: '', paginas: [] }) })).reden, 'te_klein');
  assert.equal((await vb.ververs({ bouw: async () => { throw new Error('sgcaptcha'); } })).reden, 'ophalen');
  const klein = { ...kb, versie: 'kleinwijz001', paginas: kb.paginas.map((p, i) => (i === 0 ? { ...p, tekst: p.tekst + '\nNieuwe zin.' } : p)) };
  assert.equal((await vb.ververs({ bouw: async () => klein })).ok, true);
  assert.equal(vb.kb.versie, 'kleinwijz001');
});

test('HTTP: herkomst verplicht, CORS, healthz zonder sleutel, venster.js', async () => {
  const api = nepApi();
  const env = { VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-geheim-' + 'y'.repeat(30), VRAAG_DATA_DIR: ':memory:', VRAAG_PUZZEL_BITS: '4' };
  const app = maakServer({ env, fetchFn: api });
  app.vraagbaak.zetKennisbank(kb, true);
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const basis = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const h = await (await fetch(basis + '/healthz')).json();
    assert.equal(h.ok, true); assert.equal(h.sleutel_gezet, true); assert.equal(h.aan, true);
    assert.ok(!JSON.stringify(h).includes('sk-ant'));
    const zonder = await fetch(basis + '/v1/puzzel', { method: 'POST', body: '{}' });
    assert.equal(zonder.status, 403);
    const vreemd = await fetch(basis + '/v1/puzzel', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
    assert.equal(vreemd.status, 403);
    const O = { origin: 'https://websitegesprek.nl', 'content-type': 'application/json' };
    const pre = await fetch(basis + '/v1/vraag', { method: 'OPTIONS', headers: O });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://websitegesprek.nl');
    const p = await (await fetch(basis + '/v1/puzzel', { method: 'POST', body: '{}', headers: O })).json();
    const t = await (await fetch(basis + '/v1/token', { method: 'POST', headers: O, body: JSON.stringify({ uitdaging: p.uitdaging, oplossing: losPuzzelOp(p.uitdaging, p.bits) }) })).json();
    const v = await (await fetch(basis + '/v1/vraag', { method: 'POST', headers: O, body: JSON.stringify({ token: t.token, vraag: 'Hoe lang proberen?' }) })).json();
    assert.equal(v.bron, 'https://websitegesprek.nl/proberen/');
    const groot = await fetch(basis + '/v1/vraag', { method: 'POST', headers: O, body: JSON.stringify({ token: t.token, vraag: 'x'.repeat(5000) }) });
    assert.equal(groot.status, 413);
    const js = await fetch(basis + '/v1/venster.js');
    assert.match(js.headers.get('content-type'), /javascript/);
  } finally {
    app.server.close();
  }
});

test('proef met kandidaat-kennisbank: 10 feitvragen, apart van de live opslag', async () => {
  const api = nepApi();
  const config = laadConfig({ VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:' });
  const u = await maakProef({ config, fetchFn: api })(kb);
  assert.equal(u.totaal, 10);
  assert.equal(api.vraagbaakAanroepen().length, 10);
  assert.equal(api.aanroepen.length, 20, 'elk antwoord één oordeel van de beoordelaar');
  assert.equal(u.ok, true, 'alle oordelen goed → geslaagd');
  const api2 = nepApi({ oordeel: { ...OORDEEL_GOED, beantwoordt: false } });
  assert.equal((await maakProef({ config, fetchFn: api2 })(kb)).ok, false, 'beantwoordt de vraag niet → niet geslaagd');
});

test('besluit 409: microfoon voor bezoekers standaard uit, aan met VRAAG_SPRAAK=1', () => {
  assert.equal(gesprek(opzet().vb).spraak, false);
  assert.equal(gesprek(opzet({ VRAAG_SPRAAK: '1' }).vb).spraak, true);
});

test('VA3: tellers met een IP-code verlopen binnen 24 uur en de opslag wist ze echt', async () => {
  const { IP_DAG } = await import('../src/vraagbaak.mjs');
  assert.ok(IP_DAG + 5 * 60_000 < 24 * 3_600_000, 'teller + opruimritme blijft onder 24 uur');
  const { opslag, vb } = opzet();
  const t = gesprek(vb);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Wat kost Websitegesprek?', pagina: 'https://websitegesprek.nl/' });
  const rijen = opslag.db.prepare("SELECT sleutel, verloopt FROM teller WHERE sleutel LIKE '%ip%'").all();
  assert.ok(rijen.length > 0);
  for (const r of rijen) assert.ok(r.verloopt - Date.now() < 24 * 3_600_000 - 5 * 60_000, r.sleutel);
  assert.equal(opslag.db.prepare('PRAGMA secure_delete').get().secure_delete, 1);
  const server = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /setInterval\(\(\) => opslag\.opruimen\(config\.registerDagen\), 5 \* 60_000\)/);
  const register = opslag.db.prepare('SELECT * FROM register').all();
  for (const r of register) assert.ok(!JSON.stringify(r).includes('10.0.0.1'));
});

test('besluit 443: proef stopt bij de eerste API-fout en toont foutsoort, zonder sleutel', async () => {
  const api = nepApi({ status: 400, fout: 'invalid_request_error' });
  const config = laadConfig({ VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:' });
  const u = await maakProef({ config, fetchFn: api, volledig: true, herhaal: 3 })(kb);
  assert.equal(api.aanroepen.length, 1, 'na de eerste fout geen verdere aanroepen');
  assert.equal(u.ok, false);
  assert.equal(u.apiFout.soort, 'overig');
  assert.equal(u.apiFout.status, 400);
  assert.match(u.fout, /^api_overig 400 invalid_request_error/);
  assert.doesNotMatch(JSON.stringify(u), /sk-ant-test/);
});

test('besluit 443: foutmelding van Anthropic wordt ingekort en een sleutel erin weggehaald', async () => {
  const { veiligeUitleg } = await import('../src/claude.mjs');
  assert.equal(veiligeUitleg('bad key sk-ant-api03-abcDEF_123 here'), 'bad key [sleutel] here');
  assert.equal(veiligeUitleg('x'.repeat(500)).length, 200);
});

test('besluit 443: bezoeker krijgt bij een API-fout geen foutdetails', async () => {
  const { vb } = opzet({}, nepApi({ status: 400, fout: 'invalid_request_error' }));
  const t = gesprek(vb);
  const r = await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Hoi' });
  assert.equal(r.doorverwezen, true);
  assert.equal(r.apiFout.status, 400, 'intern beschikbaar voor de proef');
});

test('besluit 443: geen temperature in de aanroep (Haiku 5.5 weigert die met een 400)', async () => {
  const { vb, api } = opzet();
  const t = gesprek(vb);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Hoi' });
  assert.equal('temperature' in api.aanroepen[0].body, false);
});

test('besluit 443: reden van vervangen zichtbaar in de proef, nooit voor de bezoeker', async () => {
  const api = nepApi({ uitvoer: { ...GOED, bron: 'https://elders.nl/' } });
  const config = laadConfig({ VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:' });
  const u = await maakProef({ config, fetchFn: api, aantal: 1 })(kb);
  assert.equal(u.uitslag[0].details[0].diag.reden, 'bron_onbekend');
});

test('besluit 447: nadenken low (adaptief, effort low, ruim max_tokens) of uit', async () => {
  const { vb, api } = opzet();
  const t = gesprek(vb);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Hoi' });
  const b = api.aanroepen[0].body;
  assert.deepEqual(b.thinking, { type: 'adaptive' });
  assert.equal(b.output_config.effort, 'low');
  assert.ok(b.max_tokens >= 4000);
  const { vb: vb2, api: api2 } = opzet({ VRAAG_DENKEN: 'uit' });
  const t2 = gesprek(vb2);
  await vb2.vraag({ ip: '10.0.0.1', tokenWaarde: t2.token, vraagTekst: 'Hoi' });
  assert.deepEqual(api2.aanroepen[0].body.thinking, { type: 'disabled' });
  assert.equal('output_config' in api2.aanroepen[0].body, false, 'geen effort boven high, anders weigert de API denken uit');
});

test('besluit 447: kiesVariant kiest de geslaagde variant met de meeste goed, bij gelijkspel de snelste', async () => {
  const { kiesVariant } = await import('../src/server.mjs');
  assert.equal(kiesVariant({ low: { geslaagd: true, goed: 48, gemDuurMs: 3000 }, uit: { geslaagd: true, goed: 48, gemDuurMs: 1500 } }), 'uit');
  assert.equal(kiesVariant({ low: { geslaagd: true, goed: 49, gemDuurMs: 3000 }, uit: { geslaagd: true, goed: 48, gemDuurMs: 1500 } }), 'low');
  assert.equal(kiesVariant({ low: { geslaagd: true, goed: 46, gemDuurMs: 3000 }, uit: { geslaagd: false, goed: 50, gemDuurMs: 1500 } }), 'low');
  assert.equal(kiesVariant({ low: { fout: 'x' }, uit: { fout: 'y' } }), null);
});

test('besluit 448: proef gebruikt de beoordelaar met vast model, structured outputs en geo us', async () => {
  const api = nepApi({ oordeel: { ...OORDEEL_GOED, gegrond: false, toelichting: 'verzonnen' } });
  const config = laadConfig({ VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:' });
  const u = await maakProef({ config, fetchFn: api, aantal: 2 })(kb);
  const oordelen = api.aanroepen.filter((x) => x.body.output_config?.format);
  assert.equal(oordelen.length, 2);
  assert.equal(oordelen[0].body.model, 'claude-sonnet-5-5');
  assert.equal(oordelen[0].body.inference_geo, 'us');
  assert.equal(u.goed, 0, 'niet gegrond telt als fout');
  assert.match(u.uitslag[0].details[0].fouten.join(), /niet gegrond/);
});

test('421 (Juridisch): testmodus houdt het register; bij de eerste keer live wordt het één keer leeggemaakt', async () => {
  let siteHtml = '<html><div id="wg-vraag-blok" data-aan="1" data-zichtbaar="test"></div></html>';
  const api = nepApi();
  const fetchFn = async (url, opts) => (String(url).startsWith('https://websitegesprek.nl') ? new Response(siteHtml, { status: 200 }) : api(url, opts));
  const { vb, opslag } = opzet({}, fetchFn);
  await vb.leesSchakelaar();
  assert.equal(vb.gezondheid().testmodus, true);
  const t = gesprek(vb);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t.token, vraagTekst: 'Testvraag', pagina: 'https://websitegesprek.nl/' });
  assert.equal(vb.gezondheid().vragen_24u, 1);
  await vb.leesSchakelaar();
  assert.equal(vb.gezondheid().vragen_24u, 1, 'in testmodus blijft het register staan');
  siteHtml = '<html><div id="wg-vraag-blok" data-aan="1"></div></html>';
  await vb.leesSchakelaar();
  assert.equal(vb.gezondheid().vragen_24u, 0, 'bij livegang leeg');
  assert.ok(vb.gezondheid().register_gewist_bij_live);
  const t2 = gesprek(vb);
  await vb.vraag({ ip: '10.0.0.1', tokenWaarde: t2.token, vraagTekst: 'Eerste echte vraag', pagina: 'https://websitegesprek.nl/' });
  await vb.leesSchakelaar();
  assert.equal(vb.gezondheid().vragen_24u, 1, 'daarna niet nog eens wissen');
  assert.ok(!JSON.stringify(vb.gezondheid()).includes('Testvraag'), 'healthz toont nooit inhoud');
  assert.ok(opslag);
});
