// Kern van de vraagbaak: aan/uit, grenzen, gesprekken, antwoorden met controle, register, kennisbank.
import { schoonOp, taal as taalVan } from './schoon.mjs';
import { controleer, DOORVERWIJZING } from './controle.mjs';
import { vraagClaude, ApiFout } from './claude.mjs';
import { kostenDollar, DOLLAR_NAAR_EURO } from './config.mjs';
import { kennisbankAlsTekst, bouwKennisbank } from './kennisbank.mjs';
import { INSTRUCTIE_VERSIE } from './instructie.mjs';
import { geheim as haalGeheim, ipHash, maakPuzzel, controleerPuzzel, nieuwToken, antwoordId } from './beveiliging.mjs';

export const MELDING_EN_TEKST = 'You are chatting with an AI assistant (Claude). Answers may contain mistakes; what counts is our website and our terms in Dutch.';
const UUR = 3_600_000;
const DAG = 24 * UUR;
// VA3 (Juridisch 14 nov): tellers met een IP-code verlopen ruim binnen 24 uur (opruimen draait elke 5 minuten).
export const IP_DAG = DAG - 10 * 60_000;
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
      if (!p || !p.geslaagd || !config.testModellen.includes(p.gekozenModel || p.model) || p.instructie !== INSTRUCTIE_VERSIE) return { aan: false, reden: 'testset_niet_geslaagd' };
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
  // Besluit 468: zuinige stand = vanaf 70% van het uur- of dagbudget, of bij een kostenpiek dit uur. Dan het goedkopere model,
  // maar alleen als dat model de testset ook gehaald heeft (een goedgekeurd model, nooit een ongetest model).
  function zuinig() {
    const t = klok();
    const uur = euro(opslag.stand(`kosten:uur:${uurVak(t)}`));
    const dag = euro(opslag.stand(`kosten:dag:${dagVak(t)}`));
    const reden = uur >= config.zuinigVanaf * config.plafondUurEuro ? 'uurbudget' : dag >= config.zuinigVanaf * config.plafondDagEuro ? 'dagbudget' : opslag.staat(`zuinig:piek:${uurVak(t)}`, null) ? 'kostenpiek' : '';
    return { aan: !!reden, reden, uur_euro: Math.round(uur * 100) / 100, dag_euro: Math.round(dag * 100) / 100 };
  }
  function zuinigModel(keuze) {
    const v = keuze?.varianten || {};
    const goedgekeurd = Object.values(v).filter((x) => x && x.geslaagd && x.model === config.terugvalModel);
    if (!config.terugvalModel || !goedgekeurd.length) return null;
    goedgekeurd.sort((a, b) => b.goed - a.goed);
    return { model: config.terugvalModel, denken: goedgekeurd[0].denken };
  }
  function controleerPiek() {
    const t = klok();
    const nu = euro(opslag.stand(`kosten:hist:${uurVak(t)}`));
    let som = 0;
    for (let i = 1; i <= 24; i++) som += euro(opslag.stand(`kosten:hist:${uurVak(t) - i}`));
    const gem = som / 24;
    // Besluit 468: een kostenpiek zet de vraagbaak niet meer uit, maar zet hem dit uur in de zuinige stand (met alarm).
    if (nu >= config.piekDrempelEuro && nu > 3 * gem && !opslag.staat(`zuinig:piek:${uurVak(t)}`, null)) {
      opslag.zetStaat(`zuinig:piek:${uurVak(t)}`, { sinds: new Date(t).toISOString() });
      opslag.log('alarm', `kostenpiek: € ${nu.toFixed(2)} dit uur (gemiddeld € ${gem.toFixed(2)}); zuinige stand`);
    }
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
    return { token: tok, geldig_minuten: config.tokenMinuten, aan: s.aan, v1: V1, spraak: !!config.spraak };
  }

  // ---- vraag ----
  // Besluit 467: per controle een concrete herstelopdracht (Nederlands of Engels). null = niet te herstellen.
  function herstelVraag(reden, taal) {
    const en = taal === 'en';
    const r = String(reden || '');
    const slot = en ? ' Support every claim with citations from the websitegesprek.nl pages. If it is not on the pages, say that you are not sure.' : " Onderbouw elke bewering met citaten uit de pagina's van websitegesprek.nl. Staat het niet op de pagina's, zeg dan dat je het niet zeker weet.";
    if (r === 'geen_bronvermelding' || r === 'bron_onbekend') return (en ? 'Give your answer again.' : 'Geef je antwoord opnieuw.') + slot;
    if (r.startsWith('getal_niet_in_kennisbank:') || r === 'valuta') {
      const g = r.split(':')[1] || '';
      return (en ? `The amount or number "${g}" is not on the pages. Give your answer again using only amounts, periods and numbers exactly as they appear on the pages, without converting anything.` : `Het bedrag of getal "${g}" staat niet op de pagina's. Geef je antwoord opnieuw met alleen bedragen, termijnen en aantallen precies zoals ze op de pagina's staan, zonder iets om te rekenen.`) + slot;
    }
    if (r.startsWith('risicowoord:')) {
      const w = r.split(':')[1] || '';
      return (en ? `Do not use the word "${w}" unless the page itself uses it, and make no promises. Give your answer again with only what the pages say.` : `Gebruik het woord "${w}" niet tenzij de pagina het zelf gebruikt, en doe geen toezeggingen. Geef je antwoord opnieuw met alleen wat er op de pagina's staat.`) + slot;
    }
    if (r === 'te_lang') return (en ? 'Give your answer again in at most 80 words.' : 'Geef je antwoord opnieuw in hooguit 80 woorden.') + slot;
    return null;
  }
  // Besluit 455, voorwaarde Juridisch 15 nov (1.2.3): het venster is altijd Nederlands; is de vraag niet in het Nederlands,
  // dan staat deze vaste zin boven het eerste antwoord in die taal, zodat ook wie geen Nederlands leest weet dat het een AI is.
  const MELDING_EN = MELDING_EN_TEKST;

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
    if (opslag.tel(`vraag:ipdag:${iph}:${dagVak(t0)}`, 1, IP_DAG) > config.perIpDag) return { fout: 'te_vaak', status: 429 };
    opslag.tel(`server:uur:${uurVak(t0)}`, 1, UUR);

    const { tekst: schoon } = schoonOp(ruw);
    const taal = taalVan(schoon);
    const beurten = JSON.parse(g.beurten);
    const berichten = [...beurten, { role: 'user', content: schoon }];

    // Besluit 447/467: model en nadenken volgens de variant die de testset koos; de proef zet ze vast.
    const keuze = opslag.staat('proef:volledig', null);
    let model = config.modelVast || keuze?.gekozenModel || config.model;
    let denken = config.denkenVast || keuze?.gekozen || config.denken;
    // Besluit 468: in de zuinige stand het goedgekeurde goedkopere model (alleen als het verschilt en de testset haalde).
    const zs = config.modelVast ? { aan: false } : zuinig();
    const zm = zs.aan ? zuinigModel(keuze) : null;
    if (zm && zm.model !== model) { model = zm.model; denken = zm.denken; }
    let uitkomst; let kostenMilliCent = 0; let gebruiktModel = model;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.apiTimeoutMs);
    try {
      let r;
      try {
        r = await vraagClaude({ config, kb, beurten: berichten, model, denken, fetchFn, signaal: ctrl.signal });
      } catch (e) {
        // Besluit 467: Haiku valt alleen in bij drukte, een time-out of een netwerkfout van het gekozen model.
        if (!(e instanceof ApiFout) || !config.terugvalModel || config.terugvalModel === model || !['druk', 'tijd', 'netwerk'].includes(e.soort)) throw e;
        gebruiktModel = config.terugvalModel;
        r = await vraagClaude({ config, kb, beurten: berichten, model: config.terugvalModel, denken, fetchFn, signaal: ctrl.signal });
      }
      boekApi(true);
      kostenMilliCent = boekKosten(kostenDollar(gebruiktModel, r.usage));
      controleerPiek();
      uitkomst = controleer(r, kb, { taal, kbTekst });
      // Besluit 457/467: eerst herstellen, dan pas doorverwijzen. Faalt een controle die het model zelf kan verbeteren
      // (geen bron, een getal of woord dat niet op de pagina's staat, te lang), dan vragen we het één keer opnieuw met
      // precies wat er mis was. De controle blijft even streng: pas als ook die poging faalt, volgt de doorverwijzing.
      const herstel = uitkomst.vervangen && String(r.tekst || '').trim() ? herstelVraag(uitkomst.reden, taal) : null;
      if (herstel) {
        try {
          const nogmaals = [...berichten, { role: 'assistant', content: String(r.tekst).slice(0, 2000) }, { role: 'user', content: herstel }];
          const r2 = await vraagClaude({ config, kb, beurten: nogmaals, model: gebruiktModel, denken, fetchFn, signaal: ctrl.signal });
          kostenMilliCent += boekKosten(kostenDollar(gebruiktModel, r2.usage));
          const u2 = controleer(r2, kb, { taal, kbTekst });
          if (!u2.vervangen) { uitkomst = { ...u2, reden: 'hersteld:' + uitkomst.reden }; r = r2; }
        } catch (e) { /* tweede poging mislukt: de eerste uitkomst (doorverwijzing) blijft staan */ }
      }
      // Alleen voor de proef (besluit 443): waarom een antwoord is vervangen; de server stuurt dit nooit naar de bezoeker.
      if (uitkomst.vervangen || uitkomst.doorverwezen || config.diagAltijd) uitkomst.diag = { reden: uitkomst.reden || '', stop: r.stop || '', ruw: String(r.tekst || '').slice(0, 400), ...(config.diagAltijd ? { blokken: (r.blokken || []).slice(0, 12) } : {}) };
    } catch (e) {
      boekApi(false);
      if (e instanceof ApiFout && (e.soort === 'sleutel' || e.soort === 'tegoed')) zetUit(e.soort === 'sleutel' ? 'sleutelfout' : 'tegoed');
      opslag.log('api', e instanceof ApiFout ? `${e.soort} ${e.status} ${e.message === 'API niet bereikbaar' ? '' : e.message} ${e.uitleg || ''}`.trim() : 'onbekende fout');
      uitkomst = { apiDetail: e instanceof ApiFout ? { soort: e.soort, status: e.status, type: e.message === 'API niet bereikbaar' ? '' : e.message, uitleg: e.uitleg || '' } : { soort: 'onbekend', status: 0, type: '', uitleg: '' }, ok: false, vervangen: true, reden: 'api_' + (e.soort || 'fout'), antwoord: DOORVERWIJZING[taal], bron: 'https://websitegesprek.nl/contact/', onderwerp: 'onbekend', zeker: false, doorverwezen: true, apiFout: true };
    } finally {
      clearTimeout(timer);
    }

    const id = antwoordId();
    const nieuw = [...berichten, { role: 'assistant', content: uitkomst.antwoord }].slice(-12);
    // Eerste niet-Nederlandse vraag in dit gesprek: vaste AI-melding erboven (niet in de beurten voor het model).
    const eerderAnderstalig = beurten.some((b) => b.role === 'user' && taalVan(String(b.content || '')) !== 'nl');
    if (taal !== 'nl' && !eerderAnderstalig) uitkomst = { ...uitkomst, antwoord: MELDING_EN + '\n\n' + uitkomst.antwoord };
    opslag.db.prepare('UPDATE gesprek SET vragen = vragen + 1, beurten = ? WHERE token = ?').run(JSON.stringify(nieuw), g.token);
    const paginaPad = (() => { try { const u = new URL(String(pagina || '')); return u.hostname === 'websitegesprek.nl' ? u.pathname : ''; } catch { return ''; } })();
    opslag.db.prepare(`INSERT INTO register (id, tijd, pagina, vraag, antwoord, bron, onderwerp, zeker, doorverwezen, vervangen, reden, kb_versie, model, kosten_milli_cent, taal, duur_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, t0, paginaPad, schoon, uitkomst.antwoord, uitkomst.bron, uitkomst.onderwerp, uitkomst.zeker ? 1 : 0,
      uitkomst.doorverwezen ? 1 : 0, uitkomst.vervangen ? 1 : 0, uitkomst.reden || '', kb?.versie || '', gebruiktModel, kostenMilliCent, taal, klok() - t0);
    return { id, antwoord: uitkomst.antwoord, bron: uitkomst.bron, doorverwezen: !!uitkomst.doorverwezen, nl_geldt: taal !== 'nl', ...(uitkomst.apiDetail ? { apiFout: uitkomst.apiDetail } : {}), ...(uitkomst.diag ? { diag: uitkomst.diag } : {}) };
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
      const test = /data-zichtbaar=["']test["']/i.test(tag);
      const oud = opslag.staat('site:aan', null);
      if (!oud || oud.aan !== aan || !!oud.test !== test) opslag.log('schakelaar', `site zegt ${aan ? 'aan' : 'uit'}${aan && test ? ' (testmodus)' : ''}`);
      // Voorwaarde Juridisch bij 421: vóór de vraagbaak live gaat voor bezoekers, wordt het register leeggemaakt.
      // Dat gebeurt hier vanzelf, één keer, op het moment dat de site voor het eerst 'aan zonder testmodus' zegt.
      if (aan && !test && !opslag.staat('register:gewist_bij_live', null)) {
        const n = wisRegister();
        opslag.zetStaat('register:gewist_bij_live', { tijd: klok(), aantal: n });
        opslag.log('register', `register leeggemaakt bij livegang (${n} regels, voorwaarde Juridisch 421)`);
      }
      opslag.zetStaat('site:aan', { aan, test, tijd: klok() });
      return { ok: true, aan, test };
    } catch (e) {
      opslag.log('schakelaar', `lezen mislukt: ${e.message}`);
      return { ok: false };
    }
  }

  // Register leegmaken (voorwaarde Juridisch bij 421). Geeft het aantal gewiste regels terug.
  function wisRegister() {
    return opslag.db.prepare('DELETE FROM register').run().changes;
  }

  function gezondheid() {
    const s = status();
    const t = klok();
    return {
      aan: s.aan, reden: s.reden || '', modus: config.modus,
      schakelaar_site: opslag.staat('site:aan', null)?.aan ?? null,
      testmodus: !!opslag.staat('site:aan', null)?.test,
      // Alleen een aantal, nooit inhoud: zo ziet de dagelijkse controle of er in testmodus vragen van anderen binnenkomen (421).
      vragen_24u: opslag.db.prepare("SELECT COUNT(*) AS n FROM register WHERE tijd >= ? AND pagina != '/proef'").get(t - DAG).n,
      register_gewist_bij_live: opslag.staat('register:gewist_bij_live', null)?.tijd ? new Date(opslag.staat('register:gewist_bij_live', null).tijd).toISOString() : null,
      kennisbank: kb ? kb.versie : null,
      kosten_vandaag_euro: Math.round(euro(opslag.stand(`kosten:dag:${dagVak(t)}`)) * 100) / 100,
      // Besluit 468: budget en zuinige stand, alleen getallen.
      budget: (() => { const z = zuinig(); return { uur_euro: z.uur_euro, dag_euro: z.dag_euro, plafond_uur_euro: config.plafondUurEuro, plafond_dag_euro: config.plafondDagEuro, zuinig: z.aan, zuinig_reden: z.reden, zuinig_model: z.aan ? (zuinigModel(opslag.staat('proef:volledig', null))?.model || null) : null }; })(),
      vragen_dit_uur: opslag.stand(`server:uur:${uurVak(t)}`),
      // Besluit 461: snelheid van echte antwoorden (zonder proef), alleen getallen.
      ...(() => {
        const d = opslag.db.prepare("SELECT duur_ms FROM register WHERE tijd >= ? AND pagina != '/proef' AND duur_ms IS NOT NULL ORDER BY duur_ms").all(t - DAG).map((x) => x.duur_ms);
        const at = (q) => (d.length ? d[Math.min(d.length - 1, Math.floor(q * d.length))] : null);
        return { duur_ms_mediaan_24u: at(0.5), duur_ms_p90_24u: at(0.9) };
      })(),
      proef_laatste: opslag.staat('proef:laatste', null),
    };
  }

  return { status, zetUit, zetAan, leesSchakelaar, wisRegister, puzzel, token, vraag, duim, ververs, gezondheid, zetKennisbank, laadActieveKennisbank, get kb() { return kb; } };
}
