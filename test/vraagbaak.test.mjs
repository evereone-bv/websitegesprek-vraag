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
const GOED = { antwoord: 'Je kunt Websitegesprek 3 dagen gratis proberen, zonder betaalgegevens.', bron_url: 'https://websitegesprek.nl/proberen/', citaat: 'Probeer Websitegesprek 3 dagen gratis , zonder betaalgegevens.', onderwerp: 'proef', zeker: true, buiten_onderwerp: false };

function nepApi({ uitvoer = GOED, status = 200, fout = null, usage = { input_tokens: 50, cache_creation_input_tokens: 4000, output_tokens: 80 } } = {}) {
  const aanroepen = [];
  const fn = async (url, opts) => {
    aanroepen.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    const data = status === 200 ? { content: [{ type: 'text', text: JSON.stringify(uitvoer) }], usage, model: 'claude-haiku-5-5' } : { error: { type: fout || 'api_error', message: fout || 'x' } };
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.aanroepen = aanroepen;
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
  assert.equal(body.system.length, 2);
  assert.ok(body.system.every((b) => b.cache_control?.type === 'ephemeral'));
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
  const { vb } = opzet({}, nepApi({ uitvoer: { ...GOED, antwoord: 'Je krijgt 50% korting!', citaat: '', onderwerp: 'prijs' } }));
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
  assert.equal(api.aanroepen.length, 10);
  assert.equal(u.ok, false, 'een api die altijd hetzelfde zegt, haalt de proef niet');
});

test('besluit 409: microfoon voor bezoekers standaard uit, aan met VRAAG_SPRAAK=1', () => {
  assert.equal(gesprek(opzet().vb).spraak, false);
  assert.equal(gesprek(opzet({ VRAAG_SPRAAK: '1' }).vb).spraak, true);
});
