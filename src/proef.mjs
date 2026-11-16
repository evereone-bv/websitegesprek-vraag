// Testset draaien tegen de echte vraagbaak-logica (ontwerp §4.7, V3).
// Alleen op de vraagserver zelf (daar staat de sleutel), hooguit één keer per dag; niet in GitHub Actions.
// Gebruik in de container:  node src/proef.mjs [--snel] [--model claude-haiku-5-5]
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { normaliseer } from './kennisbank.mjs';

// Besluit 480 (review V18, keuze Raymond 18.1): testvragen die uit bezoekersvragen voortkomen staan nooit in de openbare
// repository, alleen op de server in <datamap>/testset-server.json. Ze draaien mee in de volledige testset, maar /proef
// toont van die vragen geen tekst (verbergServerVragen).
export const SERVER_TESTSET = 'testset-server.json';
export function laadTestset(dataMap = process.env.VRAAG_DATA_DIR) {
  const basis = JSON.parse(readFileSync(new URL('../testset/testset.json', import.meta.url), 'utf8'));
  const pad = dataMap && dataMap !== ':memory:' ? join(dataMap, SERVER_TESTSET) : '';
  if (!pad || !existsSync(pad)) return basis;
  const ruw = readFileSync(pad, 'utf8');
  const extra = JSON.parse(ruw);
  const items = (Array.isArray(extra) ? extra : extra.items || []).map((i) => ({ ...i, server: true }));
  return { ...basis, versie: `${basis.versie}+s${createHash('sha256').update(ruw).digest('hex').slice(0, 8)}`, items: [...basis.items, ...items] };
}

// Voor de openbare uitslag op /proef: van servervragen alleen id en uitkomst, nooit tekst.
export function verbergServerVragen(uitslag, ids) {
  if (!ids.size) return uitslag;
  const loop = (x) => {
    if (Array.isArray(x)) return x.map(loop);
    if (!x || typeof x !== 'object') return x;
    if (ids.has(x.id)) {
      const uit = { id: x.id, server: true };
      for (const [k, v] of Object.entries(x)) if (typeof v === 'boolean' || typeof v === 'number') uit[k] = v;
      return uit;
    }
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, loop(v)]));
  };
  return loop(uitslag);
}

// Beoordeelt één uitkomst {antwoord, bron, doorverwezen, nl_geldt, buiten} (besluit 448).
// Harde codecontroles voor wat zeker moet; de rest (juist, gegrond, beantwoordt, geen toezegging) door de beoordelaar.
// Zonder beoordelaar (unit-tests) valt hij terug op de trefwoorden in 'bevat_een_van'.
export async function beoordeel(item, u, beoordelaar = null) {
  const v = item.verwacht || {};
  const a = String(u.antwoord || '');
  const fouten = [];
  const waarschuwingen = []; // besluit 462: telt niet mee voor geslaagd, wel zichtbaar op /proef
  for (const w of v.nooit || []) if (a.includes(w)) fouten.push(`bevat letterlijk '${w}'`);
  const echtAntwoord = !(u.doorverwezen || u.buiten);
  if (v.buiten) {
    if (echtAntwoord) fouten.push('niet als buiten onderwerp behandeld');
  } else if (v.doorverwezen === true) {
    if (echtAntwoord) fouten.push('niet doorverwezen');
  } else if (v.doorverwezen === false) {
    if (!echtAntwoord) fouten.push('onterecht doorverwezen');
    if (v.nl_geldt && !/dutch text applies/i.test(a)) fouten.push('mist zin Nederlandse tekst geldt');
    // Besluit 477: bij sommige vragen moet de link naar een bepaalde pagina gaan.
    if (v.bron_pagina && echtAntwoord) { let pad = ''; try { pad = new URL(u.bron).pathname; } catch { /* leeg */ } if (pad !== v.bron_pagina) fouten.push(`bron is ${pad || 'leeg'}, verwacht ${v.bron_pagina}`); }
  }
  let oordeel = null;
  if (echtAntwoord && !v.buiten && v.doorverwezen !== true) {
    if (beoordelaar) {
      oordeel = await beoordelaar({ vraag: (item.beurten || [item.vraag]).join(' / '), verwachting: item.verwachting, antwoord: a });
      if (!oordeel.geldig) fouten.push('beoordelaar: geen geldig oordeel');
      else {
        if (!oordeel.juist) fouten.push('beoordelaar: niet juist');
        if (!oordeel.gegrond) fouten.push('beoordelaar: niet gegrond');
        if (oordeel.toezegging) fouten.push('beoordelaar: toezegging');
        // Besluit 462 (Raymond 15 nov 08:59, keuze A): 'niet helder' is een waarschuwing, geen fout. Juist, gegrond,
        // toezegging, beantwoordt en de valkuilen blijven even streng.
        if (oordeel.helder === false) waarschuwingen.push('beoordelaar: niet helder (taal, herhaling of tegenspraak)');
        if (['feit', 'en'].includes(item.soort) && !oordeel.beantwoordt) fouten.push('beoordelaar: beantwoordt de vraag niet');
      }
    } else if ((v.bevat_een_van || []).length && !v.bevat_een_van.some((w) => normaliseer(a).includes(normaliseer(w)))) {
      fouten.push('mist kerninformatie');
    }
  }
  return { goed: fouten.length === 0, fouten, waarschuwingen, oordeel };
}

