// Controle van elk antwoord in code (ontwerp §4.5, V3, VB7). Faalt er iets, dan krijgt de bezoeker de doorverwijzing.
import { normaliseer, vindPagina } from './kennisbank.mjs';
import { CODE_DOORVERWIJZEN, CODE_BUITEN } from './instructie.mjs';

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
export const BUITEN = {
  nl: 'Ik beantwoord alleen vragen over Websitegesprek, op basis van de informatie op deze website. Waar kan ik je daarmee helpen?',
  en: 'I only answer questions about Websitegesprek, based on the information on this website. How can I help you with that?',
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

function verwijderLinks(t) {
  return t.replace(/https?:\/\/\S+/gi, '').replace(/\bwww\.\S+/gi, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

// Onderwerp voor het register, afgeleid van de geciteerde pagina (besluit 447: het model geeft geen JSON meer).
export function onderwerpVan(url) {
  try { const pad = new URL(url).pathname.replace(/\//g, ''); return pad || 'algemeen'; } catch { return 'overig'; }
}

// Besluit 477: tekstfragment naar de geciteerde zin. Alleen de eerste woorden van de eerste regel (robuust als de pagina
// opmaak tussen de woorden heeft); browsers die het niet kennen, openen de pagina gewoon bovenaan.
export function tekstFragment(citaat) {
  const regel = String(citaat || '').split(/\n/).map((r) => r.replace(/^#+\s*/, '').trim()).find((r) => r.split(/\s+/).length >= 3);
  if (!regel) return '';
  const woorden = regel.replace(/[“”"]/g, '').split(/\s+/).slice(0, 8).join(' ').replace(/[.,;:!?]+$/, '');
  const enc = encodeURIComponent(woorden).replace(/-/g, '%2D').replace(/,/g, '%2C').replace(/&/g, '%26');
  return '#:~:text=' + enc;
}

// Controle van één antwoord {tekst, citaties:[{bron, tekst}]} (besluit 447). De citaten zijn door de API letterlijk uit de
// pagina's gehaald; de code controleert nog wat de API niet doet: bron op onze site, getallen, valuta, risicowoorden, lengte.
export function controleer(uitvoer, kb, { taal = 'nl', kbTekst, maxTekens = 700 } = {}) {
  const t = taal === 'en' ? 'en' : 'nl';
  const doorverwijzing = (reden, bron = null) => ({ ok: false, vervangen: true, reden, antwoord: DOORVERWIJZING[t], bron: bron || 'https://websitegesprek.nl/contact/', onderwerp: 'onbekend', zeker: false, doorverwezen: true });
  const ruw = String(uitvoer?.tekst || '').trim();
  if (!ruw) return doorverwijzing('leeg');
  if (ruw.includes(CODE_BUITEN)) return { ok: true, vervangen: false, reden: '', antwoord: BUITEN[t], bron: 'https://websitegesprek.nl/', onderwerp: 'buiten_onderwerp', zeker: true, doorverwezen: false };
  if (ruw.includes(CODE_DOORVERWIJZEN)) return { ...doorverwijzing('niet_zeker'), ok: true, vervangen: false };

  let antwoord = verwijderLinks(ruw).replace(/[*_#`]/g, '').replace(/\s+\n/g, '\n').trim();
  if (antwoord.length > maxTekens) return doorverwijzing('te_lang');

  // Elke geciteerde bron moet een pagina van onze kennisbank zijn; zonder bronvermelding geen antwoord.
  const citaties = (uitvoer?.citaties || []).filter((c) => c && c.bron);
  if (!citaties.length) return doorverwijzing('geen_bronvermelding');
  const paginas = [];
  for (const c of citaties) {
    const p = vindPagina(kb, c.bron);
    if (!p) return doorverwijzing('bron_onbekend');
    if (!paginas.includes(p)) paginas.push(p);
  }
  // Besluit 477: bron voor de bezoeker = de specifieke pagina als die geciteerd is (de homepage alleen als die de enige
  // bron is), en daarvan de meest geciteerde. De link springt naar de geciteerde zin (tekstfragment, #:~:text=).
  const telling = new Map();
  for (const c of citaties) { const u = vindPagina(kb, c.bron).url; telling.set(u, (telling.get(u) || 0) + 1); }
  const isHome = (u) => { try { return new URL(u).pathname === '/'; } catch { return false; } };
  const gesorteerd = [...telling.entries()].sort((a, b) => (isHome(a[0]) - isHome(b[0])) || (b[1] - a[1]));
  const bronPagina = gesorteerd[0][0];
  const citaatVoorBron = citaties.find((c) => vindPagina(kb, c.bron).url === bronPagina && String(c.tekst || '').trim());
  const bron = bronPagina + tekstFragment(citaatVoorBron?.tekst);
  const paginaNorm = normaliseer(paginas.map((p) => p.tekst).join('\n') + '\n' + (kb.algemeen || ''));

  // Alle getallen met eenheid uit het antwoord moeten in de kennisbank staan (VB7: niet omrekenen).
  const kbGetallen = getallenMetEenheid(kbTekst || '');
  for (const g of getallenMetEenheid(antwoord)) {
    if (g.startsWith('$')) return doorverwijzing('valuta', bron);
    if (!kbGetallen.has(g)) return doorverwijzing('getal_niet_in_kennisbank:' + g, bron);
  }

  // Risicowoorden alleen als een geciteerde pagina ze zelf gebruikt.
  const antwoordNorm = normaliseer(antwoord);
  for (const w of RISICOWOORDEN) {
    if (antwoordNorm.includes(w) && !paginaNorm.includes(w)) return doorverwijzing('risicowoord:' + w, bron);
  }

  // VB7: anderstalig antwoord → zin dat de Nederlandse tekst geldt.
  if (t !== 'nl' && !antwoord.includes(NL_GELDT[t])) antwoord += ' ' + NL_GELDT[t];

  return { ok: true, vervangen: false, reden: '', antwoord, bron, onderwerp: onderwerpVan(bron), zeker: true, doorverwezen: false };
}
