// Besluit 480 (voorwaarde Raymond 15 nov 21:49, review S11, Juridisch RV4): de repository is openbaar. Een commit of pull
// request mag nooit een echt antwoordnummer (V-XXXXXX) bevatten. Alleen de plaatshouder V-XXXXXX zelf is toegestaan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

// Zelfde tekenset als antwoordId() in src/beveiliging.mjs.
const NUMMER = /\bV-[A-HJ-NP-Z2-9]{6}\b/g;
export function vindNummers(tekst) {
  return [...String(tekst || '').matchAll(NUMMER)].map((m) => m[0]).filter((n) => n !== 'V-XXXXXX');
}
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };

test('480: vindNummers herkent echte antwoordnummers en laat de plaatshouder staan', () => {
  assert.deepEqual(vindNummers('antwoord V-LNE8D5 en V-XXXXXX'), ['V-LNE8D5']);
  assert.deepEqual(vindNummers('A-1, V-12, V-ABCDEFG'), []);
});

test('480: geen antwoordnummer in de bestanden van de repository', () => {
  const lijst = git('ls-files');
  if (lijst === null) return; // geen git: alleen de andere controles
  const fout = [];
  for (const pad of lijst.split('\n').filter(Boolean)) {
    if (pad === 'test/antwoordnummer.test.mjs' || !existsSync(pad)) continue;
    let t; try { t = readFileSync(pad, 'utf8'); } catch { continue; }
    for (const n of vindNummers(t)) fout.push(`${pad}: ${n}`);
  }
  assert.deepEqual(fout, [], 'antwoordnummer in bestand');
});

test('480: geen antwoordnummer in de commitberichten van deze branch', () => {
  const basis = git('merge-base', 'HEAD', 'origin/main')?.trim();
  const log = git('log', '--format=%H %B', basis ? `${basis}..HEAD` : '-1');
  if (log === null) return;
  assert.deepEqual(vindNummers(log), [], 'antwoordnummer in een commitbericht');
});

test('480: geen antwoordnummer in titel of tekst van de pull request', () => {
  // In GitHub Actions staat de pull request in GITHUB_EVENT_PATH; lokaal kan WG_PR_TEKST de tekst meegeven.
  let tekst = process.env.WG_PR_TEKST || '';
  const ev = process.env.GITHUB_EVENT_PATH;
  if (ev && existsSync(ev)) { try { const p = JSON.parse(readFileSync(ev, 'utf8')).pull_request || {}; tekst += `\n${p.title || ''}\n${p.body || ''}`; } catch { /* geen pull request */ } }
  assert.deepEqual(vindNummers(tekst), [], 'antwoordnummer in de pull request');
});
