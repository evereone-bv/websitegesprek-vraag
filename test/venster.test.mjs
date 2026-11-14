import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

test('zweef-kaart voor de site: script zonder && en zonder <', () => {
  const html = readFileSync(new URL('../venster/zweef-kaart.html', import.meta.url), 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.ok(!script.includes('&&'));
  assert.ok(!script.includes('<'));
  assert.match(html, /data-aan="0"/);
  assert.match(script, /vraagbaak=test/);
});

function laadVenster() {
  const el = () => ({ style: {}, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, querySelectorAll: () => [], focus() {}, set textContent(v) {}, get textContent() { return ''; } });
  const ctx = {
    window: {}, navigator: { language: 'nl-NL' }, location: { href: 'https://websitegesprek.nl/', search: '' },
    document: { createElement: el, createTextNode: () => ({}), querySelector: () => null, head: el(), body: el() },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: () => Promise.reject(new Error('geen netwerk in de test')), AbortController, setTimeout, clearTimeout,
    encodeURIComponent, unescape, Math, JSON, URL, String, Array, Promise,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8'), ctx);
  return ctx;
}

test('venster: sha256 van de puzzel klopt met node:crypto', () => {
  const ctx = laadVenster();
  assert.equal(typeof ctx.WGVraagbaak.open, 'function');
  for (const s of ['', 'abc', 'x.y:123', 'éé€', 'a'.repeat(200)]) {
    const verwacht = createHash('sha256').update(s).digest().readUInt32BE(0);
    assert.equal(ctx.__wgSha256Eerste(s), verwacht, s);
  }
});

test('venster: geen innerHTML en links alleen naar websitegesprek.nl', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.ok(!/outerHTML|insertAdjacentHTML|eval\(/.test(js));
  // innerHTML alleen voor vaste iconen uit het bestand zelf, nooit voor tekst van de server of de bezoeker.
  const toewijzingen = [...js.matchAll(/innerHTML\s*=\s*([A-Za-z_]+)/g)].map((m) => m[1]);
  assert.ok(toewijzingen.length > 0);
  for (const t of toewijzingen) assert.ok(['svg', 'LOGO'].includes(t), t);
  assert.match(js, /icoonKnop\(DUIM_OP/);
  assert.match(js, /hostname === 'websitegesprek\.nl'/);
  assert.match(js, /credentials: 'omit'/);
});

test('besluit 409: microfoon alleen bij spraak van de server of de testlink, voorlezen op het toestel', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(js, /var spraakAan = r\.spraak \|\| \(blok \? blok\.getAttribute\('data-spraak'\) === '1' : false\);/);
  assert.match(js, /spraakAan \|\| location\.search\.indexOf\('vraagbaak=test'\)/);
  assert.match(js, /mic\.hidden = true; mic\.disabled = true;/);
  assert.match(js, /speechSynthesis/);
  // Geen opname of verzending van geluid door ons: geen MediaRecorder of getUserMedia.
  assert.ok(!/MediaRecorder|getUserMedia/.test(js));
  assert.match(js, /Je spraak wordt door Apple of Google omgezet in tekst\./);
});

test('voorlezen kan het antwoord nooit breken (fout bij speak wordt afgevangen)', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /try \{\s*var u = new window\.SpeechSynthesisUtterance[\s\S]*?window\.speechSynthesis\.speak\(u\);\s*\} catch \(e\) \{ stopLezen\(\); \}/);
});
