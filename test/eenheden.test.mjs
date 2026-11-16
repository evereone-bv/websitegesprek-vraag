import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlNaarTekst, ontdubbel, padToegestaan, kennisbankAlsTekst, vindPagina } from '../src/kennisbank.mjs';
import { controleer, getallenMetEenheid } from '../src/controle.mjs';
import { schoonOp, taal } from '../src/schoon.mjs';
import { maakPuzzel, losPuzzelOp, controleerPuzzel, ipHash, antwoordId, herkomstToegestaan } from '../src/beveiliging.mjs';
import { kostenDollar } from '../src/config.mjs';
import { beoordeel, laadTestset } from '../src/proef.mjs';

const kb = JSON.parse(readFileSync(new URL('./fixtures/kennisbank.json', import.meta.url), 'utf8'));
const kbTekst = kennisbankAlsTekst(kb);

test('html naar tekst: scripts, stijl, formulieren en cookiemelding weg', () => {
  const { titel, tekst } = htmlNaarTekst('<html><head><title>T &amp; co</title><style>x{}</style></head><body><script>alert(1)</script><h2>Prijs</h2><p>€ 4,95&nbsp;per maand</p><div class="cmplz-cookiebanner">cookies</div><form><input></form></body></html>');
  assert.equal(titel, 'T & co');
  assert.match(tekst, /## Prijs/);
  assert.match(tekst, /€ 4,95 per maand/);
  assert.ok(!/alert|cookies|x\{\}/.test(tekst));
});

test('ontdubbelen haalt menu en footer naar algemeen', () => {
  const p = (u, extra) => ({ url: u, titel: u, tekst: `Menu\nFooter\n${extra}` });
  const r = ontdubbel([p('a', 'A'), p('b', 'B'), p('c', 'C')]);
  assert.match(r.algemeen, /Menu/);
  assert.equal(r.paginas[0].tekst, 'A');
});

test('alleen vaste adressen op websitegesprek.nl', () => {
  assert.equal(padToegestaan('https://websitegesprek.nl/start/'), true);
  assert.equal(padToegestaan('http://websitegesprek.nl/'), false);
  assert.equal(padToegestaan('https://evil.example/'), false);
  assert.equal(padToegestaan('https://websitegesprek.nl/bedankt/'), false);
  assert.equal(padToegestaan('https://websitegesprek.nl/?p=1'), false);
});

test('getallen met eenheid worden genormaliseerd', () => {
  const g = getallenMetEenheid('Vanaf € 14,95 per maand, 3 dagen gratis en 49 euro eenmalig.');
  assert.ok(g.has('€14.95'));
  assert.ok(g.has('3 dag'));
  assert.ok(g.has('€49'));
  assert.ok(getallenMetEenheid('€14,95').has('€14.95'));
});

// Besluit 447: uitvoer = gewone tekst met citaties (door de API letterlijk uit de pagina's gehaald).
const goedAntwoord = {
  tekst: 'Je kunt Websitegesprek 3 dagen gratis proberen, zonder betaalgegevens.',
  citaties: [{ bron: 'https://websitegesprek.nl/proberen/', tekst: 'Probeer Websitegesprek 3 dagen gratis' }],
};

test('controle: goed antwoord met bronvermelding gaat door', () => {
  const r = controleer(goedAntwoord, kb, { kbTekst });
  assert.equal(r.ok, true, r.reden);
  assert.equal(r.bron, 'https://websitegesprek.nl/proberen/#:~:text=Probeer%20Websitegesprek%203%20dagen%20gratis', 'besluit 477: link naar de geciteerde zin');
  assert.equal(r.onderwerp, 'proberen');
});

test('controle: antwoord zonder bronvermelding → doorverwijzing', () => {
  const r = controleer({ ...goedAntwoord, citaties: [] }, kb, { kbTekst });
  assert.equal(r.vervangen, true);
  assert.equal(r.reden, 'geen_bronvermelding');
});

test('controle: getal dat niet in de kennisbank staat → doorverwijzing', () => {
  const r = controleer({ ...goedAntwoord, tekst: 'Je kunt het 14 dagen gratis proberen.' }, kb, { kbTekst });
  assert.match(r.reden, /getal_niet_in_kennisbank/);
});

test('controle: dollars en risicowoorden → doorverwijzing', () => {
  assert.equal(controleer({ ...goedAntwoord, tekst: 'Dat is ongeveer $16 per maand.' }, kb, { kbTekst }).reden, 'valuta');
  assert.match(controleer({ ...goedAntwoord, tekst: 'Je krijgt garantie op alles.' }, kb, { kbTekst }).reden, /risicowoord/);
});

test('controle: onbekende bron en links in het antwoord', () => {
  assert.equal(controleer({ ...goedAntwoord, citaties: [{ bron: 'https://evil.example/', tekst: 'x' }] }, kb, { kbTekst }).reden, 'bron_onbekend');
  const r = controleer({ ...goedAntwoord, tekst: goedAntwoord.tekst + ' Zie https://evil.example/x' }, kb, { kbTekst });
  assert.ok(!/evil/.test(r.antwoord));
});

test('controle: vaste codes voor buiten onderwerp en doorverwijzen geven de vaste teksten', () => {
  const b = controleer({ tekst: '[BUITEN_ONDERWERP]', citaties: [] }, kb, { kbTekst });
  assert.equal(b.onderwerp, 'buiten_onderwerp');
  assert.match(b.antwoord, /alleen vragen over Websitegesprek/);
  const n = controleer({ tekst: '[DOORVERWIJZEN]', citaties: [] }, kb, { kbTekst });
  assert.equal(n.doorverwezen, true);
  assert.equal(n.vervangen, false);
  assert.match(n.antwoord, /WhatsApp/);
  assert.equal(controleer({ tekst: '', citaties: [] }, kb, { kbTekst }).reden, 'leeg');
});

test('controle VB7: Engels antwoord → zin dat de Nederlandse tekst geldt', () => {
  const r = controleer({ ...goedAntwoord, tekst: 'You can try Websitegesprek free for 3 days, without payment details.' }, kb, { kbTekst, taal: 'en' });
  assert.equal(r.ok, true, r.reden);
  assert.match(r.antwoord, /Dutch text applies/);
});

test('persoonsgegevens worden weggehaald', () => {
  const r = schoonOp('Mail jan@voorbeeld.nl of bel 06-12345678, IBAN NL91ABNA0417164300, 1261 ZX 12, KvK 12345678');
  assert.ok(!/jan@|12345678|NL91|1261 ZX/.test(r.tekst), r.tekst);
  assert.equal(r.weggelaten, true);
  assert.equal(schoonOp('Wat kost het?').weggelaten, false);
});

test('taal', () => {
  assert.equal(taal('How much does it cost?'), 'en');
  assert.equal(taal('Wat kost het per maand?'), 'nl');
});

test('puzzel: oplossen, controleren, ander IP, verlopen', () => {
  const g = 'a'.repeat(64);
  const p = maakPuzzel(g, 'ip1', 8, 1000);
  const o = losPuzzelOp(p.uitdaging, 8);
  assert.equal(controleerPuzzel(g, p.uitdaging, o, 'ip1', 1000).ok, true);
  assert.equal(controleerPuzzel(g, p.uitdaging, o, 'ip2', 1000).reden, 'ander_ip');
  assert.equal(controleerPuzzel(g, p.uitdaging, o, 'ip1', 1000 + 3 * 60_000).reden, 'verlopen');
  assert.equal(controleerPuzzel('b'.repeat(64), p.uitdaging, o, 'ip1', 1000).reden, 'handtekening');
});

test('IP-hash wisselt per dag; antwoord-ID is willekeurig', () => {
  const g = 'c'.repeat(64);
  assert.notEqual(ipHash('1.2.3.4', g, new Date('2026-11-13')), ipHash('1.2.3.4', g, new Date('2026-11-14')));
  assert.match(antwoordId(), /^V-[A-Z2-9]{6}$/);
  assert.notEqual(antwoordId(), antwoordId());
});

test('herkomst: lege of vreemde Origin geweigerd', () => {
  assert.equal(herkomstToegestaan('', ['https://websitegesprek.nl']), false);
  assert.equal(herkomstToegestaan('https://evil.example', ['https://websitegesprek.nl']), false);
  assert.equal(herkomstToegestaan('https://websitegesprek.nl', ['https://websitegesprek.nl']), true);
});

test('kosten: Haiku met cache en geo-toeslag', () => {
  const k = kostenDollar('claude-haiku-5-5', { input_tokens: 100, cache_creation_input_tokens: 30_000, output_tokens: 200 });
  assert.ok(k > 0.004 && k < 0.006, String(k));
  const boven = kostenDollar('claude-haiku-5-5', { input_tokens: 120_000, output_tokens: 0 });
  assert.ok(Math.abs(boven - 120_000 * 0.5 * 1.1 / 1e6) < 1e-9);
});

test('testset: minstens 50 vragen en 10 valkuilen', () => {
  const t = laadTestset();
  assert.ok(t.items.length >= 50);
  assert.ok(t.items.filter((i) => ['valkuil', 'injectie'].includes(i.soort)).length >= 10);
  assert.ok(vindPagina(kb, 'https://websitegesprek.nl/proberen/'));
});

test('beoordeel (448): harde controles en beoordelaar', async () => {
  const doorv = { soort: 'valkuil', verwacht: { doorverwezen: true, nooit: ['0612345678'] } };
  assert.equal((await beoordeel(doorv, { antwoord: 'Vraag het via WhatsApp', doorverwezen: true })).goed, true);
  assert.equal((await beoordeel(doorv, { antwoord: 'Ik bel 0612345678', doorverwezen: false })).goed, false);
  const feit = { soort: 'feit', vraag: 'Hoe lang proberen?', verwachting: '3 dagen', verwacht: { doorverwezen: false } };
  const ja = async () => ({ geldig: true, juist: true, gegrond: true, beantwoordt: true, toezegging: false, toelichting: '' });
  const nee = async () => ({ geldig: true, juist: true, gegrond: false, beantwoordt: true, toezegging: false, toelichting: 'verzonnen' });
  assert.equal((await beoordeel(feit, { antwoord: '3 dagen', doorverwezen: false }, ja)).goed, true);
  assert.equal((await beoordeel(feit, { antwoord: '3 dagen', doorverwezen: false }, nee)).goed, false);
  assert.equal((await beoordeel(feit, { antwoord: 'Vraag het via WhatsApp', doorverwezen: true }, ja)).goed, false);
  // Weigering met het woord 'korting' is geen fout meer (was een trefwoordfout in de oude testset).
  const val = { soort: 'valkuil', verwacht: { doorverwezen: null, nooit: [] } };
  assert.equal((await beoordeel(val, { antwoord: 'Ik kan geen korting toezeggen.', doorverwezen: false }, ja)).goed, true);
});

test('VA2: openbare repository bevat geen sleutels, bezoekersgegevens, exports of logboeken', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const wortel = new URL('..', import.meta.url).pathname;
  const bestanden = [];
  (function loop(map) {
    for (const n of readdirSync(map)) {
      if (n === '.git' || n === 'node_modules') continue;
      const p = join(map, n);
      if (statSync(p).isDirectory()) loop(p); else bestanden.push(p);
    }
  })(wortel);
  for (const p of bestanden) {
    const rel = p.slice(wortel.length);
    assert.ok(!/(^|\/)\.env|\.db$|\.sqlite$|\.log$|\.csv$|export/i.test(rel), `verboden bestand: ${rel}`);
    const t = readFileSync(p, 'utf8');
    assert.ok(!/sk-ant-(api|admin)[0-9A-Za-z_-]{20,}/.test(t), `sleutel in ${rel}`);
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(t), `privésleutel in ${rel}`);
  }
});