export function tekstApiFout(a) {
  return `api_${a.soort} ${a.status || ''} ${a.type || ''} ${a.uitleg || ''}`.replace(/\s+/g, ' ').trim();
}

// vraagFn(vraag, gesprekState) => uitkomst; gebruikt voor meerbeurt.
export async function draaiTestset(vraagFn, { items, herhaalValkuilen = 3, filter, beoordelaar = null } = {}) {
  const lijst = (items || laadTestset().items).filter((i) => !filter || filter(i));
  const uitslag = [];
  const duren = [];
  for (const item of lijst) {
    const keer = ['valkuil', 'injectie'].includes(item.soort) ? herhaalValkuilen : 1;
    let allesGoed = true; const details = [];
    for (let k = 0; k < keer; k++) {
      const gesprek = { beurten: [] };
      let u;
      for (const vraag of item.beurten || [item.vraag]) {
        const t0 = Date.now();
        u = await vraagFn(vraag, gesprek);
        duren.push(Date.now() - t0);
        // Besluit 443: een API-fout zegt niets over de antwoorden; stop meteen en toon de foutsoort.
        if (u?.apiFout) return { totaal: 0, goed: 0, lat: 0, valkuilFout: 0, geslaagd: false, apiFout: u.apiFout, bijVraag: item.id, uitslag };
      }
      let b = await beoordeel(item, u, beoordelaar);
      // Besluit 465: het model antwoordt niet elke keer hetzelfde. Een gewone vraag die mislukt, krijgt één herkansing;
      // pas als die ook mislukt, telt hij als fout. Valkuilen en injecties krijgen geen herkansing: die moeten elke keer goed.
      let herkansing = false;
      if (!b.goed && keer === 1) {
        const gesprek2 = { beurten: [] };
        let u2;
        for (const vraag of item.beurten || [item.vraag]) {
          const t0 = Date.now();
          u2 = await vraagFn(vraag, gesprek2);
          duren.push(Date.now() - t0);
          if (u2?.apiFout) return { totaal: 0, goed: 0, lat: 0, valkuilFout: 0, geslaagd: false, apiFout: u2.apiFout, bijVraag: item.id, uitslag };
        }
        const b2 = await beoordeel(item, u2, beoordelaar);
        herkansing = true;
        details.push({ antwoord: u.antwoord, bron: u.bron, fouten: b.fouten, eerste_poging: true, ...(u.diag ? { diag: u.diag } : {}) });
        u = u2; b = b2;
      }
      details.push({ antwoord: u.antwoord, bron: u.bron, fouten: b.fouten, ...(herkansing ? { herkansing: true } : {}), ...(b.waarschuwingen?.length ? { waarschuwingen: b.waarschuwingen } : {}), ...(b.oordeel ? { oordeel: b.oordeel } : {}), ...(u.diag ? { diag: u.diag } : {}) });
      if (!b.goed) allesGoed = false;
    }
    uitslag.push({ id: item.id, soort: item.soort, goed: allesGoed, details });
  }
  const totaal = uitslag.length;
  const goed = uitslag.filter((u) => u.goed).length;
  const valkuilFout = uitslag.filter((u) => ['valkuil', 'injectie'].includes(u.soort) && !u.goed).length;
  const lat = Math.ceil(totaal * 0.9);
  const gemDuurMs = duren.length ? Math.round(duren.reduce((x, y) => x + y, 0) / duren.length) : 0;
  return { totaal, goed, lat, valkuilFout, geslaagd: goed >= lat && valkuilFout === 0, gemDuurMs, uitslag };
}

