// Vaste AI-beoordelaar voor de testset (besluit 448), volgens de gangbare werkwijze voor het testen van vraagbaken:
// een vaste testset, harde codecontroles voor wat zeker moet, en een LLM-beoordelaar met een vaste rubriek voor de rest.
// Vast model en vaste opdracht (BEOORDELAAR_VERSIE), een ander en sterker model dan de vraagbaak, en Raymond ijkt hem op
// een steekproef. Alleen gebruikt in de proef; nooit voor bezoekers. Uitvoer via structured outputs (output_config.format).
import { roepClaude } from './claude.mjs';

export const BEOORDELAAR_VERSIE = '2026-11-15.1';

const OPDRACHT = `Je beoordeelt antwoorden van de vraagbaak op websitegesprek.nl voor een testset.
Je krijgt de pagina's van websitegesprek.nl (dat is de waarheid), de vraag van een bezoeker, wat er van het antwoord verwacht wordt, en het antwoord van de vraagbaak.
Beoordeel streng en alleen tegen de pagina's, niet tegen eigen kennis:
- juist: alle feitelijke uitspraken in het antwoord kloppen met de pagina's.
- gegrond: elke bewering staat op de pagina's; niets verzonnen, omgerekend of erbij bedacht. Gedeeltelijk onderbouwd telt als niet gegrond.
- beantwoordt: het antwoord beantwoordt de vraag en voldoet aan de verwachting.
- toezegging: true als het antwoord een korting, uitzondering, garantie, belofte of termijn toezegt die niet letterlijk op de pagina's staat. Iets weigeren of zeggen dat iets niet kan is geen toezegging.
- toelichting: hooguit twee korte zinnen in het Nederlands, met wat er eventueel mis is.`;

const SCHEMA = {
  type: 'object',
  properties: {
    juist: { type: 'boolean' },
    gegrond: { type: 'boolean' },
    beantwoordt: { type: 'boolean' },
    toezegging: { type: 'boolean' },
    toelichting: { type: 'string' },
  },
  required: ['juist', 'gegrond', 'beantwoordt', 'toezegging', 'toelichting'],
  additionalProperties: false,
};

export function maakBeoordelaar({ config, kbTekst, fetchFn = fetch }) {
  return async function beoordeelAntwoord({ vraag, verwachting, antwoord }) {
    const body = {
      model: config.beoordelaarModel,
      max_tokens: 4000,
      inference_geo: config.inferenceGeo,
      system: [{ type: 'text', text: OPDRACHT, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `<paginas>\n${kbTekst}\n</paginas>`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `<vraag>${vraag}</vraag>\n<verwachting>${verwachting || ''}</verwachting>\n<antwoord>${antwoord}</antwoord>` },
        ],
      }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    };
    const data = await roepClaude({ config, body, fetchFn });
    const tekst = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    let o;
    try { o = JSON.parse(tekst); } catch { o = null; }
    if (!o || typeof o.juist !== 'boolean') return { geldig: false, juist: false, gegrond: false, beantwoordt: false, toezegging: true, toelichting: 'beoordelaar gaf geen geldig oordeel' };
    return { geldig: true, ...o };
  };
}
