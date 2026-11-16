// HTTP-dienst van de vraagbaak achter Caddy (127.0.0.1:8090).
// Nooit de API-sleutel tonen of loggen. Geen toegangslog met IP-adressen.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { laadConfig } from './config.mjs';
import { openOpslag } from './opslag.mjs';
import { maakVraagbaak } from './vraagbaak.mjs';
import { herkomstToegestaan } from './beveiliging.mjs';
import { wisOudeRegels } from './doorsturen.mjs';
import { maakProef, leesGoedkeuring, leesPoortStand, poortSleutel, laadTestset, verbergServerVragen } from './proef.mjs';

const VERSIE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const START = new Date().toISOString();
// Besluit 546.1: de testpoort staat in proef.mjs en draait buiten deze container (deploy/wissel.sh, testcontainer).
// Deze server leest alleen het goedkeuringsbestand (W1) en de stand van de poort, en berekent zijn eigen sleutel (W2).
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
  const goedkeuring = () => leesGoedkeuring(config.goedkeuringPad);
  let eigenSleutel = null;
  const sleutel = () => { try { eigenSleutel ??= poortSleutel(config); } catch { eigenSleutel = ''; } return eigenSleutel; };
  const vb = vraagbaak || maakVraagbaak({ config, opslag, fetchFn, goedkeuring, poort: () => leesPoortStand(config.poortMap), sleutel });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const origin = req.headers.origin || '';
    const kop = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const stuur = (status, data, extra = {}) => { res.writeHead(status, { ...kop, ...extra }); res.end(JSON.stringify(data)); };

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return stuur(200, { ok: true, versie: VERSIE, sinds: START, sleutel_gezet: sleutelGezet(env), ...vb.gezondheid() });
    }
    if (req.method === 'GET' && url.pathname === '/proef') {
      // Besluit 480 (V18.1): servervragen (uit bezoekersvragen) zonder tekst tonen. Besluit 546.1 (W1): de uitslag van de
      // live versie komt uit het goedkeuringsbestand; de laatste nieuwe versie (ook als die zakte) uit de stand van de poort.
      let ids = new Set();
      try { ids = new Set(laadTestset(config.dataMap).items.filter((i) => i.server).map((i) => i.id)); } catch { /* geen servertestset */ }
      const stand = leesPoortStand(config.poortMap);
      return stuur(200, verbergServerVragen({ ...(goedkeuring() || { nog_niet_gedraaid: true }), nieuwe_versie: vb.nieuweVersie(), laatste_nieuwe_versie: stand.laatste }, ids));
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

// Vaste taken: kennisbank verversen (elke 6 uur, met proef), reserve-snapshot, dagelijkse proef (5 vragen), opruimen,
// herstel na sleutel- of tegoedfout (546.1).
export function startTaken({ vraagbaak, opslag, config }) {
  const proef = config.apiSleutel ? maakProef({ config, keuze: leesGoedkeuring(config.goedkeuringPad) }) : null;
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
  // Besluit 546.1 (W6): na een sleutel- of tegoedfout elke 15 minuten één kleine herstelpoging.
  setInterval(() => vraagbaak.herstelPoging().catch(() => {}), 15 * 60_000).unref();
  setTimeout(() => ververs(), 5_000).unref();
  setInterval(ververs, 6 * 3_600_000).unref();
  // Elke 5 minuten: zo staat een IP-code nooit langer dan 24 uur in de opslag (VA3).
  // Besluit 480: register wissen via wisOudeRegels (30 dagen; met export pas als verstuurd, uiterlijk 35 dagen).
  setInterval(() => { opslag.opruimen(null); wisOudeRegels({ config, opslag }); }, 5 * 60_000).unref();
  // Schakelaar op websitegesprek.nl elke 15 minuten lezen (besluit 400).
  setTimeout(() => vraagbaak.leesSchakelaar(), 2_000).unref();
  setInterval(() => vraagbaak.leesSchakelaar(), 15 * 60_000).unref();
  // Dagelijkse proef rond 03:17 (Nederlandse tijd ongeveer; server staat op UTC): 5 feitvragen. Besluit 546.1 (W7, V14):
  // rood zet de vraagbaak niet meer uit, maar geeft 'storing' in de bewaking tot de volgende geslaagde dagproef.
  setInterval(async () => {
    const nu = new Date();
    const dag = nu.toISOString().slice(0, 10);
    if (nu.getUTCHours() !== 2 || opslag.staat('proef:dag', '') === dag || !proef || !vraagbaak.status().aan) return;
    opslag.zetStaat('proef:dag', dag);
    const u = await maakProef({ config, aantal: 5, keuze: leesGoedkeuring(config.goedkeuringPad) })(vraagbaak.kb).catch(() => ({ ok: false, goed: 0, totaal: 5 }));
    opslag.zetStaat('proef:laatste', { dag, ...u });
    if (!u.ok) opslag.log('alarm', `dagproef rood (${u.goed}/${u.totaal}); vraagbaak blijft aan, bewaking 'storing'`);
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
