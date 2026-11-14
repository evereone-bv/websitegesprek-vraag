// Opslag in SQLite (node:sqlite, geen extra pakketten). Tellers zijn atomair (UPSERT), zoals de toets vroeg.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openOpslag(map) {
  let pad = ':memory:';
  if (map && map !== ':memory:') {
    mkdirSync(map, { recursive: true });
    pad = join(map, 'vraag.db');
  }
  const db = new DatabaseSync(pad);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS teller (sleutel TEXT PRIMARY KEY, n REAL NOT NULL, verloopt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS gesprek (token TEXT PRIMARY KEY, iphash TEXT NOT NULL, verloopt INTEGER NOT NULL,
      vragen INTEGER NOT NULL DEFAULT 0, beurten TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS register (id TEXT PRIMARY KEY, tijd INTEGER NOT NULL, pagina TEXT, vraag TEXT, antwoord TEXT,
      bron TEXT, onderwerp TEXT, zeker INTEGER, doorverwezen INTEGER, vervangen INTEGER, reden TEXT, duim INTEGER,
      kb_versie TEXT, model TEXT, kosten_milli_cent INTEGER, taal TEXT, duur_ms INTEGER);
    CREATE TABLE IF NOT EXISTS kennisbank (versie TEXT PRIMARY KEY, inhoud TEXT NOT NULL, gemaakt INTEGER NOT NULL, actief INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS staat (sleutel TEXT PRIMARY KEY, waarde TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS logboek (tijd INTEGER NOT NULL, soort TEXT NOT NULL, tekst TEXT NOT NULL);
  `);

  const q = {
    tel: db.prepare(`INSERT INTO teller (sleutel, n, verloopt) VALUES (?, ?, ?)
      ON CONFLICT(sleutel) DO UPDATE SET n = CASE WHEN teller.verloopt < ? THEN excluded.n ELSE teller.n + excluded.n END,
      verloopt = CASE WHEN teller.verloopt < ? THEN excluded.verloopt ELSE teller.verloopt END RETURNING n`),
    lees: db.prepare('SELECT n, verloopt FROM teller WHERE sleutel = ?'),
    staatLees: db.prepare('SELECT waarde FROM staat WHERE sleutel = ?'),
    staatZet: db.prepare('INSERT INTO staat (sleutel, waarde) VALUES (?, ?) ON CONFLICT(sleutel) DO UPDATE SET waarde = excluded.waarde'),
    log: db.prepare('INSERT INTO logboek (tijd, soort, tekst) VALUES (?, ?, ?)'),
  };

  const nu = () => Date.now();
  return {
    db,
    // Telt op en geeft de nieuwe stand terug; verlopen vensters beginnen opnieuw.
    tel(sleutel, hoeveel, vensterMs) {
      const t = nu();
      return q.tel.get(sleutel, hoeveel, t + vensterMs, t, t).n;
    },
    stand(sleutel) {
      const r = q.lees.get(sleutel);
      return r && r.verloopt >= nu() ? r.n : 0;
    },
    staat(sleutel, standaard = null) {
      const r = q.staatLees.get(sleutel);
      if (!r) return standaard;
      try { return JSON.parse(r.waarde); } catch { return standaard; }
    },
    zetStaat(sleutel, waarde) { q.staatZet.run(sleutel, JSON.stringify(waarde)); },
    log(soort, tekst) { q.log.run(nu(), soort, String(tekst).slice(0, 500)); },
    opruimen(registerDagen = 30) {
      const t = nu();
      db.prepare('DELETE FROM teller WHERE verloopt < ?').run(t);
      db.prepare('DELETE FROM gesprek WHERE verloopt < ?').run(t);
      db.prepare('DELETE FROM register WHERE tijd < ?').run(t - registerDagen * 86_400_000);
      db.prepare('DELETE FROM logboek WHERE tijd < ?').run(t - 30 * 86_400_000);
      db.prepare('DELETE FROM kennisbank WHERE actief = 0 AND versie NOT IN (SELECT versie FROM kennisbank ORDER BY gemaakt DESC LIMIT 5)').run();
    },
  };
}
