// HTTP-dienst van de vraagbaak achter Caddy (127.0.0.1:8090).
// Nooit de API-sleutel tonen of loggen. Geen toegangslog met IP-adressen.
import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { laadConfig } from './config.mjs';
import { openOpslag } from './opslag.mjs';
import { maakVraagbaak } from './vraagbaak.mjs';
import { herkomstToegestaan } from './beveiliging.mjs';
import { wisOudeRegels } from './doorsturen.mjs';

const VERSIE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const START = new Date().toISOString();
// Besluit 465: de testset draait alleen opnieuw als iets verandert dat de antwoorden raakt (servercode, testset,
// kennisbank, model, instructie, beoordelaar), niet bij een wijziging aan het venster of het versienummer alleen.
export function codeVingerafdruk() {
  const h = createHash('sha256');
  const map = new URL('./', import.meta.url);
  for (const f of readdirSync(map).filter((n) => n.endsWith('.mjs')).sort()) h.update(f + '\0' + readFileSync(new URL(f, map)));
  h.update(readFileSync(new URL('../testset/testset.json', import.meta.url)));
  return h.digest('hex').slice(0, 12);
}
const CODE = codeVingerafdruk();
const VENSTER_JS = readFileSync(new URL('../venster/venster.js', import.meta.url), 'utf8');
const MAX_BODY = 4096;

export function sleutelGezet(env = process.env) {
  const k = env.ANTHROPIC_API_KEY || '';
  return k.startsWith('sk-ant-') && k.length > 20;
}

function clientIp(req) {
  const ra = req.socket.remoteAddress || '';
  const vanCaddy = ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1' || ra.startsWith('172.');
  const xff = String(req.headers['x-forwarded-for'] || '');
  if (vanCaddy && xff) return xff.split(',').map((s) => s.trim()).filter(Boolean).pop();
  return ra;
}

