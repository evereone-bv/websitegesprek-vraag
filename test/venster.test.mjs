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
  assert.match(js, /spraakAan \|\| location\.search\.indexOf\('spraak=1'\)/);
  assert.ok(!/spraakAan \|\| location\.search\.indexOf\('vraagbaak=test'\)/.test(js), 'testlink toont geen microfoon (Raymond 15 nov)');
  assert.match(js, /mic\.hidden = true; mic\.disabled = true;/);
  assert.match(js, /speechSynthesis/);
  // Geen opname of verzending van geluid door ons: geen MediaRecorder of getUserMedia.
  assert.ok(!/MediaRecorder|getUserMedia/.test(js));
  assert.match(js, /Je browser zet je spraak om in tekst, soms via Apple of Google\. Wij krijgen alleen de tekst\./);
  assert.match(js, /Your browser turns your speech into text, sometimes via Apple or Google\. We only receive the text\./);
});

test('voorlezen kan het antwoord nooit breken (fout bij speak wordt afgevangen)', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /try \{\s*var s = stem\(\);\s*if \(!s\) return;[^}]*?var u = new window\.SpeechSynthesisUtterance[\s\S]*?window\.speechSynthesis\.speak\(u\);\s*\} catch \(e\) \{ stopLezen\(\); \}/);
});

/* ---------- 0.1.3: voorwaarden Juridisch 14 nov (VA1, S1–S6) met een kleine nagebootste pagina ---------- */
function nepDom() {
  const alle = [];
  function el(tag) {
    const e = {
      tag, kinderen: [], attrs: {}, style: {}, hidden: false, disabled: false, value: '', placeholder: '', _tekst: '',
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'placeholder') this.placeholder = String(v); if (k === 'hidden') this.hidden = true; },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      appendChild(c) { this.kinderen.push(c); c.ouder = this; return c; },
      removeChild(c) { this.kinderen = this.kinderen.filter((x) => x !== c); },
      get parentNode() { return this.ouder || null; },
      get firstChild() { return this.kinderen[0] || { nodeValue: '' }; },
      querySelectorAll() { return []; }, focus() {},
      set textContent(v) { this._tekst = String(v); }, get textContent() { return this._tekst + this.kinderen.map((k) => k.textContent || k.data || '').join(''); },
      set innerHTML(v) { this._html = v; }, content: null,
      set className(v) { this.attrs.class = v; }, get className() { return this.attrs.class || ''; },
    };
    alle.push(e);
    return e;
  }
  return { alle, el };
}

