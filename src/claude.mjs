// Aanroep van de Claude API (Messages). Geen tools, geen Files of Batch API (VB9), altijd inference_geo "us" (VB1).
// Instructie en kennisbank als twee cache-blokken (prompt caching), zodat vervolgvragen goedkoop zijn.
import { INSTRUCTIE } from './instructie.mjs';

export class ApiFout extends Error {
  constructor(soort, status, bericht) { super(bericht); this.soort = soort; this.status = status; }
}

export async function vraagClaude({ config, kbTekst, beurten, model, fetchFn = fetch, signaal }) {
  const body = {
    model,
    max_tokens: config.maxUitvoerTokens,
    temperature: 0,
    inference_geo: config.inferenceGeo,
    system: [
      { type: 'text', text: INSTRUCTIE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `<kennisbank>\n${kbTekst}\n</kennisbank>`, cache_control: { type: 'ephemeral' } },
    ],
    messages: beurten,
  };
  let res;
  try {
    res = await fetchFn(`${config.apiBasis}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.apiSleutel, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: signaal,
    });
  } catch (e) {
    throw new ApiFout(e?.name === 'AbortError' ? 'tijd' : 'netwerk', 0, 'API niet bereikbaar');
  }
  let data = null;
  try { data = await res.json(); } catch { /* leeg */ }
  if (!res.ok) {
    const type = data?.error?.type || '';
    // Nooit de sleutel of de volledige foutmelding loggen; alleen soort en status.
    if (res.status === 401 || res.status === 403 || type === 'authentication_error' || type === 'permission_error') throw new ApiFout('sleutel', res.status, type);
    if (res.status === 402 || /credit|billing|spend/i.test(String(data?.error?.message || ''))) throw new ApiFout('tegoed', res.status, type);
    if (res.status === 429) throw new ApiFout('druk', res.status, type);
    throw new ApiFout('overig', res.status, type);
  }
  const tekst = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { tekst, usage: data?.usage || {}, model: data?.model || model };
}
