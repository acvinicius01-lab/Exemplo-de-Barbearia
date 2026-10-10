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
    CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS blocks (
      date TEXT NOT NULL, time TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(date, time)
    );
    CREATE TRIGGER IF NOT EXISTS no_booking_in_block BEFORE INSERT ON bookings
      WHEN EXISTS (SELECT 1 FROM blocks WHERE date = NEW.date AND time = NEW.time)
      BEGIN SELECT RAISE(ABORT, 'slot blocked'); END;
    CREATE TRIGGER IF NOT EXISTS no_block_on_booking BEFORE INSERT ON blocks
      WHEN EXISTS (SELECT 1 FROM bookings WHERE date = NEW.date AND time = NEW.time)
      BEGIN SELECT RAISE(ABORT, 'slot booked'); END;`);
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
    blocked: date => new Set(db.prepare('SELECT time FROM blocks WHERE date = ?').all(date).map(row => row.time)),
    list: date => db.prepare('SELECT * FROM bookings WHERE date = ? ORDER BY time').all(date),
    blocks: date => db.prepare('SELECT * FROM blocks WHERE date = ? ORDER BY time').all(date),
    block: (date,time,reason) => db.prepare('INSERT INTO blocks (date,time,reason) VALUES (?,?,?)').run(date,time,reason),
    unblock: (date,time) => db.prepare('DELETE FROM blocks WHERE date = ? AND time = ?').run(date,time).changes > 0,
    create: booking => insert.run(booking.code,booking.name,booking.phone,booking.service,booking.price,booking.date,booking.time),
    remove: code => db.prepare('DELETE FROM bookings WHERE code = ?').run(code).changes > 0,
    close: () => db.close(),
  };
}

export const defaultDatabasePath = fileURLToPath(new URL('./data/reservas.sqlite',import.meta.url));
