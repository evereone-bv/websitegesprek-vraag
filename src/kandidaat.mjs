// Testcontainer van besluit 546.1 (blauw-groen): draait in een aparte container (vraag-kandidaat), zonder bezoekers,
// zonder het volume vraagdata en met een eigen kostengrens (W3, V13). Wordt alleen aangeroepen door deploy/wissel.sh.
//   node src/kandidaat.mjs sleutel        → schrijft de sleutel van deze versie met deze instellingen (V1 van 546)
//   node src/kandidaat.mjs test <map>     → volledige testset; schrijft <map>/uitslag.json; exitcode 0 geslaagd,
//                                           1 gezakt, 2 technische fout (W5)
import { writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { laadConfig } from './config.mjs';
import { poortSleutel, volledigeTestset } from './proef.mjs';
import { bouwKennisbank } from './kennisbank.mjs';

export async function kennisbankVoorTest({ fetchFn = fetch } = {}) {
  // De kennisbank zit niet in de sleutel (V9a van 546). Eerst de actuele site, anders de reserve-snapshot uit het image.
  try { return await bouwKennisbank({ fetchFn }); } catch { /* site niet bereikbaar */ }
  return JSON.parse(readFileSync(new URL('../kennisbank/snapshot.json', import.meta.url), 'utf8'));
}

export async function draaiKandidaat({ config, map, fetchFn = fetch, versie = '' }) {
  const kb = await kennisbankVoorTest({ fetchFn });
  const uit = await volledigeTestset({ config, kb, fetchFn, versie, log: (t) => console.log(t) });
  const tmp = join(map, 'uitslag.json.tmp');
  writeFileSync(tmp, JSON.stringify(uit));
  renameSync(tmp, join(map, 'uitslag.json'));
  return uit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [opdracht, map] = process.argv.slice(2);
  const config = laadConfig();
  if (opdracht === 'sleutel') {
    process.stdout.write(poortSleutel(config) + '\n');
  } else if (opdracht === 'test' && map) {
    const versie = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
    const u = await draaiKandidaat({ config, map, versie });
    console.log(`uitkomst: ${u.uitkomst}${u.reden ? ' (' + u.reden + ')' : ''}; kosten € ${u.kosten_euro}`);
    process.exit(u.uitkomst === 'geslaagd' ? 0 : u.uitkomst === 'gezakt' ? 1 : 2);
  } else {
    console.log('Gebruik: node src/kandidaat.mjs sleutel | test <map>');
    process.exit(64);
  }
}
