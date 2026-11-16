// Besluit 546.1: testpoort met goedkeuringsbestand (blauw-groen). Nagebootste API, geen sleutel, geen kosten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { laadConfig } from '../src/config.mjs';
import {
  ANTWOORD_BESTANDEN, OVERIGE_BESTANDEN, alleSrcBestanden, poortSleutel, uitkomstVan, volledigeTestset, testGrens,
  leesGoedkeuring, leesPoortStand, NIEUWE_VERSIE,
} from '../src/proef.mjs';
import { maakServer } from '../src/server.mjs';
import { PRIJZEN } from '../src/config.mjs';

const kb = JSON.parse(readFileSync(new URL('./fixtures/kennisbank.json', import.meta.url), 'utf8'));
const basisEnv = { VRAAG_DATA_DIR: ':memory:' };

function nepApi({ status = 200 } = {}) {
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    let data;
    if (status !== 200) data = { error: { type: 'api_error', message: 'x' } };
    else if (body.output_config?.format) data = { content: [{ type: 'text', text: JSON.stringify({ juist: true, gegrond: true, beantwoordt: true, toezegging: false, helder: true, toelichting: '' }) }], usage: { input_tokens: 10, output_tokens: 10 } };
    else data = { content: [{ type: 'text', text: 'Je kunt Websitegesprek 3 dagen gratis proberen.', citations: [{ type: 'search_result_location', source: 'https://websitegesprek.nl/proberen/', title: 't', cited_text: 'Probeer Websitegesprek 3 dagen gratis', search_result_index: 0, start_block_index: 0, end_block_index: 1 }] }], usage: { input_tokens: 50, output_tokens: 80 }, model: body.model, stop_reason: 'end_turn' };
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  };
  return fn;
}

test('V2 (546): elk bestand onder src, van elk type en in submappen, staat in precies één lijst', () => {
  const alle = alleSrcBestanden();
  for (const f of alle) {
    const n = Number(ANTWOORD_BESTANDEN.includes(f)) + Number(OVERIGE_BESTANDEN.includes(f));
    assert.equal(n, 1, `${f} staat in ${n} lijsten; kies ANTWOORD_BESTANDEN of OVERIGE_BESTANDEN in src/proef.mjs`);
  }
  for (const f of [...ANTWOORD_BESTANDEN, ...OVERIGE_BESTANDEN]) assert.ok(alle.includes(f), `${f} bestaat niet meer`);
});

test('V1 (546): sleutel verandert bij instellingen en antwoordcode, niet bij doorsturen.mjs', () => {
  const s0 = poortSleutel(laadConfig(basisEnv));
  assert.notEqual(poortSleutel(laadConfig({ ...basisEnv, VRAAG_MAX_UITVOER: '900' })), s0, 'VRAAG_MAX_UITVOER');
  assert.notEqual(poortSleutel(laadConfig({ ...basisEnv, VRAAG_BEOORDELAAR_MODEL: 'claude-sonnet-5-5' })), s0, 'VRAAG_BEOORDELAAR_MODEL');
  assert.notEqual(poortSleutel(laadConfig({ ...basisEnv, VRAAG_DENKEN: 'uit' })), s0, 'VRAAG_DENKEN');
  assert.equal(poortSleutel(laadConfig({ ...basisEnv, ANTHROPIC_API_KEY: 'sk-ant-test-' + 'y'.repeat(30), VRAAG_BEHEER_SLEUTEL: 'z' })), s0, 'geheimen niet in de sleutel (W2)');
  // Kopie van de repository: doorsturen.mjs wijzigen laat de sleutel gelijk, instructie.mjs wijzigen niet.
  const map = mkdtempSync(join(tmpdir(), 'poort-'));
  cpSync(new URL('../src', import.meta.url).pathname, join(map, 'src'), { recursive: true });
  cpSync(new URL('../testset', import.meta.url).pathname, join(map, 'testset'), { recursive: true });
  const srcMap = pathToFileURL(join(map, 'src') + '/');
  const config = laadConfig(basisEnv);
  const k0 = poortSleutel(config, { srcMap });
  assert.equal(k0, s0);
  writeFileSync(join(map, 'src', 'doorsturen.mjs'), readFileSync(join(map, 'src', 'doorsturen.mjs'), 'utf8') + '\n// wijziging\n');
  assert.equal(poortSleutel(config, { srcMap }), k0, 'doorsturen.mjs raakt de antwoorden niet');
  writeFileSync(join(map, 'src', 'instructie.mjs'), readFileSync(join(map, 'src', 'instructie.mjs'), 'utf8') + '\n// wijziging\n');
  assert.notEqual(poortSleutel(config, { srcMap }), k0, 'instructie.mjs raakt de antwoorden wel');
});

