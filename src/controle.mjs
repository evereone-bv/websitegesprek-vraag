// Controle van elk antwoord in code (ontwerp §4.5, V3, VB7). Faalt er iets, dan krijgt de bezoeker de doorverwijzing.
import { normaliseer, vindPagina } from './kennisbank.mjs';

export const STRIKTE_ONDERWERPEN = ['prijs', 'proef', 'opzeggen', 'privacy', 'voorwaarden'];

// Woorden die op een belofte of uitzondering wijzen. Alleen toegestaan als de bronpagina ze zelf gebruikt.
export const RISICOWOORDEN = [
  'korting', 'kortingscode', 'gratis maand', 'garantie', 'gegarandeerd', 'geld terug', 'geld-terug', 'beloof', 'beloven',
  'uitzondering', 'speciaal voor jou', 'altijd gratis', 'levenslang', 'nooit meer', '100%', 'honderd procent',
  'discount', 'guarantee', 'guaranteed', 'refund', 'promise', 'exception', 'lifetime', 'free forever',
];

export const DOORVERWIJZING = {
  nl: 'Dat weet ik niet zeker genoeg om je goed te helpen. Vraag het ons via WhatsApp of mail, dan krijg je persoonlijk antwoord.',
  en: "I'm not sure enough to answer that well. Ask us via WhatsApp or email and you'll get a personal answer.",
};
export const NL_GELDT = {
  nl: '',
  en: 'Our terms are in Dutch; the Dutch text applies.',
};

// Getallen met eenheid uit een tekst: bedragen, dagen, maanden, uren, minuten, procenten.
export function getallenMetEenheid(tekst) {
  const s = normaliseer(tekst).replace(/(\d)\.(\d{3})\b/g, '$1$2');
  const uit = new Set();
  const getal = (x) => String(Number(String(x).replace(',', '.')));
  for (const m of s.matchAll(/(?:€|eur|euro)\s?(\d+(?:[.,]\d{1,2})?)/g)) uit.add('€' + getal(m[1]));
  for (const m of s.matchAll(/(\d+(?:[.,]\d{1,2})?)\s?(?:€|euro|eur)\b/g)) uit.add('€' + getal(m[1]));
  for (const m of s.matchAll(/\$\s?(\d+(?:[.,]\d{1,2})?)/g)) uit.add('$' + getal(m[1]));
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s?(%|procent|percent)/g)) uit.add(getal(m[1]) + '%');
  const eenheden = { dag: 'dag', dagen: 'dag', day: 'dag', days: 'dag', maand: 'maand', maanden: 'maand', month: 'maand', months: 'maand',
    uur: 'uur', uren: 'uur', hour: 'uur', hours: 'uur', minuut: 'minuut', minuten: 'minuut', minute: 'minuut', minutes: 'minuut',
    week: 'week', weken: 'week', weeks: 'week', jaar: 'jaar', jaren: 'jaar', year: 'jaar', years: 'jaar' };
  const telwoorden = { een: 1, één: 1, one: 1, twee: 2, two: 2, drie: 3, three: 3, vier: 4, four: 4, vijf: 5, five: 5, zes: 6, six: 6, zeven: 7, seven: 7, tien: 10, ten: 10, twaalf: 12, twelve: 12, dertig: 30, thirty: 30 };
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?|een|één|one|twee|two|drie|three|vier|four|vijf|five|zes|six|zeven|seven|tien|ten|twaalf|twelve|dertig|thirty)\s?(dagen|dag|days|day|maanden|maand|months|month|uren|uur|hours|hour|minuten|minuut|minutes|minute|weken|week|weeks|jaren|jaar|years|year)\b/g)) {
    const n = telwoorden[m[1]] ?? Number(m[1].replace(',', '.'));
    if (m[1] === 'een' || m[1] === 'één' || m[1] === 'one') continue; // 'een dag' is te algemeen om te controleren
    uit.add(n + ' ' + eenheden[m[2]]);
  }
  return uit;
}