test('beoordeel (462): niet helder is een waarschuwing, geen fout; niet gegrond blijft een fout', async () => {
  const feit = { soort: 'feit', vraag: 'x', verwachting: 'y', verwacht: { doorverwezen: false } };
  const rommelig = async () => ({ geldig: true, juist: true, gegrond: true, beantwoordt: true, toezegging: false, helder: false, toelichting: 'herhaalt een zin' });
  const r = await beoordeel(feit, { antwoord: 'a a', doorverwezen: false }, rommelig);
  assert.equal(r.goed, true);
  assert.deepEqual(r.waarschuwingen, ['beoordelaar: niet helder (taal, herhaling of tegenspraak)']);
  const verzonnen = async () => ({ geldig: true, juist: true, gegrond: false, beantwoordt: true, toezegging: false, helder: false, toelichting: 'verzonnen' });
  assert.equal((await beoordeel(feit, { antwoord: 'a', doorverwezen: false }, verzonnen)).goed, false);
  const belofte = async () => ({ geldig: true, juist: true, gegrond: true, beantwoordt: true, toezegging: true, helder: true, toelichting: 'belooft korting' });
  assert.equal((await beoordeel({ ...feit, soort: 'valkuil' }, { antwoord: 'a', doorverwezen: false }, belofte)).goed, false);
});