test('V3 (546): server.mjs definieert geen onderdelen van de testpoort zelf', () => {
  const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  for (const naam of ['maakProef', 'kiesVariant', 'poortSleutel', 'volledigeTestset', 'combinaties', 'uitkomstVan', 'testGrens', 'codeVingerafdruk'])
    assert.ok(!new RegExp(`function\\s+${naam}\\b`).test(src), `server.mjs definieert ${naam}`);
  assert.ok(!/herhaal:\s*3/.test(src), 'aantal herhalingen staat in proef.mjs');
});

test('V14: modelnamen zijn vaste versies met een prijs, geen verwijzing zoals -latest', () => {
  const c = laadConfig({});
  for (const m of [c.model, ...c.testModellen, c.terugvalModel, c.beoordelaarModel]) {
    assert.ok(!/latest$/i.test(m), `${m} is een verwijzing`);
    assert.ok(PRIJZEN[m], `${m} heeft geen vaste prijs in config.mjs`);
  }
});

test('W5 en V13: uitkomst geslaagd, gezakt (inhoudelijk of kostengrens) of fout (technisch)', () => {
  const g = { model: 'claude-sonnet-5-5', denken: 'low', geslaagd: true, goed: 50, gemDuurMs: 1 };
  const z = { model: 'claude-haiku-5-5', denken: 'low', geslaagd: false, goed: 40, gemDuurMs: 1 };
  const f = { model: 'claude-sonnet-5-5', denken: 'uit', geslaagd: false, fout: 'api_overig 500' };
  assert.equal(uitkomstVan({ a: g, b: z }).uitkomst, 'geslaagd');
  assert.deepEqual(uitkomstVan({ a: z }), { uitkomst: 'gezakt', reden: 'inhoudelijk' });
  assert.deepEqual(uitkomstVan({ a: z, b: f }), { uitkomst: 'fout', reden: 'technisch' });
  assert.deepEqual(uitkomstVan({ a: z, b: f }, { grensBereikt: true }), { uitkomst: 'gezakt', reden: 'kostengrens_test' });
});

test('V13: een testrun die de grens bereikt, stopt en geeft gezakt (kostengrens_test)', async () => {
  const config = laadConfig({ ...basisEnv, ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30) });
  const g = testGrens(config);
  assert.ok(g.maxVragen > 0 && g.maxEuro === 5);
  let aanroepen = 0;
  const api = nepApi(); const tel = async (u, o) => { aanroepen++; return api(u, o); };
  const u = await volledigeTestset({ config, kb, fetchFn: tel, grens: { maxVragen: 3, maxEuro: 5 } });
  assert.deepEqual([u.uitkomst, u.reden], ['gezakt', 'kostengrens_test']);
  assert.ok(aanroepen < 40, `te veel aanroepen na de grens: ${aanroepen}`);
  const fout = await volledigeTestset({ config, kb, fetchFn: nepApi({ status: 500 }) });
  assert.equal(fout.uitkomst, 'fout', 'API-fout = technisch, geen gezakt');
});

