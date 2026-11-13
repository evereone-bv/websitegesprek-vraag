// Kern van de vraagbaak: aan/uit, grenzen, gesprekken, antwoorden met controle, register, kennisbank.
import { schoonOp, taal as taalVan } from './schoon.mjs';
import { controleer, parseModelUitvoer, DOORVERWIJZING } from './controle.mjs';
import { vraagClaude, ApiFout } from './claude.mjs';
import { kostenDollar, DOLLAR_NAAR_EURO } from './config.mjs';
import { kennisbankAlsTekst, bouwKennisbank } from './kennisbank.mjs';
import { INSTRUCTIE_VERSIE } from './instructie.mjs';
import { geheim as haalGeheim, ipHash, maakPuzzel, controleerPuzzel, nieuwToken, antwoordId } from './beveiliging.mjs';

const UUR = 3_600_000;
const DAG = 24 * UUR;
const KWARTIER = 15 * 60_000;

export const V1 = {
  nl: 'Je praat met een AI-assistent (Claude). Antwoorden kunnen fouten bevatten; wat telt, staat op onze website en in onze voorwaarden. Deel geen persoonsgegevens; liever een mens? Vraag het via WhatsApp of mail.',
  // Voorlopige Engelse versie; Marketing stelt de definitieve voor, Juridisch toetst (VB7).
  en: "You're chatting with an AI assistant (Claude). Answers may contain mistakes; what counts is on our website and in our terms. Don't share personal data; prefer a human? Ask us via WhatsApp or email.",
};

