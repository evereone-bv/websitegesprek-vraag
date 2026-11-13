import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maakServer, sleutelGezet } from '../src/server.mjs';

async function haal(server, pad) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pad}`);
    return { status: res.status, body: await res.json(), kop: res.headers };
  } finally {
    server.close();
  }
}

test('healthz zonder sleutel', async () => {
  const r = await haal(maakServer({}), '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.sleutel_gezet, false);
  assert.equal(r.body.vraagbaak_actief, false);
  assert.equal(r.kop.get('cache-control'), 'no-store');
});

test('healthz met sleutel toont de sleutel nooit', async () => {
  const geheim = 'sk-ant-api03-' + 'x'.repeat(40);
  const r = await haal(maakServer({ ANTHROPIC_API_KEY: geheim }), '/healthz');
  assert.equal(r.body.sleutel_gezet, true);
  assert.ok(!JSON.stringify(r.body).includes('sk-ant'));
});

test('onbekend pad geeft 404', async () => {
  const r = await haal(maakServer({}), '/v1/vraag');
  assert.equal(r.status, 404);
});

test('sleutelvorm', () => {
  assert.equal(sleutelGezet({ ANTHROPIC_API_KEY: 'onzin' }), false);
  assert.equal(sleutelGezet({}), false);
});