function server(env = {}) {
  const map = mkdtempSync(join(tmpdir(), 'gk-'));
  mkdirSync(join(map, 'poort'));
  const e = { VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:', VRAAG_PUZZEL_BITS: '4', VRAAG_GOEDKEURING: join(map, 'goedkeuring.json'), VRAAG_POORT: join(map, 'poort'), ...env };
  const app = maakServer({ env: e, fetchFn: nepApi() });
  app.vraagbaak.zetKennisbank(kb, true);
  return { app, map, sleutel: poortSleutel(app.config) };
}

test('W1, W2, W11, T4: healthz leest goedkeuring en poort; ongetest bij ontbrekend of afwijkend bestand; "aan": één keer', async () => {
  const { app, map, sleutel } = server();
  const h = () => JSON.parse(JSON.stringify({ ok: true, ...app.vraagbaak.gezondheid() }));
  assert.deepEqual([h().nieuwe_versie, h().bewaking], ['ongetest', 'storing'], 'geen goedkeuringsbestand');
  writeFileSync(join(map, 'goedkeuring.json'), JSON.stringify({ sleutel: 'anders', geslaagd: true, gekozenModel: 'claude-haiku-5-5', gekozen: 'low' }));
  assert.deepEqual([h().nieuwe_versie, h().bewaking], ['ongetest', 'storing'], 'W2: andere sleutel (bijv. na wijziging vraag.env)');
  writeFileSync(join(map, 'goedkeuring.json'), JSON.stringify({ sleutel, geslaagd: true, gekozenModel: 'claude-haiku-5-5', gekozen: 'low' }));
  assert.deepEqual([h().nieuwe_versie, h().bewaking, h().aan], ['geen', 'ok', true]);
  for (const s of ['bezig', 'live', 'gezakt']) {
    writeFileSync(join(map, 'poort', 'stand.json'), JSON.stringify({ nieuwe_versie: s }));
    assert.equal(h().nieuwe_versie, s);
    assert.equal(h().bewaking, 'ok', `'${s}' is geen storing`);
  }
  writeFileSync(join(map, 'poort', 'stand.json'), JSON.stringify({ nieuwe_versie: 'iets<script>' }));
  assert.equal(h().nieuwe_versie, 'geen', 'alleen vaste woorden');
  assert.ok(NIEUWE_VERSIE.includes(h().nieuwe_versie) && ['ok', 'storing'].includes(h().bewaking));
  const tekst = JSON.stringify({ ok: true, versie: 'x', ...app.vraagbaak.gezondheid() });
  assert.equal(tekst.split('"aan":').length - 1, 1, 'T4: "aan": precies één keer in /healthz');
  assert.equal(leesGoedkeuring(join(map, 'bestaat-niet.json')), null);
  assert.equal(leesPoortStand(join(map, 'bestaat-niet')).nieuwe_versie, 'geen');
});

test('W1: model en variant van een vraag komen uit het goedkeuringsbestand', async () => {
  const aanroepen = [];
  const api = nepApi();
  const { map, sleutel } = server();
  writeFileSync(join(map, 'goedkeuring.json'), JSON.stringify({ sleutel, geslaagd: true, gekozenModel: 'claude-haiku-5-5', gekozen: 'low' }));
  const e = { VRAAG_ACTIEF: '1', ANTHROPIC_API_KEY: 'sk-ant-test-' + 'x'.repeat(30), VRAAG_DATA_DIR: ':memory:', VRAAG_PUZZEL_BITS: '4', VRAAG_GOEDKEURING: join(map, 'goedkeuring.json'), VRAAG_POORT: join(map, 'poort') };
  const app = maakServer({ env: e, fetchFn: async (u, o) => { aanroepen.push(JSON.parse(o.body)); return api(u, o); } });
  app.vraagbaak.zetKennisbank(kb, true);
  const { losPuzzelOp } = await import('../src/beveiliging.mjs');
  const p = app.vraagbaak.puzzel({ ip: '10.0.0.9' });
  const t = app.vraagbaak.token({ ip: '10.0.0.9', uitdaging: p.uitdaging, oplossing: losPuzzelOp(p.uitdaging, p.bits) });
  await app.vraagbaak.vraag({ ip: '10.0.0.9', tokenWaarde: t.token, vraagTekst: 'Kan ik het eerst proberen?', pagina: 'https://websitegesprek.nl/' });
  assert.equal(aanroepen.at(-1).model, 'claude-haiku-5-5');
  const src = readFileSync(new URL('../src/vraagbaak.mjs', import.meta.url), 'utf8');
  assert.ok(!src.includes("'proef:volledig'"), 'W1: niet meer uit proef:volledig in vraagdata');
});