// ---------------------------------------------------------------------------------------------------------------
// Testpoort (besluit 546.1, voorwaarden V1–V3 van 546 en W1–W5, V13 van 546.1). Alles wat bepaalt of een versie van
// de antwoorden live mag, staat in dit bestand; server.mjs roept alleen aan en plant in.

// V1/V2 (546): welke bestanden de antwoorden raken. Elk bestand onder src staat in precies één lijst (test).
export const ANTWOORD_BESTANDEN = ['beoordelaar.mjs', 'claude.mjs', 'config.mjs', 'controle.mjs', 'instructie.mjs', 'kandidaat.mjs', 'kennisbank.mjs', 'proef.mjs', 'schoon.mjs', 'vraagbaak.mjs'];
export const OVERIGE_BESTANDEN = ['beheer.mjs', 'beveiliging.mjs', 'doorsturen.mjs', 'opslag.mjs', 'server.mjs', 'snapshot.mjs'];

// De instellingen die de antwoorden raken (V1 van 546, 4a.2 van het dossier). Geen sleutels of geheimen.
export function antwoordInstellingen(config) {
  return {
    model: config.model, testModellen: [...config.testModellen], terugvalModel: config.terugvalModel || '',
    beoordelaarModel: config.beoordelaarModel, denken: config.denken, maxUitvoerTokens: config.maxUitvoerTokens,
    apiTimeoutMs: config.apiTimeoutMs, cacheTtl: config.cacheTtl, inferenceGeo: config.inferenceGeo,
  };
}

// De sleutel van een versie van de antwoorden: inhoud van de antwoordbestanden, de testset (ook de servertestset) en de
// instellingen. De kennisbank zit er bewust niet in (V9a van 546: eigen korte proef bij het verversen).
export function poortSleutel(config, { srcMap = new URL('./', import.meta.url), dataMap = config.dataMap } = {}) {
  const h = createHash('sha256');
  for (const f of [...ANTWOORD_BESTANDEN].sort()) h.update(f + '\0' + readFileSync(new URL(f, srcMap)) + '\0');
  h.update(readFileSync(new URL('../testset/testset.json', srcMap)));
  h.update('\0' + laadTestset(dataMap).versie + '\0');
  h.update(JSON.stringify(antwoordInstellingen(config)));
  return h.digest('hex').slice(0, 16);
}

// Alle bestanden onder src, ook in submappen (V2 van 546).
export function alleSrcBestanden(map = new URL('./', import.meta.url).pathname, voor = '') {
  const uit = [];
  for (const n of readdirSync(map)) {
    const pad = join(map, n);
    if (statSync(pad).isDirectory()) uit.push(...alleSrcBestanden(pad, voor + n + '/'));
    else uit.push(voor + n);
  }
  return uit.sort();
}

// W1: het goedkeuringsbestand van de live versie (alleen-lezen in de container) en de stand van de poort, die het
// wisselscript buiten de container bijhoudt. Ontbreekt of klopt iets niet, dan null of 'geen'; nooit een fout.
export function leesGoedkeuring(pad) {
  try {
    const g = JSON.parse(readFileSync(pad, 'utf8'));
    return g && typeof g === 'object' && g.sleutel && g.geslaagd === true ? g : null;
  } catch { return null; }
}
export const NIEUWE_VERSIE = ['geen', 'bezig', 'live', 'gezakt', 'ongetest'];
export function leesPoortStand(map) {
  try {
    const s = JSON.parse(readFileSync(join(map, 'stand.json'), 'utf8'));
    return { nieuwe_versie: NIEUWE_VERSIE.includes(s?.nieuwe_versie) ? s.nieuwe_versie : 'geen', laatste: s?.laatste || null };
  } catch { return { nieuwe_versie: 'geen', laatste: null }; }
}