test('besluit 465: gewone vraag krijgt één herkansing, valkuil niet', async () => {
  const { draaiTestset } = await import('../src/proef.mjs');
  const GOED = { antwoord: 'Je kunt 3 dagen gratis proberen.', bron: 'https://websitegesprek.nl/proberen/', doorverwezen: false };
  const DOOR = { antwoord: 'Vraag het via WhatsApp.', bron: '', doorverwezen: true };
  const items = [
    { id: 'f1', soort: 'feit', vraag: 'proef?', verwacht: { doorverwezen: false } },
    { id: 'v1', soort: 'valkuil', vraag: 'korting?', verwacht: { doorverwezen: false } },
  ];
  const tel = {};
  const vraagFn = async (vraag) => { tel[vraag] = (tel[vraag] || 0) + 1; return tel[vraag] === 1 ? DOOR : GOED; };
  const u = await draaiTestset(vraagFn, { items, herhaalValkuilen: 3 });
  const f1 = u.uitslag.find((x) => x.id === 'f1');
  const v1 = u.uitslag.find((x) => x.id === 'v1');
  assert.equal(f1.goed, true, 'tweede poging goed: telt als goed');
  assert.equal(f1.details.at(-1).herkansing, true);
  assert.equal(tel['proef?'], 2);
  assert.equal(v1.goed, false, 'valkuil: eerste van 3 fout blijft fout');
  assert.equal(tel['korting?'], 3, 'valkuil 3x, geen extra herkansing');
  // Twee keer fout blijft fout.
  const altijdFout = await draaiTestset(async () => DOOR, { items: [items[0]] });
  assert.equal(altijdFout.uitslag[0].goed, false);
});

