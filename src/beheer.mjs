// Beheer op de server (in de container):  node src/beheer.mjs <opdracht>
//   status            stand van de vraagbaak
//   aan               weer aanzetten na een automatische uitschakeling (alleen na akkoord Raymond, besluit 400)
//   uit [reden]       uitzetten
//   ververs           kennisbank nu opnieuw ophalen
//   export [dagen]    register als JSON (zonder IP of token) voor rapportage/Sheet
//   logboek           laatste 50 regels
import { laadConfig } from './config.mjs';
import { openOpslag } from './opslag.mjs';
import { maakVraagbaak } from './vraagbaak.mjs';

const [opdracht, arg] = process.argv.slice(2);
const config = laadConfig();
const opslag = openOpslag(config.dataMap);
const vb = maakVraagbaak({ config, opslag });

switch (opdracht) {
  case 'status': console.log(JSON.stringify({ ...vb.gezondheid(), uit: opslag.staat('uit', null) }, null, 2)); break;
  case 'aan': vb.zetAan(); console.log('Aangezet.'); break;
  case 'uit': vb.zetUit(arg || 'handmatig'); console.log('Uitgezet.'); break;
  case 'ververs': console.log(JSON.stringify(await vb.ververs(), null, 2)); break;
  case 'export': {
    const dagen = Number(arg || 7);
    const rijen = opslag.db.prepare('SELECT id, tijd, pagina, vraag, antwoord, bron, onderwerp, zeker, doorverwezen, vervangen, reden, duim, kb_versie, model, taal FROM register WHERE tijd >= ? ORDER BY tijd')
      .all(Date.now() - dagen * 86_400_000).map((r) => ({ ...r, tijd: new Date(r.tijd).toISOString() }));
    console.log(JSON.stringify(rijen, null, 2));
    break;
  }
  case 'logboek': for (const r of opslag.db.prepare('SELECT * FROM logboek ORDER BY tijd DESC LIMIT 50').all()) console.log(new Date(r.tijd).toISOString(), r.soort, r.tekst); break;
  default: console.log('Opdrachten: status | aan | uit [reden] | ververs | export [dagen] | logboek');
}