export function maakVraagbaak({ config, opslag, fetchFn = fetch, klok = () => Date.now() }) {
  const geheim = haalGeheim(opslag);
  let kb = null; // { versie, paginas, algemeen }
  let kbTekst = '';

  function laadActieveKennisbank() {
    const r = opslag.db.prepare('SELECT versie, inhoud FROM kennisbank WHERE actief = 1 ORDER BY gemaakt DESC LIMIT 1').get();
    if (r) { kb = JSON.parse(r.inhoud); kbTekst = kennisbankAlsTekst(kb); }
    return kb;
  }
  function zetKennisbank(nieuw, actief) {
    opslag.db.prepare('INSERT INTO kennisbank (versie, inhoud, gemaakt, actief) VALUES (?, ?, ?, 0) ON CONFLICT(versie) DO NOTHING')
      .run(nieuw.versie, JSON.stringify(nieuw), klok());
    if (actief) {
      opslag.db.exec('UPDATE kennisbank SET actief = 0');
      opslag.db.prepare('UPDATE kennisbank SET actief = 1 WHERE versie = ?').run(nieuw.versie);
      kb = nieuw; kbTekst = kennisbankAlsTekst(nieuw);
    }
  }
  laadActieveKennisbank();

  // ---- aan/uit (besluit 400) ----
  function status() {
    const uit = opslag.staat('uit', null); // { reden, sinds } of null
    if (config.modus === 'uit') return { aan: false, reden: 'handmatig_uit' };
    if (config.modus === 'auto') {
      const site = opslag.staat('site:aan', null);
      if (!site || !site.aan || klok() - site.tijd > 2 * UUR) return { aan: false, reden: 'schakelaar_site_uit' };
      const p = opslag.staat('proef:volledig', null);
      if (!p || !p.geslaagd || p.model !== config.model || p.instructie !== INSTRUCTIE_VERSIE) return { aan: false, reden: 'testset_niet_geslaagd' };
    }
    if (!config.apiSleutel) return { aan: false, reden: 'geen_sleutel' };
    if (!kb) return { aan: false, reden: 'geen_kennisbank' };
    if (uit) return { aan: false, reden: uit.reden };
    const t = klok();
    if (euro(opslag.stand(`kosten:uur:${uurVak(t)}`)) >= config.plafondUurEuro) return { aan: false, reden: 'uurplafond', tijdelijk: true };
    if (euro(opslag.stand(`kosten:dag:${dagVak(t)}`)) >= config.plafondDagEuro) return { aan: false, reden: 'dagplafond', tijdelijk: true };
    if (opslag.stand(`server:uur:${uurVak(t)}`) >= config.serverVragenPerUur) return { aan: false, reden: 'serverplafond', tijdelijk: true };
    return { aan: true };
  }
  function zetUit(reden) {
    if (!opslag.staat('uit', null)) {
      opslag.zetStaat('uit', { reden, sinds: new Date(klok()).toISOString() });
      opslag.log('alarm', `vraagbaak uit: ${reden}`);
    }
  }
  function zetAan() { opslag.zetStaat('uit', null); opslag.log('beheer', 'vraagbaak weer aan'); }

  const uurVak = (t) => Math.floor(t / UUR);
  const dagVak = (t) => Math.floor(t / DAG);
  const euro = (milliCent) => (milliCent / 100_000); // kosten worden opgeteld in duizendsten van een cent

  function boekKosten(dollar) {
    const milliCent = Math.round(dollar * DOLLAR_NAAR_EURO * 100_000);
    const t = klok();
    opslag.tel(`kosten:uur:${uurVak(t)}`, milliCent, UUR);
    opslag.tel(`kosten:dag:${dagVak(t)}`, milliCent, DAG);
    opslag.tel(`kosten:hist:${uurVak(t)}`, milliCent, DAG + UUR);
    return milliCent;
  }

  // Kostenpiek: dit uur meer dan 3x het gemiddelde van de vorige 24 uur (en minstens €0,50).
  function controleerPiek() {
    const t = klok();
    const nu = euro(opslag.stand(`kosten:hist:${uurVak(t)}`));
    let som = 0;
    for (let i = 1; i <= 24; i++) som += euro(opslag.stand(`kosten:hist:${uurVak(t) - i}`));
    const gem = som / 24;
    if (nu >= 0.5 && nu > 3 * gem) zetUit('kostenpiek');
  }

  // >20% API-fouten in 15 minuten (bij minstens 10 aanroepen).
  function boekApi(ok) {
    const t = klok();
    const vak = Math.floor(t / KWARTIER);
    const totaal = opslag.tel(`api:tot:${vak}`, 1, KWARTIER);
    const fout = ok ? opslag.stand(`api:fout:${vak}`) : opslag.tel(`api:fout:${vak}`, 1, KWARTIER);
    if (totaal >= 10 && fout / totaal > 0.2) zetUit('foutpercentage');
  }

  // ---- puzzel en token (besluit 401, VB4) ----
  function puzzel({ ip }) {
    const iph = ipHash(ip, geheim, new Date(klok()));
    const n = opslag.tel(`puzzel:ip:${iph}:${uurVak(klok())}`, 1, UUR);
    if (n > config.tokensPerIpUur * 2) return { fout: 'te_vaak', status: 429 };
    return maakPuzzel(geheim, iph, config.puzzelBits, klok());
  }

  function token({ ip, uitdaging, oplossing }) {
    const iph = ipHash(ip, geheim, new Date(klok()));
    const p = controleerPuzzel(geheim, uitdaging, oplossing, iph, klok());
    if (!p.ok) return { fout: 'puzzel_' + p.reden, status: 400 };
    // Elke puzzel maar één keer bruikbaar.
    if (opslag.tel(`puzzel:gebruikt:${p.nonce}`, 1, 5 * 60_000) > 1) return { fout: 'puzzel_hergebruikt', status: 400 };
    if (opslag.tel(`token:ip:${iph}:${uurVak(klok())}`, 1, UUR) > config.tokensPerIpUur) return { fout: 'te_vaak', status: 429 };
    const tok = nieuwToken();
    opslag.db.prepare('INSERT INTO gesprek (token, iphash, verloopt) VALUES (?, ?, ?)').run(tok, iph, klok() + config.tokenMinuten * 60_000);
    const s = status();
    return { token: tok, geldig_minuten: config.tokenMinuten, aan: s.aan, v1: V1 };
  }

  // ---- vraag ----
  async function vraag({ ip, tokenWaarde, vraagTekst, pagina }) {
    const t0 = klok();
    const s = status();
    if (!s.aan) return { uit: true, reden: s.tijdelijk ? 'even_niet' : 'uit', status: 503 };
    const g = opslag.db.prepare('SELECT * FROM gesprek WHERE token = ?').get(String(tokenWaarde || ''));
    if (!g || g.verloopt < t0) return { fout: 'token_ongeldig', status: 401 };
    const iph = ipHash(ip, geheim, new Date(t0));
    if (g.iphash !== iph) return { fout: 'token_ander_ip', status: 401 };
    if (g.vragen >= config.perTokenVragen) return { fout: 'gesprek_vol', status: 429 };
    const ruw = String(vraagTekst || '');
    if (!ruw.trim()) return { fout: 'leeg', status: 400 };
    if (ruw.length > config.maxVraagTekens) return { fout: 'te_lang', status: 413 };
    if (opslag.tel(`vraag:ip:${iph}:${uurVak(t0)}`, 1, UUR) > config.perIpUur) return { fout: 'te_vaak', status: 429 };
    if (opslag.tel(`vraag:ipdag:${iph}:${dagVak(t0)}`, 1, DAG) > config.perIpDag) return { fout: 'te_vaak', status: 429 };
    opslag.tel(`server:uur:${uurVak(t0)}`, 1, UUR);

    const { tekst: schoon } = schoonOp(ruw);
    const taal = taalVan(schoon);
    const beurten = JSON.parse(g.beurten);
    const berichten = [...beurten, { role: 'user', content: schoon }];

    let uitkomst; let kostenMilliCent = 0; let gebruiktModel = config.model;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.apiTimeoutMs);
    try {
      let r;
      try {
        r = await vraagClaude({ config, kbTekst, beurten: berichten, model: config.model, fetchFn, signaal: ctrl.signal });
      } catch (e) {
        if (!(e instanceof ApiFout) || !config.terugvalModel || ['sleutel', 'tegoed'].includes(e.soort)) throw e;
        gebruiktModel = config.terugvalModel;
        r = await vraagClaude({ config, kbTekst, beurten: berichten, model: config.terugvalModel, fetchFn, signaal: ctrl.signal });
      }
      boekApi(true);
      kostenMilliCent = boekKosten(kostenDollar(gebruiktModel, r.usage));
      controleerPiek();
      uitkomst = controleer(parseModelUitvoer(r.tekst), kb, { taal, kbTekst });
    } catch (e) {
      boekApi(false);
      if (e instanceof ApiFout && (e.soort === 'sleutel' || e.soort === 'tegoed')) zetUit(e.soort === 'sleutel' ? 'sleutelfout' : 'tegoed');
      opslag.log('api', e instanceof ApiFout ? `${e.soort} ${e.status}` : 'onbekende fout');
      uitkomst = { ok: false, vervangen: true, reden: 'api_' + (e.soort || 'fout'), antwoord: DOORVERWIJZING[taal], bron: 'https://websitegesprek.nl/contact/', onderwerp: 'onbekend', zeker: false, doorverwezen: true, apiFout: true };
    } finally {
      clearTimeout(timer);
    }

    const id = antwoordId();
    const nieuw = [...berichten, { role: 'assistant', content: uitkomst.antwoord }].slice(-12);
    opslag.db.prepare('UPDATE gesprek SET vragen = vragen + 1, beurten = ? WHERE token = ?').run(JSON.stringify(nieuw), g.token);
    const paginaPad = (() => { try { const u = new URL(String(pagina || '')); return u.hostname === 'websitegesprek.nl' ? u.pathname : ''; } catch { return ''; } })();
    opslag.db.prepare(`INSERT INTO register (id, tijd, pagina, vraag, antwoord, bron, onderwerp, zeker, doorverwezen, vervangen, reden, kb_versie, model, kosten_milli_cent, taal, duur_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, t0, paginaPad, schoon, uitkomst.antwoord, uitkomst.bron, uitkomst.onderwerp, uitkomst.zeker ? 1 : 0,
      uitkomst.doorverwezen ? 1 : 0, uitkomst.vervangen ? 1 : 0, uitkomst.reden || '', kb?.versie || '', gebruiktModel, kostenMilliCent, taal, klok() - t0);
    return { id, antwoord: uitkomst.antwoord, bron: uitkomst.bron, doorverwezen: !!uitkomst.doorverwezen, nl_geldt: taal !== 'nl' };
  }

  function duim({ ip, tokenWaarde, id, waarde }) {
    const g = opslag.db.prepare('SELECT iphash FROM gesprek WHERE token = ?').get(String(tokenWaarde || ''));
    if (!g || g.iphash !== ipHash(ip, geheim, new Date(klok()))) return { fout: 'token_ongeldig', status: 401 };
    const v = waarde === 1 ? 1 : waarde === -1 ? -1 : 0;
    opslag.db.prepare('UPDATE register SET duim = ? WHERE id = ?').run(v, String(id || ''));
    return { ok: true };
  }

  // ---- kennisbank verversen (ontwerp §4.3) ----
  async function ververs({ bouw = bouwKennisbank, proef = null } = {}) {
    let nieuw;
    try { nieuw = await bouw({ fetchFn }); } catch (e) { opslag.log('kennisbank', `ophalen mislukt: ${e.message}`); return { ok: false, reden: 'ophalen', fout: e.message }; }
    if (kb && nieuw.versie === kb.versie) return { ok: true, ongewijzigd: true, versie: kb.versie };
    const oudLengte = kb ? kennisbankAlsTekst(kb).length : 0;
    const nieuwLengte = kennisbankAlsTekst(nieuw).length;
    if (nieuwLengte < 5000) { opslag.log('alarm', 'kennisbank verdacht klein'); return { ok: false, reden: 'te_klein' }; }
    if (nieuwLengte > 320_000) { opslag.log('alarm', 'kennisbank te groot voor het prijsvak'); return { ok: false, reden: 'te_groot' }; }
    const groot = oudLengte > 0 && Math.abs(nieuwLengte - oudLengte) / oudLengte > 0.4;
    zetKennisbank(nieuw, false);
    if (groot) { opslag.log('alarm', `kennisbank ${nieuw.versie} wijkt veel af; niet actief`); return { ok: false, reden: 'grote_wijziging', versie: nieuw.versie }; }
    if (proef && status().aan) {
      const u = await proef(nieuw);
      if (!u.ok) { opslag.log('alarm', `proef kennisbank ${nieuw.versie} rood (${u.goed}/${u.totaal})`); return { ok: false, reden: 'proef_rood', versie: nieuw.versie }; }
    }
    zetKennisbank(nieuw, true);
    opslag.log('kennisbank', `actief: ${nieuw.versie}`);
    return { ok: true, versie: nieuw.versie };
  }

  // Schakelaar op websitegesprek.nl lezen: het blok id="wg-vraag-blok" met data-aan="1" (besluit 400).
  // Lukt lezen niet, dan blijft de vorige stand staan; na 2 uur zonder bevestiging telt hij als uit (veilige kant).
  async function leesSchakelaar() {
    try {
      const res = await fetchFn(config.siteUrl, { redirect: 'manual', headers: { 'User-Agent': 'websitegesprek-vraagbaak/schakelaar' } });
      const html = await res.text();
      if (res.status !== 200 || /sgcaptcha/.test(html.slice(0, 600))) throw new Error('site gaf ' + res.status);
      const tag = html.match(/<[^>]*id=["']wg-vraag-blok["'][^>]*>/i)?.[0] || '';
      const aan = /data-aan=["']1["']/i.test(tag);
      const oud = opslag.staat('site:aan', null);
      if (!oud || oud.aan !== aan) opslag.log('schakelaar', `site zegt ${aan ? 'aan' : 'uit'}`);
      opslag.zetStaat('site:aan', { aan, tijd: klok() });
      return { ok: true, aan };
    } catch (e) {
      opslag.log('schakelaar', `lezen mislukt: ${e.message}`);
      return { ok: false };
    }
  }

  function gezondheid() {
    const s = status();
    const t = klok();
    return {
      aan: s.aan, reden: s.reden || '', modus: config.modus,
      schakelaar_site: opslag.staat('site:aan', null)?.aan ?? null,
      kennisbank: kb ? kb.versie : null,
      kosten_vandaag_euro: Math.round(euro(opslag.stand(`kosten:dag:${dagVak(t)}`)) * 100) / 100,
      vragen_dit_uur: opslag.stand(`server:uur:${uurVak(t)}`),
      proef_laatste: opslag.staat('proef:laatste', null),
    };
  }

  return { status, zetUit, zetAan, leesSchakelaar, puzzel, token, vraag, duim, ververs, gezondheid, zetKennisbank, laadActieveKennisbank, get kb() { return kb; } };
}
