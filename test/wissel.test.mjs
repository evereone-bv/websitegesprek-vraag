// V16 van 546.1: het wisselscript (deploy/wissel.sh) met een nagebootste docker, systemctl en curl. Geen echte
// containers, geen kosten. Scenario's uit dossier 7.2 en V15 (a) en (b), plus W5 (fout en herhaling) en V12 (geheugen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = new URL('../deploy/wissel.sh', import.meta.url).pathname;
const NEPMAP = new URL('./fixtures/nep/', import.meta.url).pathname;

function omgeving({ geheugenMb = 4000 } = {}) {
  const nep = mkdtempSync(join(tmpdir(), 'nep-'));
  const v = join(nep, 'var');
  mkdirSync(join(nep, 'img'));
  mkdirSync(v);
  writeFileSync(join(nep, 'meminfo'), `MemTotal: 8000000 kB\nMemAvailable: ${geheugenMb * 1024} kB\n`);
  writeFileSync(join(nep, 'env'), '');
  const env = {
    ...process.env, NEP: nep, DOCKER: join(NEPMAP, 'docker'), SYSTEMCTL: join(NEPMAP, 'systemctl'), CURL: join(NEPMAP, 'curl'),
    VRAAG_VAR: v, VRAAG_ENV: join(nep, 'env'), VRAAG_SLOT: join(nep, 'slot'), VRAAG_MEMINFO: join(nep, 'meminfo'), VRAAG_WACHT: '0', VRAAG_STARTPOGINGEN: '2',
    VRAAG_NU: '1000000',
  };
  const image = (tag, regels) => writeFileSync(join(nep, 'img', `websitegesprek-vraag_${tag}`), Object.entries(regels).map(([k, w]) => `${k}=${w}`).join('\n') + '\n');
  const live = (sleutel) => { image('live', { sleutel, test: 'geslaagd' }); writeFileSync(join(v, 'goedkeuring-live.json'), `{"sleutel":"${sleutel}","geslaagd":true,"kosten_euro":2}`); };
  const draai = (...args) => spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8', timeout: 60_000 });
  const lees = (f) => (existsSync(join(nep, f)) ? readFileSync(join(nep, f), 'utf8') : '');
  const stand = () => JSON.parse(readFileSync(join(v, 'poort', 'stand.json'), 'utf8'));
  const liveSleutel = () => /sleutel=(\w+)/.exec(lees('img/websitegesprek-vraag_live'))?.[1];
  return { nep, v, env, image, live, draai, lees, stand, liveSleutel };
}

test('7.2 scenario 1: gelijke sleutel → direct live, zonder testset', () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('kandidaat', { sleutel: 'aaaa', test: 'gezakt' });
  const r = o.draai('update');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(o.lees('tests'), '', 'geen testset gedraaid');
  assert.match(o.lees('log'), /systemctl restart vraag/);
  assert.equal(o.stand().nieuwe_versie, 'live');
});

test('7.2 scenario 2: andere sleutel en geslaagd → wissel, vorige bewaard, goedkeuringsbestand per sleutel', () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('kandidaat', { sleutel: 'bbbb', test: 'geslaagd' });
  const r = o.draai('update');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(o.lees('tests').trim(), 'vraag-kandidaat');
  assert.equal(o.liveSleutel(), 'bbbb');
  assert.match(o.lees('img/websitegesprek-vraag_vorige'), /sleutel=aaaa/);
  assert.ok(existsSync(join(o.v, 'goedgekeurd', 'bbbb.json')));
  assert.match(readFileSync(join(o.v, 'goedkeuring-live.json'), 'utf8'), /"sleutel":"bbbb"/);
  assert.match(o.lees('log'), /--network vraagnet .*--read-only .*--cap-drop=ALL .*--pids-limit=256 .*--memory=224m .*--oom-score-adj=1000/, 'W3/V12: testcontainer afgeschermd');
  assert.match(o.lees('log'), /VRAAG_TEST_PLAFOND=20\.00/, 'P1: 3 x € 2 = € 6, ondergrens € 20 zonder regel in vraag.env');
  assert.equal(o.stand().nieuwe_versie, 'live');
});

test('P1: ondergrens uit vraag.env (VRAAG_TEST_PLAFOND_MIN); 3 x de vorige kosten als dat hoger is', () => {
  const o = omgeving();
  o.live('aaaa');
  writeFileSync(o.env.VRAAG_ENV, 'ANDERS=1\nVRAAG_TEST_PLAFOND_MIN=30\n');
  o.image('kandidaat', { sleutel: 'abab', test: 'geslaagd' });
  o.draai('update');
  assert.match(o.lees('log'), /VRAAG_TEST_PLAFOND=30\.00/);
  const o2 = omgeving();
  o2.image('live', { sleutel: 'aaaa' });
  writeFileSync(join(o2.v, 'goedkeuring-live.json'), '{"sleutel":"aaaa","geslaagd":true,"kosten_euro":12.5}');
  writeFileSync(o2.env.VRAAG_ENV, 'VRAAG_TEST_PLAFOND_MIN=15\n');
  o2.image('kandidaat', { sleutel: 'acac', test: 'geslaagd' });
  o2.draai('update');
  assert.match(o2.lees('log'), /VRAAG_TEST_PLAFOND=37\.50/);
});

