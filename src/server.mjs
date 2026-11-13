// Vraagbaak Websitegesprek - basisversie (0.0.x): alleen een gezondheidscontrole.
// De echte vraagbaak (ontwerp 0.2, besluiten 398-402) komt in latere versies.
// Nooit de API-sleutel zelf tonen of loggen; alleen of hij is gezet.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const VERSIE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version;
const START = new Date().toISOString();

export function sleutelGezet(env = process.env) {
  const k = env.ANTHROPIC_API_KEY || '';
  return k.startsWith('sk-ant-') && k.length > 20;
}

export function maakServer(env = process.env) {
  return http.createServer((req, res) => {
    const kop = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    };
    const url = new URL(req.url || '/', 'http://x');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, kop);
      res.end(JSON.stringify({ ok: true, versie: VERSIE, sinds: START, sleutel_gezet: sleutelGezet(env), vraagbaak_actief: false }));
      return;
    }
    res.writeHead(404, kop);
    res.end(JSON.stringify({ ok: false, fout: 'niet gevonden' }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8090);
  const host = process.env.HOST || '127.0.0.1';
  maakServer().listen(port, host, () => {
    console.log(`vraagbaak ${VERSIE} luistert op ${host}:${port}; sleutel gezet: ${sleutelGezet()}`);
  });
}