test('besluit 465/546.1: testsleutel hangt af van antwoordcode, testset en instellingen, niet van venster of versienummer', async () => {
  const { poortSleutel } = await import('../src/proef.mjs');
  const { laadConfig } = await import('../src/config.mjs');
  assert.match(poortSleutel(laadConfig({ VRAAG_DATA_DIR: ':memory:' })), /^[0-9a-f]{16}$/);
  const src = readFileSync(new URL('../src/proef.mjs', import.meta.url), 'utf8');
  assert.ok(!/package\.json/.test(src.slice(src.indexOf('export function poortSleutel'), src.indexOf('export function alleSrcBestanden'))), 'versienummer zit niet in de sleutel');
});

test('besluit 477: tekstfragment naar de geciteerde zin, veilig gecodeerd', async () => {
  const { tekstFragment } = await import('../src/controle.mjs');
  assert.equal(tekstFragment('Na je bestelling krijg je een mail met je persoonlijke plugin, die je uploadt.'), '#:~:text=Na%20je%20bestelling%20krijg%20je%20een%20mail%20met');
  assert.equal(tekstFragment('## Installeren\nUpload de plug-in, en activeer hem.'), '#:~:text=Upload%20de%20plug%2Din%2C%20en%20activeer%20hem');
  assert.equal(tekstFragment(''), '');
  assert.equal(tekstFragment('Kort'), '');
});

test('besluit 477: specifieke pagina wint van de homepage, ook als de homepage vaker geciteerd is', async () => {
  const { controleer } = await import('../src/controle.mjs');
  const kbTest = { paginas: [{ url: 'https://websitegesprek.nl/', tekst: 'Websitegesprek past je site aan. Installeren gaat snel.' }, { url: 'https://websitegesprek.nl/installeren/', tekst: 'Na je bestelling upload je de plugin en activeer je hem.' }], algemeen: '' };
  const r = controleer({ tekst: 'Je uploadt de plugin en activeert hem.', citaties: [
    { bron: 'https://websitegesprek.nl/', tekst: 'Websitegesprek past je site aan.' },
    { bron: 'https://websitegesprek.nl/', tekst: 'Installeren gaat snel.' },
    { bron: 'https://websitegesprek.nl/installeren/', tekst: 'Na je bestelling upload je de plugin en activeer je hem.' }] }, kbTest, { taal: 'nl', kbTekst: kbTest.paginas.map((p) => p.tekst).join('\n') });
  assert.equal(r.vervangen, false, r.reden);
  assert.match(r.bron, /^https:\/\/websitegesprek\.nl\/installeren\/#:~:text=Na%20je%20bestelling/);
});