test('7.2 scenario 3 en V15b: andere sleutel en gezakt → live blijft; de volgende nacht niet opnieuw getest', () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('kandidaat', { sleutel: 'cccc', test: 'gezakt' });
  o.draai('update');
  assert.equal(o.liveSleutel(), 'aaaa');
  assert.ok(!/systemctl restart/.test(o.lees('log')), 'live niet herstart');
  assert.deepEqual([o.stand().nieuwe_versie, o.stand().laatste.reden], ['gezakt', 'inhoudelijk']);
  o.draai('update');
  assert.equal(o.lees('tests').trim().split('\n').length, 1, 'V15b: gezakte sleutel niet opnieuw getest');
  o.draai('herhaal', 'cccc');
  o.draai('update');
  assert.equal(o.lees('tests').trim().split('\n').length, 2, 'na de beheeropdracht herhaal wel');
});

test('7.2 scenario 4: nieuwe container start niet → live blijft; start live niet na de wissel → terug naar vorige', () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('kandidaat', { sleutel: 'dddd', test: 'geslaagd', start: 'nee' });
  o.draai('update');
  assert.equal(o.liveSleutel(), 'aaaa');
  assert.ok(!/systemctl restart/.test(o.lees('log')));
  assert.equal(o.stand().laatste.reden, 'start');
  const o2 = omgeving();
  o2.live('aaaa');
  o2.image('kandidaat', { sleutel: 'eeee', test: 'geslaagd', live: 'nee' });
  o2.draai('update');
  assert.equal(o2.liveSleutel(), 'aaaa', 'automatisch terug naar vraag:vorige');
  assert.match(readFileSync(join(o2.v, 'goedkeuring-live.json'), 'utf8'), /"sleutel":"aaaa"/);
  assert.equal(o2.stand().nieuwe_versie, 'gezakt');
});

test('V15a: slot; een tweede aanroep tijdens een lopende run doet niets', async () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('kandidaat', { sleutel: 'ffff', test: 'geslaagd' });
  const houder = spawn('flock', [join(o.nep, 'slot'), 'sleep', '3']);
  await new Promise((r) => setTimeout(r, 300));
  const r = o.draai('update');
  houder.kill();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /draait al/);
  assert.equal(o.lees('tests'), '');
  assert.equal(o.liveSleutel(), 'aaaa');
});

test('W5: technische fout → bezig (geen storing), herhaling na 15 min, 1 uur en 4 uur, daarna gezakt', () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('kandidaat', { sleutel: '1111', test: 'fout' });
  o.draai('update');
  assert.deepEqual([o.stand().nieuwe_versie, o.stand().laatste.uitkomst], ['bezig', 'fout']);
  assert.match(readFileSync(join(o.v, 'poging'), 'utf8'), /^1111 1 1000900 /);
  o.draai('controle');
  assert.equal(o.lees('tests').trim().split('\n').length, 1, 'nog niet aan de beurt');
  let nu = 1000900;
  for (const [n, wacht] of [[2, 3600], [3, 14400]]) {
    spawnSync('bash', [SCRIPT, 'controle'], { env: { ...o.env, VRAAG_NU: String(nu) }, encoding: 'utf8' });
    assert.match(readFileSync(join(o.v, 'poging'), 'utf8'), new RegExp(`^1111 ${n} ${nu + wacht} `));
    nu += wacht;
  }
  spawnSync('bash', [SCRIPT, 'controle'], { env: { ...o.env, VRAAG_NU: String(nu) }, encoding: 'utf8' });
  assert.equal(o.lees('tests').trim().split('\n').length, 4, 'eerste run plus hooguit 3 herhalingen');
  assert.deepEqual([o.stand().nieuwe_versie, o.stand().laatste.reden], ['gezakt', 'technisch']);
  assert.equal(o.liveSleutel(), 'aaaa');
});

test('V12: te weinig vrij geheugen → testcontainer start niet; live blijft', () => {
  const o = omgeving({ geheugenMb: 470 });
  o.live('aaaa');
  o.image('kandidaat', { sleutel: '2222', test: 'geslaagd' });
  o.draai('update');
  assert.equal(o.lees('tests'), '');
  assert.equal(o.liveSleutel(), 'aaaa');
  assert.equal(o.stand().nieuwe_versie, 'bezig', 'technisch: later opnieuw');
});

test('W2: andere instellingen op de server (vraag.env) → controle test de live versie en zet de nieuwe goedkeuring', () => {
  const o = omgeving();
  o.live('aaaa');
  o.image('live', { sleutel: '3333', test: 'geslaagd' }); // zelfde image, andere sleutel door andere instellingen
  o.draai('controle');
  assert.equal(o.lees('tests').trim(), 'vraag-kandidaat');
  assert.match(readFileSync(join(o.v, 'goedkeuring-live.json'), 'utf8'), /"sleutel":"3333"/);
  assert.equal(o.stand().nieuwe_versie, 'live');
});

test('V16: ShellCheck zonder meldingen (als ShellCheck op deze machine staat; in GitHub altijd)', () => {
  const r = spawnSync('shellcheck', [SCRIPT, 'deploy/install.sh'.replace('deploy', new URL('../deploy', import.meta.url).pathname)], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') { assert.ok(!process.env.GITHUB_ACTIONS, 'ShellCheck ontbreekt in GitHub'); return; }
  assert.equal(r.status, 0, r.stdout);
});