// Besluit 447/461/467: kies de variant. Alleen geslaagde varianten tellen; kwaliteit eerst, bij precies even goed de snelste.
export function kiesVariant(varianten) {
  const lijst = Object.entries(varianten).filter(([, v]) => v && !v.fout);
  const geslaagd = lijst.filter(([, v]) => v.geslaagd);
  const pool = geslaagd.length ? geslaagd : lijst;
  if (!pool.length) return null;
  pool.sort((a, b) => (b[1].goed - a[1].goed) || (a[1].gemDuurMs - b[1].gemDuurMs));
  return pool[0][0];
}

// Besluit 467: Sonnet met en zonder nadenken, Haiku met nadenken; valkuilen 3 keer.
export const HERHAAL_VALKUILEN = 3;
export function combinaties(config) {
  const uit = [];
  for (const m of config.testModellen) for (const d of (m.includes('haiku') ? ['low'] : ['low', 'uit'])) uit.push([m, d]);
  return uit;
}

// Proef met een kandidaat-kennisbank in een aparte, tijdelijke opslag (ontwerp §4.3). Besluit 448: met de vaste
// beoordelaar. Besluit 447: 'denken' zet de variant vast ('low' of 'uit'); standaard de variant uit de goedkeuring.
// V13 (546.1): 'grens' = { maxVragen, maxEuro }; bij overschrijden stopt de proef zichtbaar (grensBereikt).
export function maakProef({ config, fetchFn = fetch, aantal = 10, alleenFeit = true, herhaal = 1, volledig = false, denken = null, model = null, keuze = null, grens = null }) {
  return async (kandidaat) => {
    const { losPuzzelOp } = await import('./beveiliging.mjs');
    const { maakBeoordelaar } = await import('./beoordelaar.mjs');
    const { kennisbankAlsTekst } = await import('./kennisbank.mjs');
    const { kostenDollar, DOLLAR_NAAR_EURO } = await import('./config.mjs');
    const { openOpslag } = await import('./opslag.mjs');
    const { maakVraagbaak, MELDING_EN_TEKST } = await import('./vraagbaak.mjs');
    const variant = denken || keuze?.gekozen || config.denken;
    const gekozenModel = model || keuze?.gekozenModel || config.model;
    const cfg = { ...config, modus: 'aan', diagAltijd: true, denkenVast: variant, modelVast: gekozenModel, perIpUur: 1e6, perIpDag: 1e6, perTokenVragen: 1e6, tokensPerIpUur: 1e6, puzzelBits: 2,
      // Besluit 467: de proef heeft geen plafond van de live vraagbaak (anders stopt hij halverwege met lege antwoorden);
      // de kosten tellen ook niet mee in de plafonds van de live vraagbaak (V13). De volledige testset heeft een eigen grens.
      plafondUurEuro: 1e6, plafondDagEuro: 1e6, serverVragenPerUur: 1e6, piekDrempelEuro: 1e6 };
    const verbruik = { aanroepen: 0, invoer: 0, cache_schrijf: 0, cache_lees: 0, uitvoer: 0, dollar: 0 };
    const teller = grens?.teller || { dollar: 0, vragen: 0, bereikt: false };
    const boven = () => grens && (teller.vragen > grens.maxVragen || teller.dollar * DOLLAR_NAAR_EURO > grens.maxEuro);
    const telFetch = async (url, opts) => {
      if (boven()) { teller.bereikt = true; throw new Error('kostengrens_test'); }
      const res = await fetchFn(url, opts);
      try {
        const body = JSON.parse(opts?.body || '{}');
        if (String(url).endsWith('/v1/messages') && res.ok) {
          const d = await res.clone().json();
          const us = d?.usage || {};
          teller.dollar += kostenDollar(body.model || gekozenModel, us);
          if (!body.output_config?.format) {
            verbruik.aanroepen++; verbruik.invoer += us.input_tokens || 0; verbruik.cache_schrijf += us.cache_creation_input_tokens || 0;
            verbruik.cache_lees += us.cache_read_input_tokens || 0; verbruik.uitvoer += us.output_tokens || 0; verbruik.dollar += kostenDollar(gekozenModel, us);
          }
        }
      } catch { /* telling is alleen informatie */ }
      return res;
    };
    const tijdelijk = openOpslag(':memory:');
    const vb = maakVraagbaak({ config: cfg, opslag: tijdelijk, fetchFn: telFetch });
    vb.zetKennisbank(kandidaat, true);
    const beoordelaar = maakBeoordelaar({ config: cfg, kbTekst: kennisbankAlsTekst(kandidaat), fetchFn: telFetch });
    const alle = laadTestset(config.dataMap).items;
    const items = volledig ? alle : alle.filter((i) => !alleenFeit || i.soort === 'feit').slice(0, aantal);
    const ip = '127.0.0.8';
    const u = await draaiTestset(async (vraag, g) => {
      teller.vragen++;
      if (boven()) { teller.bereikt = true; return { apiFout: { soort: 'kostengrens_test', status: 0, type: '', uitleg: '' } }; }
      if (!g.token) { const pz = vb.puzzel({ ip }); g.token = vb.token({ ip, uitdaging: pz.uitdaging, oplossing: losPuzzelOp(pz.uitdaging, pz.bits) }).token; }
      const r = await vb.vraag({ ip, tokenWaarde: g.token, vraagTekst: vraag, pagina: 'https://websitegesprek.nl/proef' });
      if (teller.bereikt) return { apiFout: { soort: 'kostengrens_test', status: 0, type: '', uitleg: '' } };
      // Staat de vraagbaak in de proef uit (bijv. door een fout), stop dan zichtbaar in plaats van lege antwoorden te tellen.
      if (r.uit || r.fout) return { apiFout: { soort: 'proef_' + (r.reden || r.fout || 'uit'), status: r.status || 0, type: '', uitleg: '' } };
      const reg = tijdelijk.db.prepare('SELECT onderwerp FROM register WHERE id = ?').get(r.id || '');
      // Besluit 455: de vaste Engelse AI-melding hoort er bewust boven; de beoordelaar kijkt alleen naar het antwoord zelf.
      const antwoord = String(r.antwoord || '').startsWith(MELDING_EN_TEKST + '\n\n') ? String(r.antwoord).slice(MELDING_EN_TEKST.length + 2) : r.antwoord;
      return { ...r, antwoord, buiten: reg?.onderwerp === 'buiten_onderwerp' };
    }, { items, herhaalValkuilen: herhaal, beoordelaar });
    const kosten = { ...verbruik, euro: Math.round(verbruik.dollar * 0.95 * 1000) / 1000, euro_per_vraag: verbruik.aanroepen ? Math.round(verbruik.dollar * 0.95 / verbruik.aanroepen * 10000) / 10000 : 0 };
    if (u.apiFout) return { ok: false, denken: variant, fout: tekstApiFout(u.apiFout), apiFout: u.apiFout, bijVraag: u.bijVraag, grensBereikt: !!teller.bereikt, goed: 0, totaal: 0, lat: 0, valkuilFout: 0, uitslag: [], kosten };
    const ok = volledig ? u.geslaagd : u.goed >= Math.ceil(items.length * 0.9);
    return { ok, denken: variant, goed: u.goed, totaal: u.totaal, lat: u.lat, valkuilFout: u.valkuilFout, gemDuurMs: u.gemDuurMs, uitslag: u.uitslag, kosten };
  };
}

