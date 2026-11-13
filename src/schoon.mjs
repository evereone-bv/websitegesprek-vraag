// Persoonsgegevens weghalen vóórdat een vraag naar Anthropic of het register gaat (ontwerp §8.5, VB6).
// Niet waterdicht; de AI-melding (V1) blijft daarom staan.
const PATRONEN = [
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-mail weggelaten]'],
  [/\b[A-Z]{2}\d{2}\s?[A-Z]{4}(?:\s?\d{4}){2}\s?\d{2}\b/gi, '[rekening weggelaten]'], // IBAN NL
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, '[rekening weggelaten]'], // IBAN overig
  [/(?:\+|00)\d{1,3}[\s-]?(?:\(0\))?[\s-]?\d(?:[\s-]?\d){7,11}/g, '[telefoon weggelaten]'],
  [/\b0\d(?:[\s-]?\d){8}\b/g, '[telefoon weggelaten]'],
  [/\b\d{4}\s?[A-Z]{2}\s+\d{1,5}[a-z]?\b/gi, '[adres weggelaten]'], // postcode + huisnummer
  [/\b\d{4}\s?[A-Z]{2}\b/g, '[postcode weggelaten]'],
  [/\b\d{9}\b/g, '[nummer weggelaten]'], // BSN of ander 9-cijferig nummer
  [/\b\d{8}\b/g, '[nummer weggelaten]'], // KvK-nummer
  [/\b(?:\d[ -]?){13,19}\b/g, '[kaartnummer weggelaten]'],
];

const ONZICHTBAAR = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2064\\ufeff]', 'g');

export function schoonOp(tekst) {
  let s = String(tekst || '');
  // Onzichtbare en stuurtekens weg, witruimte samenvoegen.
  s = s.replace(ONZICHTBAAR, '');
  let weggelaten = false;
  for (const [re, vervang] of PATRONEN) {
    s = s.replace(re, () => { weggelaten = true; return vervang; });
  }
  return { tekst: s.replace(/[ \t]+/g, ' ').trim(), weggelaten };
}

// Eenvoudige taalherkenning voor VB7 (Nederlands of niet).
const NL = /\b(de|het|een|ik|je|jij|wat|hoe|kan|kun|mijn|niet|wel|ook|voor|met|van|zijn|is|website|kosten|prijs|opzeggen|proberen)\b/gi;
const EN = /\b(the|a|an|i|you|what|how|can|my|not|is|are|for|with|of|price|cost|cancel|trial|does|do)\b/gi;
export function taal(tekst) {
  const nl = (String(tekst).match(NL) || []).length;
  const en = (String(tekst).match(EN) || []).length;
  return en > nl ? 'en' : 'nl';
}
