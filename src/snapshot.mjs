// Maakt kennisbank/snapshot.json opnieuw (reserve als de hosting de vraagserver met een botcontrole tegenhoudt).
// Draaien waar websitegesprek.nl wel bereikbaar is:  NODE_USE_ENV_PROXY=1 npm run kennisbank:snapshot
import { writeFileSync } from 'node:fs';
import { bouwKennisbank } from './kennisbank.mjs';
const kb = await bouwKennisbank();
writeFileSync(new URL('../kennisbank/snapshot.json', import.meta.url), JSON.stringify(kb, null, 1) + '\n');
console.log(`snapshot ${kb.versie}: ${kb.paginas.length} pagina's, ${kb.tekens} tekens`);
