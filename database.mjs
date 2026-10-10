import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export async function openDatabase(filename, legacyFile) {
  await mkdir(path.dirname(filename), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS bookings (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
      service TEXT NOT NULL, price REAL, date TEXT NOT NULL, time TEXT NOT NULL,
      UNIQUE(date, time)
    );
    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);`);
  const insert = db.prepare('INSERT INTO bookings (code,name,phone,service,price,date,time) VALUES (?,?,?,?,?,?,?)');
  if (legacyFile && !db.prepare('SELECT 1 FROM migrations WHERE name = ?').get('legacy-json')) {
    let records = [];
    try { records = JSON.parse(await readFile(legacyFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') { db.close(); throw error; } }
    if (!Array.isArray(records)) { db.close(); throw new Error('O arquivo de reservas deve conter uma lista.'); }
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) insert.run(record.code,record.name,record.phone,record.service,record.price ?? null,record.date,record.time);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run('legacy-json');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw new Error('Não foi possível migrar as reservas. O JSON original foi preservado.',{cause:error}); }
  }
  return {
    get: code => db.prepare('SELECT * FROM bookings WHERE code = ?').get(code),
    occupied: date => new Set(db.prepare('SELECT time FROM bookings WHERE date = ?').all(date).map(row => row.time)),
    create: booking => insert.run(booking.code,booking.name,booking.phone,booking.service,booking.price,booking.date,booking.time),
    remove: code => db.prepare('DELETE FROM bookings WHERE code = ?').run(code).changes > 0,
    close: () => db.close(),
  };
}

export const defaultDatabasePath = fileURLToPath(new URL('./data/reservas.sqlite',import.meta.url));
