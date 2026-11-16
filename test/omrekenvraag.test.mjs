// Besluit 545: bij een vraag om een andere valuta noemt de vraagbaak de europrijzen en belooft niet
// dat we via WhatsApp of mail omrekenen (valkuil v05 zakte 16 nov 2026 daarop, waardoor de vraagbaak uitging).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bron = readFileSync(new URL('../src/instructie.mjs', import.meta.url), 'utf8');

test('instructie: omrekenvraag krijgt europrijzen, geen belofte van omrekenen via WhatsApp of mail', () => {
  assert.match(bron, /prijzen op de site in euro staan/);
  assert.match(bron, /zeg niet dat we het via WhatsApp of mail omrekenen/);
});

test('instructieversie is opgehoogd, zodat de testset opnieuw draait', () => {
  assert.doesNotMatch(bron, /INSTRUCTIE_VERSIE = '2026-11-15\.8'/);
});
