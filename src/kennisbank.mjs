// Kennisbank: schone tekst van de openbare pagina's van websitegesprek.nl (ontwerp 0.2 §4.2/4.3).
// Alleen vaste adressen op https://websitegesprek.nl, geen redirects volgen, maximale grootte.
import { createHash } from 'node:crypto';

export const BASIS = 'https://websitegesprek.nl';
// Pagina's die niet in de sitemap staan (noindex) maar wel vragen beantwoorden.
export const EXTRA_PADEN = ['/start/', '/opzeggen/', '/proberen/'];
// Nooit opnemen: bedank- en tussenpagina's, concepten, alles met een vraagteken.
export const UITSLUITEN = [/\/bedankt/i, /\/gestart/i, /\/verstuurd/i, /\/concept/i, /\?/, /\/wp-/i, /\/feed/i];
export const MAX_BYTES_PAGINA = 1_500_000;
export const MAX_PAGINAS = 40;

export function padToegestaan(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.hostname !== 'websitegesprek.nl') return false;
  if (u.search || u.hash) return false;
  return !UITSLUITEN.some((re) => re.test(u.pathname));
}

const ENTITEITEN = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', eacute: 'é', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü' };
export function ontsnap(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITEITEN[e.toLowerCase()] ?? m;
  });
}

// HTML naar leesbare tekst. Bewust zonder afhankelijkheden.
export function htmlNaarTekst(html) {
  let h = String(html);
  const titel = ontsnap((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
  h = h.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(head)\b[\s\S]*?<\/head>/gi, ' ');
  // Cookiemelding en zwevende knoppen zijn geen inhoud.
  h = h.replace(/<(div|section|aside)\b[^>]*(cookie|cmplz|wg-wa|wg-totop)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|blockquote|details|summary)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<h([1-6])\b[^>]*>/gi, (m, n) => '\n' + '#'.repeat(Number(n)) + ' ')
    .replace(/<[^>]+>/g, ' ');
  const regels = ontsnap(h).split('\n').map((r) => r.replace(/[ \t ]+/g, ' ').trim()).filter(Boolean);
  // Dubbele regels (menu, footer die op elke pagina staan) haalt de kennisbank-bouwer later per site weg.
  const uit = [];
  for (const r of regels) if (uit[uit.length - 1] !== r) uit.push(r);
  return { titel, tekst: uit.join('\n') };
}

export function normaliseer(s) {
  return String(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

export function hash(s) {
  return createHash('sha256').update(s).digest('hex');
}

// Regels die op (bijna) elke pagina staan, zijn menu/footer: één keer bewaren als 'algemeen'.
export function ontdubbel(paginas) {
  const telling = new Map();
  for (const p of paginas) for (const r of new Set(p.tekst.split('\n'))) telling.set(r, (telling.get(r) || 0) + 1);
  const grens = Math.max(3, Math.ceil(paginas.length * 0.6));
  const algemeen = [...telling.entries()].filter(([, n]) => n >= grens).map(([r]) => r);
  const algSet = new Set(algemeen);
  return {
    algemeen: algemeen.join('\n'),
    paginas: paginas.map((p) => ({ ...p, tekst: p.tekst.split('\n').filter((r) => !algSet.has(r)).join('\n') })),
  };
}

async function haal(url, fetchFn) {
  const res = await fetchFn(url, { redirect: 'manual', headers: { 'User-Agent': 'websitegesprek-vraagbaak/kennisbank', Accept: 'text/html,application/xml' } });
  const buf = Buffer.from(await res.arrayBuffer());
  const tekst = buf.toString('utf8');
  // SiteGround stuurt soms een botcontrole (202 + sgcaptcha) in plaats van de pagina.
  if (res.status === 202 || /sgcaptcha/.test(tekst.slice(0, 600))) throw new Error(`${url}: botcontrole van de hosting (sgcaptcha)`);
  if (res.status !== 200) throw new Error(`${url} gaf ${res.status}`);
  if (buf.length > MAX_BYTES_PAGINA) throw new Error(`${url} is te groot`);
  return tekst;
}

export async function adressenUitSitemap(fetchFn = fetch) {
  const index = await haal(`${BASIS}/sitemap_index.xml`, fetchFn);
  const kaarten = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((u) => u.startsWith(BASIS + '/') && u.endsWith('.xml'));
  const adressen = new Set();
  for (const k of kaarten.slice(0, 5)) {
    const xml = await haal(k, fetchFn);
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) adressen.add(m[1].trim());
  }
  for (const p of EXTRA_PADEN) adressen.add(BASIS + p);
  return [...adressen].filter(padToegestaan).slice(0, MAX_PAGINAS);
}

// Bouwt een nieuwe kennisbank. Geeft { versie, paginas:[{url,titel,tekst}], algemeen, tekens }.
export async function bouwKennisbank({ fetchFn = fetch, extraDocumenten = [] } = {}) {
  const adressen = await adressenUitSitemap(fetchFn);
  const ruw = [];
  for (const url of adressen) {
    const { titel, tekst } = htmlNaarTekst(await haal(url, fetchFn));
    if (tekst.length > 50) ruw.push({ url, titel, tekst });
  }
  const { algemeen, paginas } = ontdubbel(ruw);
  for (const d of extraDocumenten) paginas.push(d); // bijv. pdf-teksten uit de repo
  const inhoud = JSON.stringify({ algemeen, paginas });
  return { versie: hash(inhoud).slice(0, 12), algemeen, paginas, tekens: inhoud.length };
}

// Tekst voor in de instructie: elke pagina met adres, zodat het model een bron kan noemen.
export function kennisbankAlsTekst(kb) {
  const delen = [`<algemeen>\n${kb.algemeen}\n</algemeen>`];
  for (const p of kb.paginas) delen.push(`<pagina url="${p.url}" titel="${p.titel.replace(/"/g, "'")}">\n${p.tekst}\n</pagina>`);
  return delen.join('\n\n');
}

export function vindPagina(kb, url) {
  const zoek = String(url || '').replace(/#.*$/, '');
  return kb.paginas.find((p) => p.url === zoek || p.url === zoek + '/' || p.url + '/' === zoek) || null;
}
