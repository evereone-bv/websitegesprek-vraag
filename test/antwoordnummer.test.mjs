// Besluit 480 (voorwaarde Raymond 15 nov 21:49, review S11 en V18.6, Juridisch RV4/H3): de repository is openbaar. Een commit
// of pull request mag nooit een echt antwoordnummer (V-XXXXXX) bevatten. Alleen de plaatshouder V-XXXXXX zelf is toegestaan.
// V18.6: de test faalt hard als hij zijn bron niet kan lezen (geen git, geen origin/main), in plaats van stil over te slaan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Zelfde tekenset als antwoordId() in src/beveiliging.mjs.
const NUMMER = /\bV-[A-HJ-NP-Z2-9]{6}\b/g;
export function vindNummers(tekst) {
  return [...String(tekst || '').matchAll(NUMMER)].map((m) => m[0]).filter((n) => n !== 'V-XXXXXX');
}
function git(...a) {
  try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
}
// Tekst van de pull request: uit GITHUB_EVENT_PATH (GitHub Actions) en/of WG_PR_TEKST.
export function prTekst(env = process.env) {
  let tekst = env.WG_PR_TEKST || '';
  const ev = env.GITHUB_EVENT_PATH;
  if (ev && existsSync(ev)) {
    const p = JSON.parse(readFileSync(ev, 'utf8')).pull_request; // onleesbaar = harde fout (18.6)
    if (p) tekst += `\n${p.title || ''}\n${p.body || ''}`;
  }
  return tekst;
}

test('480: vindNummers herkent echte antwoordnummers en laat de plaatshouder staan', () => {
  const echt = 'V-' + 'LNE8D5';
  assert.deepEqual(vindNummers(`antwoord ${echt} en V-XXXXXX`), [echt]);
  assert.deepEqual(vindNummers('A-1, V-12, V-ABCDEFG, V-ABCDE1'), []);
});

test('480: geen antwoordnummer in de bestanden van de repository', () => {
  const lijst = git('ls-files');
  assert.ok(lijst !== null, 'git is niet beschikbaar: deze controle kan niet draaien (V18.6)');
  const fout = [];
  for (const pad of lijst.split('\n').filter(Boolean)) {
    if (!existsSync(pad)) continue;
    let t; try { t = readFileSync(pad, 'utf8'); } catch { continue; }
    for (const n of vindNummers(t)) fout.push(`${pad}: ${n}`);
  }
  assert.deepEqual(fout, [], 'antwoordnummer in bestand');
});

test('480: geen antwoordnummer in de commitberichten van deze branch (faalt zonder origin/main)', () => {
  const basis = git('merge-base', 'HEAD', 'origin/main')?.trim();
  assert.ok(basis, 'origin/main ontbreekt: haal main op (git fetch origin main) zodat alle commits van de branch gecontroleerd worden (V18.6)');
  const log = git('log', '--format=%H %B', `${basis}..HEAD`);
  assert.ok(log !== null, 'commitberichten niet leesbaar (V18.6)');
  assert.deepEqual(vindNummers(log), [], 'antwoordnummer in een commitbericht');
});

test('480: geen antwoordnummer in titel of tekst van de pull request', () => {
  assert.deepEqual(vindNummers(prTekst()), [], 'antwoordnummer in de pull request');
});

test('480 V18.6: een nummer in de tekst van de pull request wordt echt gevonden (GitHub-gebeurtenis)', () => {
  const map = mkdtempSync(join(tmpdir(), 'wg-pr-'));
  const ev = join(map, 'event.json');
  writeFileSync(ev, JSON.stringify({ pull_request: { title: 'Testvraag', body: 'n.a.v. ' + 'V-' + 'QRSTUV' } }));
  assert.deepEqual(vindNummers(prTekst({ GITHUB_EVENT_PATH: ev })), ['V-' + 'QRSTUV']);
  writeFileSync(ev, '{kapot');
  assert.throws(() => prTekst({ GITHUB_EVENT_PATH: ev }), 'onleesbare gebeurtenis faalt hard');
});
