import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { services } from './services.mjs';
import { backupDatabase } from './backups.mjs';

export async function openDatabase(filename, legacyFile) {
  await mkdir(path.dirname(filename), {recursive:true,mode:0o700});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
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
  // A cópia anterior é criptografada antes da migração estrutural.
  if (!db.prepare('SELECT 1 FROM migrations WHERE name = ?').get('client-service-relations')) {
    await backupDatabase(filename);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE clients (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE CHECK(length(phone) IN (10,11) AND phone NOT GLOB '*[^0-9]*'),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE services (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
        price REAL CHECK(price IS NULL OR price >= 0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
      );
      INSERT INTO clients (name,phone) SELECT MIN(name),phone FROM bookings GROUP BY phone;
      INSERT INTO services (name,price,active) SELECT service,MAX(price),0 FROM bookings GROUP BY service;
      CREATE TABLE bookings_next (
        code TEXT PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
        name TEXT NOT NULL, phone TEXT NOT NULL, service TEXT NOT NULL,
        price REAL CHECK(price IS NULL OR price >= 0), date TEXT NOT NULL, time TEXT NOT NULL,
        UNIQUE(date,time)
      );
      INSERT INTO bookings_next (code,client_id,service_id,name,phone,service,price,date,time)
        SELECT b.code,c.id,s.id,b.name,b.phone,b.service,b.price,b.date,b.time FROM bookings b
        JOIN clients c ON c.phone = b.phone JOIN services s ON s.name = b.service;
      DROP TRIGGER no_booking_in_block; DROP TRIGGER no_block_on_booking;
      DROP TABLE bookings; ALTER TABLE bookings_next RENAME TO bookings;
      CREATE INDEX bookings_client ON bookings(client_id);
      CREATE INDEX bookings_service ON bookings(service_id);
      INSERT INTO migrations (name) VALUES ('client-service-relations');`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); db.close(); throw new Error('Migração de relacionamentos falhou; restaure a cópia anterior se necessário.',{cause:error}); }
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS no_booking_in_block BEFORE INSERT ON bookings
    WHEN EXISTS (SELECT 1 FROM blocks WHERE date = NEW.date AND time = NEW.time)
    BEGIN SELECT RAISE(ABORT, 'slot blocked'); END;
    CREATE TRIGGER IF NOT EXISTS no_block_on_booking BEFORE INSERT ON blocks
    WHEN EXISTS (SELECT 1 FROM bookings WHERE date = NEW.date AND time = NEW.time)
    BEGIN SELECT RAISE(ABORT, 'slot booked'); END;`);
  const upsertService = db.prepare('INSERT INTO services (name,description,price,active) VALUES (?,?,?,1) ON CONFLICT(name) DO UPDATE SET description=excluded.description,price=excluded.price,active=1');
  db.exec('BEGIN IMMEDIATE');
  try { db.exec('UPDATE services SET active = 0'); for(const service of services) upsertService.run(service.name,service.description,service.price); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); db.close(); throw error; }
  const fields = 'code,name,phone,service,price,date,time';
  return {
    get: code => db.prepare(`SELECT ${fields} FROM bookings WHERE code = ?`).get(code),
    services: () => db.prepare('SELECT name,price,description FROM services WHERE active = 1 ORDER BY id').all(),
    occupied: date => new Set(db.prepare('SELECT time FROM bookings WHERE date = ?').all(date).map(row => row.time)),
    blocked: date => new Set(db.prepare('SELECT time FROM blocks WHERE date = ?').all(date).map(row => row.time)),
    list: date => db.prepare(`SELECT ${fields} FROM bookings WHERE date = ? ORDER BY time`).all(date),
    blocks: date => db.prepare('SELECT * FROM blocks WHERE date = ? ORDER BY time').all(date),
    block: (date,time,reason) => db.prepare('INSERT INTO blocks (date,time,reason) VALUES (?,?,?)').run(date,time,reason),
    unblock: (date,time) => db.prepare('DELETE FROM blocks WHERE date = ? AND time = ?').run(date,time).changes > 0,
    create: booking => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const service = db.prepare('SELECT id FROM services WHERE name = ? AND active = 1').get(booking.service);
        if (!service) throw Error('Serviço não encontrado.');
        db.prepare('INSERT INTO clients (name,phone) VALUES (?,?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name').run(booking.name,booking.phone);
        const client = db.prepare('SELECT id FROM clients WHERE phone = ?').get(booking.phone);
        const result = db.prepare('INSERT INTO bookings (code,client_id,service_id,name,phone,service,price,date,time) VALUES (?,?,?,?,?,?,?,?,?)').run(booking.code,client.id,service.id,booking.name,booking.phone,booking.service,booking.price,booking.date,booking.time);
        db.exec('COMMIT'); return result;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    remove: code => db.prepare('DELETE FROM bookings WHERE code = ?').run(code).changes > 0,
    close: () => db.close(),
  };
}

export const defaultDatabasePath = fileURLToPath(new URL('./data/reservas.sqlite',import.meta.url));