export function parseModelUitvoer(tekst) {
  const s = String(tekst || '').trim();
  const begin = s.indexOf('{');
  const eind = s.lastIndexOf('}');
  if (begin < 0 || eind <= begin) return null;
  try {
    const o = JSON.parse(s.slice(begin, eind + 1));
    return typeof o === 'object' && o ? o : null;
  } catch { return null; }
}

function verwijderLinks(t) {
  return t.replace(/https?:\/\/\S+/gi, '').replace(/\bwww\.\S+/gi, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

export function controleer(uitvoer, kb, { taal = 'nl', kbTekst, maxTekens = 700 } = {}) {
  const t = taal === 'en' ? 'en' : 'nl';
  const doorverwijzing = (reden, bron = null) => ({ ok: false, vervangen: true, reden, antwoord: DOORVERWIJZING[t], bron: bron || 'https://websitegesprek.nl/contact/', onderwerp: uitvoer?.onderwerp || 'onbekend', zeker: false, doorverwezen: true });
  if (!uitvoer) return doorverwijzing('geen_json');
  const onderwerp = String(uitvoer.onderwerp || 'overig').toLowerCase();
  if (uitvoer.buiten_onderwerp === true) {
    // Vaste vriendelijke weigertekst uit de instructie; wel controleren op lengte en links.
    const a = verwijderLinks(String(uitvoer.antwoord || '')).trim();
    if (!a || a.length > maxTekens) return doorverwijzing('buiten_onderwerp_vorm');
    return { ok: true, vervangen: false, reden: '', antwoord: a, bron: 'https://websitegesprek.nl/', onderwerp: 'buiten_onderwerp', zeker: true, doorverwezen: false };
  }
  if (uitvoer.zeker === false) return { ...doorverwijzing('niet_zeker', vindPagina(kb, uitvoer.bron_url)?.url), ok: true, vervangen: false };

  let antwoord = verwijderLinks(String(uitvoer.antwoord || '')).replace(/\s+\n/g, '\n').trim();
  if (!antwoord) return doorverwijzing('leeg');
  if (antwoord.length > maxTekens) return doorverwijzing('te_lang');

  const pagina = vindPagina(kb, uitvoer.bron_url);
  if (!pagina) return doorverwijzing('bron_onbekend');
  const paginaNorm = normaliseer(pagina.tekst + '\n' + (kb.algemeen || ''));

  const citaat = String(uitvoer.citaat || '').trim();
  if (STRIKTE_ONDERWERPEN.includes(onderwerp) && citaat.length < 8) return doorverwijzing('citaat_ontbreekt', pagina.url);
  if (citaat && !paginaNorm.includes(normaliseer(citaat))) return doorverwijzing('citaat_niet_op_pagina', pagina.url);

  // Alle getallen met eenheid uit het antwoord moeten in de kennisbank staan (VB7: niet omrekenen).
  const kbGetallen = getallenMetEenheid(kbTekst || '');
  for (const g of getallenMetEenheid(antwoord)) {
    if (g.startsWith('$')) return doorverwijzing('valuta', pagina.url);
    if (!kbGetallen.has(g)) return doorverwijzing('getal_niet_in_kennisbank:' + g, pagina.url);
  }

  const antwoordNorm = normaliseer(antwoord);
  for (const w of RISICOWOORDEN) {
    if (antwoordNorm.includes(w) && !paginaNorm.includes(w)) return doorverwijzing('risicowoord:' + w, pagina.url);
  }

  // VB7: anderstalig + juridisch/prijs-onderwerp → zin dat de Nederlandse tekst geldt.
  if (t !== 'nl' && STRIKTE_ONDERWERPEN.includes(onderwerp) && !antwoord.includes(NL_GELDT[t])) antwoord += ' ' + NL_GELDT[t];

  return { ok: true, vervangen: false, reden: '', antwoord, bron: pagina.url, onderwerp, zeker: true, doorverwezen: false };
}