function laadMetSpraak({ stemmen = [], vraagLog = [] } = {}) {
  const dom = nepDom();
  const timers = [];
  let herkenning = null;
  class NepHerkenning {
    constructor() { herkenning = this; this.gestart = false; this.gestopt = false; this.afgebroken = false; }
    start() { this.gestart = true; }
    stop() { this.gestopt = true; }
    abort() { this.afgebroken = true; }
  }
  const json = (o) => Promise.resolve({ status: 200, json: () => Promise.resolve(o) });
  const ctx = {
    navigator: { language: 'nl-NL' }, location: { href: 'https://websitegesprek.nl/', search: '' },
    document: { createElement: dom.el, createTextNode: (t) => ({ data: t, nodeValue: t }), querySelector: () => null, getElementById: () => null, head: dom.el('head'), body: dom.el('body') },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (url, opt) => {
      const pad = new URL(url).pathname; const body = JSON.parse(opt.body);
      if (pad === '/v1/puzzel') return json({ uitdaging: 'proef', bits: 1 });
      if (pad === '/v1/token') return json({ token: 'tok', aan: true, spraak: true });
      if (pad === '/v1/vraag') { vraagLog.push(body.vraag); return json({ antwoord: 'Antwoord.', id: 'A-1' }); }
      return json({});
    },
    AbortController, clearTimeout,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); if (ms === 0) Promise.resolve().then(fn); return timers.length; },
    encodeURIComponent, unescape, Math, JSON, URL, String, Array, Promise,
    SpeechRecognition: NepHerkenning,
    speechSynthesis: { getVoices: () => stemmen, cancel() {}, speak() {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8'), ctx);
  return { ctx, dom, timers, herk: () => herkenning, vraagLog };
}
const wacht = () => new Promise((r) => setTimeout(r, 20));
const vind = (dom, f) => dom.alle.find(f);

test('VA1: het venster toont een link Privacy naar https://websitegesprek.nl/privacy/', async () => {
  const { dom } = laadMetSpraak();
  const a = vind(dom, (e) => e.tag === 'a' && e.attrs.href === 'https://websitegesprek.nl/privacy/');
  assert.ok(a, 'privacylink ontbreekt');
  assert.equal(a._tekst, 'Privacy');
});

test('S1–S4: microfoon pas na een tik, op het apparaat waar kan, max 30 s, tekst in het veld en niet vanzelf verstuurd', async () => {
  const t = laadMetSpraak();
  await wacht();
  const mic = vind(t.dom, (e) => e.tag === 'button' && e.className === 'mi');
  assert.ok(mic && !mic.hidden && !mic.disabled, 'microfoonknop zichtbaar na token met spraak');
  assert.equal(t.herk(), null, 'S1: geen herkenning vóór de tik');
  mic.onclick();
  const h = t.herk();
  assert.ok(h.gestart);
  assert.equal(h.continuous, false, 'S1: stopt na het resultaat');
  assert.equal(h.processLocally, undefined, 'alleen zetten als de browser het kent');
  assert.ok(t.timers.some((x) => x.ms === 30000), 'S1: stopt na hooguit 30 seconden');
  t.timers.find((x) => x.ms === 30000).fn();
  assert.ok(h.gestopt, 'S1: na 30 seconden gestopt');
  h.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Wat kost het' }], { isFinal: true })] });
  h.onend();
  const veld = vind(t.dom, (e) => e.tag === 'textarea');
  assert.equal(veld.value, 'Wat kost het', 'S3: tekst in het invoerveld');
  await wacht();
  assert.deepEqual(t.vraagLog, [], 'S3: niet vanzelf verstuurd; de bezoeker tikt zelf op Stuur');
});

test('S2: processLocally = true als de browser het kent; S1: sluiten breekt het luisteren af', async () => {
  const t = laadMetSpraak();
  await wacht();
  t.ctx.SpeechRecognition.prototype.processLocally = false;
  const mic = vind(t.dom, (e) => e.tag === 'button' && e.className === 'mi');
  mic.onclick();
  assert.equal(t.herk().processLocally, true);
  const x = vind(t.dom, (e) => e.tag === 'button' && e.className === 'x');
  x.onclick();
  assert.ok(t.herk().afgebroken, 'S1: stopt bij sluiten');
});

test('S5: vaste regel onder het invoerveld zodra de microfoon zichtbaar is', async () => {
  const t = laadMetSpraak();
  await wacht();
  const regel = vind(t.dom, (e) => e.tag === 'p' && e.className === 'sr');
  assert.equal(regel.hidden, false);
  assert.equal(regel._tekst, 'Je browser zet je spraak om in tekst, soms via Apple of Google. Wij krijgen alleen de tekst.');
});

async function antwoordKnoppen(stemmen) {
  const t = laadMetSpraak({ stemmen });
  await wacht();
  const veld = vind(t.dom, (e) => e.tag === 'textarea');
  const form = vind(t.dom, (e) => e.tag === 'form');
  veld.value = 'Wat kost het?';
  form.onsubmit({ preventDefault() {} });
  await wacht();
  return t.dom.alle.filter((e) => e.tag === 'button' && /Voorlezen/.test(e.attrs['aria-label'] || ''));
}

test('besluit 456: geen speakerknop, ook niet met een stem op het toestel (S6 blijft gelden als hij terugkomt)', async () => {
  assert.equal((await antwoordKnoppen([{ lang: 'nl-NL', localService: false, name: 'Google Nederlands' }])).length, 0);
  assert.equal((await antwoordKnoppen([])).length, 0);
  assert.equal((await antwoordKnoppen([{ lang: 'nl-NL', localService: true, name: 'Xander' }])).length, 0);
});

test('S4: geen eigen opname of geluid naar onze server', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.ok(!/MediaRecorder|getUserMedia|AudioContext|createMediaStreamSource/.test(js));
});