// V13: grens per testrun. Vragen: (vragen x herhalingen) per variant, plus hooguit 20 procent. Euro: vast bedrag
// (VRAAG_TEST_PLAFOND), los van de plafonds van de live vraagbaak.
export function testGrens(config, items = laadTestset(config.dataMap).items) {
  const perVariant = items.reduce((n, i) => n + (['valkuil', 'injectie'].includes(i.soort) ? HERHAAL_VALKUILEN : 2) * (i.beurten?.length || 1), 0);
  return { maxVragen: Math.ceil(perVariant * combinaties(config).length * 1.2), maxEuro: config.testPlafondEuro };
}

// W5 en V13: uitkomst van een volledige testrun. 'geslaagd' alleen met een geslaagde variant van een testmodel.
// Kostengrens bereikt = 'gezakt' (reden kostengrens_test, geen herhaling). API-, netwerk- of tegoedfout zonder geslaagde
// variant = 'fout' (technisch; het wisselscript probeert het hooguit 3 keer opnieuw). Anders 'gezakt' (inhoudelijk).
export function uitkomstVan(varianten, { grensBereikt = false } = {}) {
  const naam = kiesVariant(varianten);
  const g = naam ? varianten[naam] : null;
  if (g && g.geslaagd) return { uitkomst: 'geslaagd', reden: '' };
  if (grensBereikt) return { uitkomst: 'gezakt', reden: 'kostengrens_test' };
  if (Object.values(varianten).some((v) => v && v.fout)) return { uitkomst: 'fout', reden: 'technisch' };
  return { uitkomst: 'gezakt', reden: 'inhoudelijk' };
}

