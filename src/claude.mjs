// Aanroep van de Claude API (Messages). Geen tools, geen Files of Batch API (VB9), altijd inference_geo "us" (VB1).
// Besluit 447: de pagina's gaan mee als search_result-blokken met citations aan (Anthropic, "Search results" en
// "Citations"); de API haalt het geciteerde stuk zelf letterlijk uit de pagina. Citations en een afgedwongen
// JSON-formaat (output_config.format) gaan volgens Anthropic niet samen, dus het antwoord is gewone tekst.
// Instructie en pagina's zijn cache-blokken (prompt caching), zodat vervolgvragen goedkoop zijn.
import { INSTRUCTIE } from './instructie.mjs';

export class ApiFout extends Error {
  constructor(soort, status, bericht, uitleg = '') { super(bericht); this.soort = soort; this.status = status; this.uitleg = uitleg; }
}

// Foutmelding van Anthropic, ingekort en opgeschoond: nooit iets dat op een sleutel lijkt (besluit 443).
export function veiligeUitleg(tekst) {
  return String(tekst || '').replace(/sk-ant-[A-Za-z0-9_-]+/g, '[sleutel]').replace(/\s+/g, ' ').slice(0, 200);
}

// Nadenken (besluit 447): 'uit' = thinking disabled (Haiku 5.5 staat dat toe bij effort high of lager);
// 'low' = adaptief nadenken op effort low. Denktokens tellen mee in max_tokens, dus 'low' krijgt meer ruimte.
export function denkInstelling(denken, maxUitvoer) {
  if (denken === 'uit') return { thinking: { type: 'disabled' }, max_tokens: maxUitvoer };
  return { thinking: { type: 'adaptive' }, output_config: { effort: denken || 'low' }, max_tokens: Math.max(maxUitvoer, 4000) };
}

// De kennisbank als search_result-blokken: één per pagina, plus de algemene gegevens (staan op elke pagina).
// Besluit 461: cache van 1 uur voor instructie en pagina's (vaste inhoud), zodat ook een eerste vraag na een rustige
// periode uit de cache komt (sneller). Bron: platform.claude.com/docs/en/build-with-claude/prompt-caching (1h = 2x invoerprijs bij schrijven).
export function cacheInstelling(ttl) { return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' }; }
export function bronBlokken(kb, ttl = '1h') {
  const blokken = [];
  if (kb.algemeen) blokken.push({ type: 'search_result', source: 'https://websitegesprek.nl/', title: 'Algemene gegevens (op elke pagina van websitegesprek.nl)', content: [{ type: 'text', text: kb.algemeen }], citations: { enabled: true } });
  for (const p of kb.paginas) {
    blokken.push({ type: 'search_result', source: p.url, title: p.titel || p.url, content: [{ type: 'text', text: p.tekst }], citations: { enabled: true } });
  }
  if (blokken.length) blokken[blokken.length - 1].cache_control = cacheInstelling(ttl);
  return blokken;
}

// Eén aanroep naar /v1/messages met nette foutsoorten.
export async function roepClaude({ config, body, fetchFn = fetch, signaal }) {
  let res;
  try {
    res = await fetchFn(`${config.apiBasis}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiSleutel, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: signaal,
    });
  } catch (e) {
    throw new ApiFout(e?.name === 'AbortError' ? 'tijd' : 'netwerk', 0, 'API niet bereikbaar', veiligeUitleg(e?.cause?.code || e?.message));
  }
  let data = null;
  try { data = await res.json(); } catch { /* leeg */ }
  if (!res.ok) {
    const type = data?.error?.type || '';
    const uitleg = veiligeUitleg(data?.error?.message);
    // Nooit de sleutel of de volledige foutmelding loggen; alleen soort, status en een opgeschoonde korte melding.
    if (res.status === 401 || res.status === 403 || type === 'authentication_error' || type === 'permission_error') throw new ApiFout('sleutel', res.status, type, uitleg);
    if (res.status === 402 || /credit|billing|spend/i.test(String(data?.error?.message || ''))) throw new ApiFout('tegoed', res.status, type, uitleg);
    if (res.status === 429) throw new ApiFout('druk', res.status, type, uitleg);
    throw new ApiFout('overig', res.status, type, uitleg);
  }
  return data || {};
}

// Vraag aan de vraagbaak: berichten = [{role, content: tekst}, ...]; de pagina's gaan voor de eerste vraag.
export async function vraagClaude({ config, kb, beurten, model, denken = 'low', fetchFn = fetch, signaal }) {
  const berichten = beurten.map((b, i) => (i === 0
    ? { role: 'user', content: [...bronBlokken(kb, config.cacheTtl), { type: 'text', text: String(b.content) }] }
    : { role: b.role, content: String(b.content) }));
  const body = {
    model,
    ...denkInstelling(denken, config.maxUitvoerTokens),
    inference_geo: config.inferenceGeo,
    system: [{ type: 'text', text: INSTRUCTIE, cache_control: cacheInstelling(config.cacheTtl) }],
    messages: berichten,
  };
  const data = await roepClaude({ config, body, fetchFn, signaal });
  const tekstBlokken = (data?.content || []).filter((b) => b.type === 'text');
  const tekst = tekstBlokken.map((b) => b.text).join('');
  const citaties = tekstBlokken.flatMap((b) => (b.citations || []).map((c) => ({ bron: c.source || c.url || '', tekst: c.cited_text || '' })));
  const blokken = tekstBlokken.map((b) => ({ tekst: String(b.text || '').slice(0, 160), citaten: (b.citations || []).map((x) => String(x.cited_text || '').slice(0, 80)) }));
  return { tekst, citaties, blokken, usage: data?.usage || {}, model: data?.model || model, stop: data?.stop_reason || '' };
}