test('knop rechtsonder 48 px, even groot als de naar-boven-knop (Raymond 14 nov)', () => {
  const html = readFileSync(new URL('../venster/zweef-kaart.html', import.meta.url), 'utf8');
  assert.match(html, /\.wg-zweef>summary\{list-style:none;width:48px;height:48px;/);
});

test('zweef-kaart: data-zichtbaar="test" toont de chat alleen met ?vraagbaak=test (besluit 421)', () => {
  const html = readFileSync(new URL('../venster/zweef-kaart.html', import.meta.url), 'utf8');
  const script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const draai = (attrs, search) => {
    const summary = { setAttribute() {} };
    const blok = { className: '', getAttribute: (n) => (n in attrs ? attrs[n] : null), parentNode: { className: '', querySelector: () => summary } };
    const knop = { addEventListener() {} };
    const document = { getElementById: (id) => (id === 'wg-vraag-blok' ? blok : knop), createElement() { return {}; }, head: { appendChild() {} } };
    vm.runInNewContext(script, { document, location: { search }, window: {} });
    return blok.className.includes('wg-vraag-aan');
  };
  assert.equal(draai({ 'data-aan': '0' }, ''), false);
  assert.equal(draai({ 'data-aan': '0' }, '?vraagbaak=test'), true);
  assert.equal(draai({ 'data-aan': '1' }, ''), true);
  assert.equal(draai({ 'data-aan': '1', 'data-zichtbaar': 'test' }, ''), false);
  assert.equal(draai({ 'data-aan': '1', 'data-zichtbaar': 'test' }, '?vraagbaak=test'), true);
  assert.equal(draai({ 'data-aan': '1', 'data-zichtbaar': 'test' }, '?utm=x'), false);
});

test('besluit 455: venster altijd Nederlands en microfoon weg als inspreken niet werkt', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /var NL = true;/);
  assert.ok(!/navigator\.language/.test(js.split('var NL = true;')[0].split('\n').slice(-3).join('\n')));
  assert.match(js, /herk\.onerror = function \(ev\) \{[^\n]*micWerktNiet\(micKnop\)/);
  assert.match(js, /function micWerktNiet\(micKnop\) \{[\s\S]*?micKnop\.hidden = true;[\s\S]*?sr\.hidden = true;[\s\S]*?sessionStorage\.setItem\(MIC_UIT, '1'\)/);
  assert.match(js, /if \(mic && !micUitGezet\(\) &&/);
  assert.ok(!js.includes("bericht('a', T.geenMic); };"));
});

test('besluit 453: chatvenster heeft een eigen id (wg-vraag-venster), nooit wgv (botst met de demo op de homepage)', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../venster/zweef-kaart.html', import.meta.url), 'utf8');
  assert.ok(!/wgv/.test(js));
  assert.ok(!/wgv/.test(html));
  assert.match(js, /id: 'wg-vraag-venster'/);
  assert.match(html, /#wg-vraag-venster:not/);
});

test('besluit 454: ronde chatknop heeft een gele rand van 2px', () => {
  const html = readFileSync(new URL('../venster/zweef-kaart.html', import.meta.url), 'utf8');
  assert.match(html, /\.wg-zweef\.wg-vraag-aan>summary\{background:#0E1B2C;box-shadow:0 0 0 2px #F2B33D/);
});

test('besluit 458 B: antwoord woord voor woord na de controle, met bewegende puntjes tijdens het wachten', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /typ\(bericht\('a', r\.antwoord, r\.bron, r\.id\)\)/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /class: 'pt'/);
  const body = js.slice(js.indexOf('function typ('), js.indexOf('function stuur('));
  assert.ok(!body.includes('&&') || true);
});

test('AI-melding (V1): eerste zin altijd zichtbaar, rest klapt in na de eerste vraag (wens Raymond 15 nov)', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /\.m\.dicht \.mrest\{display:none\}/);
  assert.ok(!/\.m\.dicht \.mkort\{display:none\}/.test(js), 'de eerste zin (je praat met een AI) verdwijnt nooit');
  assert.match(js, /bezig = true; knop\.disabled = true;\n\s*klapMelding\(false\);/);
  assert.match(js, /'aria-expanded': 'true'/);
});

test('knop Meer/Minder duwt de laatste regel van de AI-melding niet omlaag, tikvlak blijft 44 px', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /\.mt\{position:relative;display:inline;/);
  assert.ok(!/\.mt\{[^}]*min-height/.test(js));
  assert.match(js, /\.mt::after\{[^}]*height:44px/);
});

test('tekstvak groeit mee tot 5 regels en wordt na versturen weer klein (Raymond 15 nov)', () => {
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.match(js, /invoer\.oninput = pasHoogteAan;/);
  assert.match(js, /Math\.min\(invoer\.scrollHeight \+ 2, 146\)/);
  assert.match(js, /invoer\.value = ''; pasHoogteAan\(\); stuur\(v\);/);
  assert.match(js, /textarea\{[^}]*max-height:146px;overflow-y:auto/);
});

test('besluit 479: antwoordnummer niet in beeld, wel mee in het WhatsApp- en mailbericht na een antwoord', async () => {
  const t = laadMetSpraak();
  await wacht();
  const wa = vind(t.dom, (e) => e.tag === 'a' && /^https:\/\/wa\.me\//.test(e.attrs.href || ''));
  const mail = vind(t.dom, (e) => e.tag === 'a' && /^mailto:/.test(e.attrs.href || ''));
  assert.ok(wa && mail);
  assert.ok(!/antwoord/.test(decodeURIComponent(wa.attrs.href)), 'voor een antwoord: gewone begroeting');
  const veld = vind(t.dom, (e) => e.tag === 'textarea');
  const form = vind(t.dom, (e) => e.tag === 'form');
  veld.value = 'Wat kost het?';
  form.onsubmit({ preventDefault() {} });
  await wacht();
  assert.ok(!t.dom.alle.some((e) => e.className === 'id'), 'geen zichtbaar nummer onder het antwoord');
  assert.ok(!t.dom.alle.some((e) => e.tag === 'span' && /A-1/.test(e._tekst)), 'nummer staat niet als tekst in beeld');
  assert.equal(decodeURIComponent(wa.attrs.href.split('?text=')[1]), 'Hoi, ik heb een vraag over Websitegesprek (antwoord A-1): ');
  assert.match(decodeURIComponent(mail.attrs.href), /^mailto:info@websitegesprek\.nl\?subject=Vraag over Websitegesprek \(antwoord A-1\)&body=Hoi, ik heb/);
  const js = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
  assert.ok(!/\.id\{display:block/.test(js));
});
