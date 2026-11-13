// Herkomst, IP-hash met dagelijks wisselend zout (VB5), rekenpuzzel (proof-of-work, besluit 401) en tokens.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function geheim(opslag) {
  let g = opslag.staat('geheim');
  if (!g) { g = randomBytes(32).toString('hex'); opslag.zetStaat('geheim', g); }
  return g;
}

export function dagZout(geheimHex, datum = new Date()) {
  return createHmac('sha256', geheimHex).update('zout|' + datum.toISOString().slice(0, 10)).digest('hex');
}

// Nooit het IP zelf bewaren; de hash is na een dag niet meer te koppelen (ander zout).
export function ipHash(ip, geheimHex, datum = new Date()) {
  return createHmac('sha256', dagZout(geheimHex, datum)).update(String(ip || '')).digest('hex').slice(0, 32);
}

export function herkomstToegestaan(origin, toegestaan) {
  if (!origin) return false; // lege Origin weigeren (toets security)
  return toegestaan.includes(origin);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

export function maakPuzzel(geheimHex, iph, bits, nu = Date.now()) {
  const data = { n: randomBytes(12).toString('hex'), v: nu + 2 * 60_000, b: bits, i: iph };
  const deel = b64(JSON.stringify(data));
  const sig = createHmac('sha256', geheimHex).update(deel).digest('base64url');
  return { uitdaging: `${deel}.${sig}`, bits };
}

export function nullenBits(buf) {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    n += Math.clz32(byte) - 24;
    break;
  }
  return n;
}

export function losPuzzelOp(uitdaging, bits) {
  for (let i = 0; i < 1e9; i++) {
    const h = createHash('sha256').update(`${uitdaging}:${i}`).digest();
    if (nullenBits(h) >= bits) return String(i);
  }
  return null;
}

export function controleerPuzzel(geheimHex, uitdaging, oplossing, iph, nu = Date.now()) {
  const [deel, sig] = String(uitdaging || '').split('.');
  if (!deel || !sig) return { ok: false, reden: 'vorm' };
  const verwacht = createHmac('sha256', geheimHex).update(deel).digest();
  const kreeg = Buffer.from(sig, 'base64url');
  if (kreeg.length !== verwacht.length || !timingSafeEqual(kreeg, verwacht)) return { ok: false, reden: 'handtekening' };
  let data;
  try { data = JSON.parse(unb64(deel)); } catch { return { ok: false, reden: 'vorm' }; }
  if (data.v < nu) return { ok: false, reden: 'verlopen' };
  if (data.i !== iph) return { ok: false, reden: 'ander_ip' };
  if (!/^\d{1,10}$/.test(String(oplossing || ''))) return { ok: false, reden: 'oplossing' };
  const h = createHash('sha256').update(`${uitdaging}:${oplossing}`).digest();
  if (nullenBits(h) < data.b) return { ok: false, reden: 'oplossing' };
  return { ok: true, nonce: data.n };
}

export function nieuwToken() {
  return randomBytes(24).toString('base64url');
}

// Antwoord-ID: willekeurig, niet af te leiden uit IP, token of tijd (VB5).
export function antwoordId() {
  const tekens = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(6);
  let s = 'V-';
  for (let i = 0; i < 6; i++) s += tekens[b[i] % tekens.length];
  return s;
}