function leesJson(req) {
  return new Promise((resolve) => {
    let n = 0; const delen = [];
    req.on('data', (c) => { n += c.length; if (n <= MAX_BODY) delen.push(c); });
    req.on('end', () => {
      if (n > MAX_BODY) return resolve({ __teGroot: true });
      try { resolve(JSON.parse(Buffer.concat(delen).toString('utf8') || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

export function maakServer({ env = process.env, config = laadConfig(env), opslag = openOpslag(config.dataMap), vraagbaak, fetchFn = fetch } = {}) {
  const vb = vraagbaak || maakVraagbaak({ config, opslag, fetchFn });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const origin = req.headers.origin || '';
    const kop = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const stuur = (status, data, extra = {}) => { res.writeHead(status, { ...kop, ...extra }); res.end(JSON.stringify(data)); };

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return stuur(200, { ok: true, versie: VERSIE, sinds: START, sleutel_gezet: sleutelGezet(env), ...vb.gezondheid() });
    }
    if (req.method === 'GET' && url.pathname === '/proef') {
      return stuur(200, opslag.staat('proef:volledig', { nog_niet_gedraaid: true }));
    }
    if (req.method === 'GET' && url.pathname === '/v1/venster.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
      return res.end(VENSTER_JS);
    }

    if (url.pathname.startsWith('/v1/')) {
      const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '600' };
      if (!herkomstToegestaan(origin, config.herkomst)) return stuur(403, { fout: 'herkomst' });
      if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (req.method !== 'POST') return stuur(405, { fout: 'methode' }, cors);
      const body = await leesJson(req);
      if (!body) return stuur(400, { fout: 'invoer' }, cors);
      if (body.__teGroot) return stuur(413, { fout: 'te_groot' }, cors);
      const ip = clientIp(req);
      let r;
      try {
        if (url.pathname === '/v1/puzzel') r = vb.puzzel({ ip });
        else if (url.pathname === '/v1/token') r = vb.token({ ip, uitdaging: body.uitdaging, oplossing: body.oplossing });
        else if (url.pathname === '/v1/vraag') r = await vb.vraag({ ip, tokenWaarde: body.token, vraagTekst: body.vraag, pagina: body.pagina });
        else if (url.pathname === '/v1/duim') r = vb.duim({ ip, tokenWaarde: body.token, id: body.id, waarde: body.duim });
        else return stuur(404, { fout: 'niet gevonden' }, cors);
      } catch (e) {
        opslag.log('fout', e?.message || 'onbekend');
        return stuur(500, { fout: 'intern' }, cors);
      }
      const status = r.status || 200;
      delete r.status;
      delete r.apiFout; delete r.diag; // foutdetails alleen voor de proef, nooit naar de bezoeker (besluit 443)
      return stuur(status, r, cors);
    }
    return stuur(404, { ok: false, fout: 'niet gevonden' });
  });
  return { server, vraagbaak: vb, opslag, config };
}

// Proef met een kandidaat-kennisbank in een aparte, tijdelijke opslag (ontwerp §4.3). Besluit 448: met de vaste
// beoordelaar. Besluit 447: 'denken' zet de variant vast ('low' of 'uit'); standaard de variant die de testset koos.
export function maakProef({ config, fetchFn = fetch, aantal = 10, alleenFeit = true, herhaal = 1, volledig = false, denken = null, model = null, opslagLive = null }) {
  return async (kandidaat) => {
    const { draaiTestset, laadTestset, tekstApiFout } = await import('./proef.mjs');
    const { losPuzzelOp } = await import('./beveiliging.mjs');
    const { maakBeoordelaar } = await import('./beoordelaar.mjs');
    const { kennisbankAlsTekst } = await import('./kennisbank.mjs');
    const variant = denken || opslagLive?.staat('proef:volledig', null)?.gekozen || config.denken;
    const gekozenModel = model || opslagLive?.staat('proef:volledig', null)?.gekozenModel || config.model;
    const cfg = { ...config, modus: 'aan', diagAltijd: true, denkenVast: variant, modelVast: gekozenModel, perIpUur: 1e6, perIpDag: 1e6, perTokenVragen: 1e6, tokensPerIpUur: 1e6, puzzelBits: 2,
      // Besluit 467: de proef heeft geen kostenplafond (de echte vraagbaak wel). Anders stopt hij halverwege met lege antwoorden.
      plafondUurEuro: 1e6, plafondDagEuro: 1e6, serverVragenPerUur: 1e6, piekDrempelEuro: 1e6 };
    // Verbruik van de antwoorden (niet de beoordelaar) bijhouden, zodat /proef laat zien of de cache werkt en wat een vraag kost.
    const verbruik = { aanroepen: 0, invoer: 0, cache_schrijf: 0, cache_lees: 0, uitvoer: 0, dollar: 0 };
    const { kostenDollar } = await import('./config.mjs');
    const telFetch = async (url, opts) => {
      const res = await fetchFn(url, opts);
      try {
        const body = JSON.parse(opts?.body || '{}');
        if (String(url).endsWith('/v1/messages') && !body.output_config?.format && res.ok) {
          const d = await res.clone().json();
          const us = d?.usage || {};
          verbruik.aanroepen++; verbruik.invoer += us.input_tokens || 0; verbruik.cache_schrijf += us.cache_creation_input_tokens || 0;
          verbruik.cache_lees += us.cache_read_input_tokens || 0; verbruik.uitvoer += us.output_tokens || 0; verbruik.dollar += kostenDollar(gekozenModel, us);
        }
      } catch { /* telling is alleen informatie */ }
      return res;
    };
    const tijdelijk = openOpslag(':memory:');
    const vb = maakVraagbaak({ config: cfg, opslag: tijdelijk, fetchFn: telFetch });
    vb.zetKennisbank(kandidaat, true);
    const beoordelaar = maakBeoordelaar({ config: cfg, kbTekst: kennisbankAlsTekst(kandidaat), fetchFn });
    const alle = laadTestset().items;
    const items = volledig ? alle : alle.filter((i) => !alleenFeit || i.soort === 'feit').slice(0, aantal);
    const ip = '127.0.0.8';
    const u = await draaiTestset(async (vraag, g) => {
      if (!g.token) { const pz = vb.puzzel({ ip }); g.token = vb.token({ ip, uitdaging: pz.uitdaging, oplossing: losPuzzelOp(pz.uitdaging, pz.bits) }).token; }
      const r = await vb.vraag({ ip, tokenWaarde: g.token, vraagTekst: vraag, pagina: 'https://websitegesprek.nl/proef' });
      // Staat de vraagbaak in de proef uit (bijv. door een fout), stop dan zichtbaar in plaats van lege antwoorden te tellen.
      if (r.uit || r.fout) return { apiFout: { soort: 'proef_' + (r.reden || r.fout || 'uit'), status: r.status || 0, type: '', uitleg: '' } };
      const reg = tijdelijk.db.prepare('SELECT onderwerp FROM register WHERE id = ?').get(r.id || '');
      // Besluit 455: de vaste Engelse AI-melding hoort er bewust boven; de beoordelaar kijkt alleen naar het antwoord zelf.
      const { MELDING_EN_TEKST } = await import('./vraagbaak.mjs');
      const antwoord = String(r.antwoord || '').startsWith(MELDING_EN_TEKST + '\n\n') ? String(r.antwoord).slice(MELDING_EN_TEKST.length + 2) : r.antwoord;
      return { ...r, antwoord, buiten: reg?.onderwerp === 'buiten_onderwerp' };
    }, { items, herhaalValkuilen: herhaal, beoordelaar });
    const kosten = { ...verbruik, euro: Math.round(verbruik.dollar * 0.95 * 1000) / 1000, euro_per_vraag: verbruik.aanroepen ? Math.round(verbruik.dollar * 0.95 / verbruik.aanroepen * 10000) / 10000 : 0 };
    if (u.apiFout) return { ok: false, denken: variant, fout: tekstApiFout(u.apiFout), apiFout: u.apiFout, bijVraag: u.bijVraag, goed: 0, totaal: 0, lat: 0, valkuilFout: 0, uitslag: [], kosten };
    const ok = volledig ? u.geslaagd : u.goed >= Math.ceil(items.length * 0.9);
    return { ok, denken: variant, goed: u.goed, totaal: u.totaal, lat: u.lat, valkuilFout: u.valkuilFout, gemDuurMs: u.gemDuurMs, uitslag: u.uitslag, kosten };
  };
}

// Besluit 447/461: kies de nadenk-variant. Alleen geslaagde varianten tellen; daaronder de snelste die hooguit 1 vraag minder goed heeft.
export function kiesVariant(varianten) {
  const lijst = Object.entries(varianten).filter(([, v]) => v && !v.fout);
  const geslaagd = lijst.filter(([, v]) => v.geslaagd);
  const pool = geslaagd.length ? geslaagd : lijst;
  if (!pool.length) return null;
  // Besluit 467 (vervangt de marge van 1 uit 461): kwaliteit eerst. De variant met de meeste goede antwoorden wint;
  // alleen bij precies even goed de snelste.
  pool.sort((a, b) => (b[1].goed - a[1].goed) || (a[1].gemDuurMs - b[1].gemDuurMs));
  return pool[0][0];
}

// Vaste taken: kennisbank verversen (elke 6 uur, met proef), reserve-snapshot, dagelijkse proef (5 vragen), opruimen.
export function startTaken({ vraagbaak, opslag, config }) {
  const proef = config.apiSleutel ? maakProef({ config, opslagLive: opslag }) : null;
  const laadSnapshot = () => {
    try {
      const snap = JSON.parse(readFileSync(new URL('../kennisbank/snapshot.json', import.meta.url), 'utf8'));
      vraagbaak.zetKennisbank(snap, true);
      opslag.log('kennisbank', `reserve-snapshot actief: ${snap.versie}`);
    } catch (e) { opslag.log('alarm', 'geen kennisbank en geen snapshot'); }
  };
  const ververs = async () => {
    const r = await vraagbaak.ververs({ proef }).catch((e) => ({ ok: false, fout: e.message }));
    if (!r.ok && !vraagbaak.kb) laadSnapshot();
  };
  // Volledige testset (V3) op de server zelf, ook zolang de vraagbaak voor bezoekers uit staat.
  // Eén keer per combinatie van versie, kennisbank, model en instructie; uitslag op GET /proef (geen bezoekersgegevens).
  let volledigBezig = false;
  const volledig = async () => {
    if (!config.apiSleutel || !vraagbaak.kb || volledigBezig) return;
    volledigBezig = true;
    try { await volledigDraai(); } finally { volledigBezig = false; }
  };
  const volledigDraai = async () => {
    const { INSTRUCTIE_VERSIE } = await import('./instructie.mjs');
    const { BEOORDELAAR_VERSIE } = await import('./beoordelaar.mjs');
    const { laadTestset } = await import('./proef.mjs');
    const sleutel = [CODE, vraagbaak.kb.versie, config.testModellen.join('+'), INSTRUCTIE_VERSIE, laadTestset().versie, BEOORDELAAR_VERSIE].join('|');
    const oud = opslag.staat('proef:volledig', null);
    if (oud && oud.sleutel === sleutel && !oud.fout) return;
    if (oud && Date.now() - Date.parse(oud.tijd) < 6 * 3_600_000 && oud.sleutel.split('|')[0] === CODE) return;
    // Besluit 447: beide nadenk-varianten volledig, met de beoordelaar (besluit 448).
    const varianten = {};
    // Besluit 467: Sonnet met en zonder nadenken, Haiku met nadenken (Haiku zonder nadenken zakte steeds).
    const combinaties = [];
    for (const m of config.testModellen) for (const d of (m.includes('haiku') ? ['low'] : ['low', 'uit'])) combinaties.push([m, d]);
    for (const [model, denken] of combinaties) {
      const naam = `${model}|${denken}`;
      const u = await maakProef({ config, volledig: true, herhaal: 3, denken, model })(vraagbaak.kb).catch((e) => ({ ok: false, fout: `${e.soort || 'fout'} ${e.status || ''} ${e.message || ''} ${e.uitleg || ''}`.replace(/\s+/g, ' ').trim(), uitslag: [] }));
      varianten[naam] = { model, denken,
        geslaagd: !!u.ok, fout: u.fout || '', ...(u.apiFout ? { apiFout: u.apiFout, bij_vraag: u.bijVraag } : {}),
        goed: u.goed, totaal: u.totaal, lat: u.lat, valkuilFout: u.valkuilFout, gemDuurMs: u.gemDuurMs, kosten: u.kosten,
        fouten: (u.uitslag || []).filter((x) => !x.goed).map((x) => ({ id: x.id, soort: x.soort, fouten: x.details.map((d) => d.fouten.join('; ')), antwoord: x.details[0]?.antwoord, oordeel: x.details.find((d) => d.oordeel)?.oordeel?.toelichting, diag: x.details.find((d) => d.diag)?.diag })),
        antwoorden: (u.uitslag || []).map((x) => ({ id: x.id, goed: x.goed, antwoord: x.details.at(-1)?.antwoord, herkansing: !!x.details.at(-1)?.herkansing, oordeel: x.details.at(-1)?.oordeel ? { juist: x.details.at(-1).oordeel.juist, gegrond: x.details.at(-1).oordeel.gegrond, beantwoordt: x.details.at(-1).oordeel.beantwoordt, toezegging: x.details.at(-1).oordeel.toezegging, helder: x.details.at(-1).oordeel.helder, toelichting: x.details.at(-1).oordeel.toelichting } : null, blokken: x.details.at(-1)?.diag?.blokken })),
      };
      opslag.log('proef', `volledige testset ${model} denken ${denken}: ${u.goed}/${u.totaal}, valkuilen fout ${u.valkuilFout}${u.fout ? ', fout ' + u.fout : ''}`);
    }
    const gekozenNaam = kiesVariant(varianten);
    const g = gekozenNaam ? varianten[gekozenNaam] : {};
    const gekozen = g.denken || null;
    const gekozenModel = g.model || null;
    const fout = Object.values(varianten).every((v) => v.fout) ? Object.values(varianten).map((v) => v.fout).join(' | ') : '';
    opslag.zetStaat('proef:volledig', {
      sleutel, versie: VERSIE, tijd: new Date().toISOString(), model: gekozenModel || config.model, gekozenModel, gekozenNaam, instructie: INSTRUCTIE_VERSIE, beoordelaar: `${config.beoordelaarModel} ${BEOORDELAAR_VERSIE}`,
      gekozen, geslaagd: !!g.geslaagd, fout, goed: g.goed, totaal: g.totaal, lat: g.lat, valkuilFout: g.valkuilFout, gemDuurMs: g.gemDuurMs,
      varianten,
    });
  };
  setTimeout(() => ververs().then(volledig), 5_000).unref();
  setInterval(() => volledig().catch(() => {}), 3_600_000).unref();
  setInterval(ververs, 6 * 3_600_000).unref();
  // Elke 5 minuten: zo staat een IP-code nooit langer dan 24 uur in de opslag (VA3).
  // Besluit 480: register wissen via wisOudeRegels (30 dagen; met export pas als verstuurd, uiterlijk 35 dagen).
  setInterval(() => { opslag.opruimen(null); wisOudeRegels({ config, opslag }); }, 5 * 60_000).unref();
  // Schakelaar op websitegesprek.nl elke 15 minuten lezen (besluit 400).
  setTimeout(() => vraagbaak.leesSchakelaar(), 2_000).unref();
  setInterval(() => vraagbaak.leesSchakelaar(), 15 * 60_000).unref();
  // Dagelijkse proef rond 03:17 (Nederlandse tijd ongeveer; server staat op UTC): 5 feitvragen, rood → uit (besluit 400).
  setInterval(async () => {
    const nu = new Date();
    const dag = nu.toISOString().slice(0, 10);
    if (nu.getUTCHours() !== 2 || opslag.staat('proef:dag', '') === dag || !proef || !vraagbaak.status().aan) return;
    opslag.zetStaat('proef:dag', dag);
    const u = await maakProef({ config, aantal: 5, opslagLive: opslag })(vraagbaak.kb).catch(() => ({ ok: false, goed: 0, totaal: 5 }));
    opslag.zetStaat('proef:laatste', { dag, ...u });
    if (!u.ok) vraagbaak.zetUit('proef_rood');
  }, 10 * 60_000).unref();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8090);
  const host = process.env.HOST || '127.0.0.1';
  const app = maakServer();
  app.server.listen(port, host, () => {
    console.log(`vraagbaak ${VERSIE} luistert op ${host}:${port}; sleutel gezet: ${sleutelGezet()}; modus: ${app.config.modus}`);
  });
  startTaken(app);
}