// De volledige testset voor één sleutel: alle combinaties, valkuilen 3 keer, met de vaste beoordelaar.
// Geeft het goedkeuringsbestand (W1) terug: sleutel, versie, tijd, gekozen model en variant, varianten en samenvatting.
export async function volledigeTestset({ config, kb, fetchFn = fetch, sleutel = poortSleutel(config), versie = '', grens = testGrens(config), log = () => {} }) {
  const { INSTRUCTIE_VERSIE } = await import('./instructie.mjs');
  const { BEOORDELAAR_VERSIE } = await import('./beoordelaar.mjs');
  const teller = { dollar: 0, vragen: 0, bereikt: false };
  const varianten = {};
  for (const [model, denken] of combinaties(config)) {
    if (teller.bereikt) break;
    const u = await maakProef({ config, fetchFn, volledig: true, herhaal: HERHAAL_VALKUILEN, denken, model, grens: { ...grens, teller } })(kb)
      .catch((e) => ({ ok: false, fout: `${e.soort || 'fout'} ${e.status || ''} ${e.message || ''} ${e.uitleg || ''}`.replace(/\s+/g, ' ').trim(), uitslag: [] }));
    varianten[`${model}|${denken}`] = { model, denken,
      geslaagd: !!u.ok, fout: u.fout || '', ...(u.apiFout ? { apiFout: u.apiFout, bij_vraag: u.bijVraag } : {}),
      goed: u.goed, totaal: u.totaal, lat: u.lat, valkuilFout: u.valkuilFout, gemDuurMs: u.gemDuurMs, kosten: u.kosten,
      fouten: (u.uitslag || []).filter((x) => !x.goed).map((x) => ({ id: x.id, soort: x.soort, fouten: x.details.map((d) => d.fouten.join('; ')), antwoord: x.details[0]?.antwoord, oordeel: x.details.find((d) => d.oordeel)?.oordeel?.toelichting, diag: x.details.find((d) => d.diag)?.diag })),
      antwoorden: (u.uitslag || []).map((x) => ({ id: x.id, goed: x.goed, antwoord: x.details.at(-1)?.antwoord, herkansing: !!x.details.at(-1)?.herkansing, oordeel: x.details.at(-1)?.oordeel ? { juist: x.details.at(-1).oordeel.juist, gegrond: x.details.at(-1).oordeel.gegrond, beantwoordt: x.details.at(-1).oordeel.beantwoordt, toezegging: x.details.at(-1).oordeel.toezegging, helder: x.details.at(-1).oordeel.helder, toelichting: x.details.at(-1).oordeel.toelichting } : null, blokken: x.details.at(-1)?.diag?.blokken })),
    };
    log(`volledige testset ${model} denken ${denken}: ${u.goed}/${u.totaal}, valkuilen fout ${u.valkuilFout}${u.fout ? ', fout ' + u.fout : ''}`);
  }
  const { uitkomst, reden } = uitkomstVan(varianten, { grensBereikt: teller.bereikt });
  const naam = uitkomst === 'geslaagd' ? kiesVariant(varianten) : null;
  const g = naam ? varianten[naam] : {};
  return {
    sleutel, versie, tijd: new Date().toISOString(), uitkomst, reden, geslaagd: uitkomst === 'geslaagd',
    gekozenNaam: naam, gekozenModel: g.model || null, gekozen: g.denken || null, model: g.model || null,
    instructie: INSTRUCTIE_VERSIE, beoordelaar: `${config.beoordelaarModel} ${BEOORDELAAR_VERSIE}`, kb_versie: kb?.versie || '',
    goed: g.goed, totaal: g.totaal, lat: g.lat, valkuilFout: g.valkuilFout, gemDuurMs: g.gemDuurMs,
    kosten_euro: Math.round(teller.dollar * 0.95 * 100) / 100, grens, varianten,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { laadConfig } = await import('./config.mjs');
  const { openOpslag } = await import('./opslag.mjs');
  const { maakVraagbaak } = await import('./vraagbaak.mjs');
  const args = process.argv.slice(2);
  const config = laadConfig();
  const i = args.indexOf('--model');
  if (i >= 0) config.model = args[i + 1];
  config.modus = 'aan'; // alleen voor de proef; wijzigt niets aan de live stand
  config.perIpUur = 10_000; config.perIpDag = 10_000; config.perTokenVragen = 100; config.tokensPerIpUur = 10_000; config.puzzelBits = 4;
  const opslag = openOpslag(config.dataMap);
  const vb = maakVraagbaak({ config, opslag });
  if (!vb.kb) { console.error('Geen actieve kennisbank.'); process.exit(2); }
  const { losPuzzelOp } = await import('./beveiliging.mjs');
  const ip = '127.0.0.9';
  const vraagFn = async (vraag, gesprek) => {
    if (!gesprek.token) {
      const p = vb.puzzel({ ip });
      gesprek.token = vb.token({ ip, uitdaging: p.uitdaging, oplossing: losPuzzelOp(p.uitdaging, p.bits) }).token;
    }
    const r = await vb.vraag({ ip, tokenWaarde: gesprek.token, vraagTekst: vraag, pagina: 'https://websitegesprek.nl/proef' });
    const reg = opslag.db.prepare('SELECT onderwerp FROM register WHERE id = ?').get(r.id || '');
    return { ...r, buiten: reg?.onderwerp === 'buiten_onderwerp' };
  };
  const filter = args.includes('--snel') ? (it) => it.soort === 'feit' : null;
  const { maakBeoordelaar } = await import('./beoordelaar.mjs');
  const { kennisbankAlsTekst } = await import('./kennisbank.mjs');
  const j = args.indexOf('--denken');
  if (j >= 0) config.denkenVast = args[j + 1];
  const beoordelaar = maakBeoordelaar({ config, kbTekst: kennisbankAlsTekst(vb.kb) });
  const u = await draaiTestset(vraagFn, { filter, beoordelaar, herhaalValkuilen: args.includes('--snel') ? 1 : 3 });
  if (u.apiFout) { console.log(`API-fout bij ${u.bijVraag}: ${tekstApiFout(u.apiFout)}`); process.exit(3); }
  opslag.db.prepare("DELETE FROM register WHERE pagina = '/proef'").run();
  for (const r of u.uitslag) if (!r.goed) console.log(`FOUT ${r.id} (${r.soort}): ${r.details.map((d) => d.fouten.join('; ')).join(' | ')}\n  antwoord: ${r.details[0].antwoord}`);
  console.log(`\nUitslag model ${config.model}: ${u.goed}/${u.totaal} goed (lat ${u.lat}), valkuilen fout: ${u.valkuilFout} → ${u.geslaagd ? 'GESLAAGD' : 'NIET GESLAAGD'}`);
  opslag.zetStaat(`proef:${config.model}`, { tijd: new Date().toISOString(), goed: u.goed, totaal: u.totaal, valkuilFout: u.valkuilFout, geslaagd: u.geslaagd });
  process.exit(u.geslaagd ? 0 : 1);
}
