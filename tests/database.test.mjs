import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../database.mjs';
import { backupDatabase, restoreBackup } from '../backups.mjs';

test('relações obrigatórias, cliente único, histórico preservado e rollback de conflito',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-relations-')), filename = path.join(directory,'db.sqlite');
  let store, raw;
  const booking = {code:'a'.repeat(32),name:'Ana',phone:'85999999999',service:'Corte masculino',price:35,date:'2099-01-06',time:'09:00'};
  try {
    store = await openDatabase(filename); store.create(booking);
    store.create({...booking,code:'b'.repeat(32),name:'Bruno',time:'10:00'});
    raw = new DatabaseSync(filename); raw.exec('PRAGMA foreign_keys = ON');
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM clients').get().count,1);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM services WHERE active = 1').get().count,4);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM bookings b JOIN clients c ON c.id=b.client_id JOIN services s ON s.id=b.service_id').get().count,2);
    assert.equal(store.get(booking.code).name,'Ana');
    assert.throws(()=>raw.exec('DELETE FROM clients'),/FOREIGN KEY/);
    assert.throws(()=>raw.exec('DELETE FROM services WHERE id IN (SELECT service_id FROM bookings)'),/FOREIGN KEY/);
    assert.throws(()=>store.create({...booking,code:'c'.repeat(32),phone:'85988888888'}),/UNIQUE/);
    assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM clients').get().count,1);
    assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally { raw?.close(); store?.close(); await rm(directory,{recursive:true,force:true}); }
});

test('migra banco SQLite antigo sem perder reservas, bloqueios ou códigos',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-old-db-')), filename = path.join(directory,'db.sqlite'); let store;
  try {
    const old = new DatabaseSync(filename);
    old.exec(`CREATE TABLE bookings(code TEXT PRIMARY KEY,name TEXT,phone TEXT,service TEXT,price REAL,date TEXT,time TEXT,UNIQUE(date,time)); CREATE TABLE migrations(name TEXT PRIMARY KEY); INSERT INTO migrations VALUES('legacy-json'); INSERT INTO bookings VALUES('${'a'.repeat(32)}','Ana','85999999999','Corte masculino',30,'2099-01-06','09:00'); CREATE TABLE blocks(date TEXT,time TEXT,reason TEXT,PRIMARY KEY(date,time)); INSERT INTO blocks VALUES('2099-01-06','10:00','Pausa');`); old.close();
    store = await openDatabase(filename); assert.equal(store.get('a'.repeat(32)).price,30); assert.equal(store.blocks('2099-01-06')[0].reason,'Pausa'); store.close(); store = null;
    store = await openDatabase(filename); assert.equal(store.list('2099-01-06').length,1); assert.equal(store.services().find(service=>service.name==='Corte masculino').price,35);
  } finally { store?.close(); await rm(directory,{recursive:true,force:true}); }
});

test('backup inclui WAL, é criptografado, restaura e rejeita adulteração ou sobrescrita',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-backup-')), filename = path.join(directory,'db.sqlite'); let store, restored;
  try {
    store = await openDatabase(filename);
    const booking = {code:'d'.repeat(32),name:'Cliente confidencial',phone:'85999999999',service:'Corte masculino',price:35,date:'2099-01-06',time:'09:00'};
    store.create(booking); store.block('2099-01-06','10:00','Pausa');
    const encrypted = await backupDatabase(filename), key = path.join(directory,'backup.key'), destination = path.join(directory,'restored.sqlite');
    const contents = await readFile(encrypted); assert.equal(contents.subarray(0,4).toString(),'NCB1'); assert.equal(contents.includes(Buffer.from(booking.name)),false);
    await restoreBackup(encrypted,destination,key); restored = await openDatabase(destination);
    assert.deepEqual({...restored.get(booking.code)},booking); assert.equal(restored.blocks('2099-01-06').length,1);
    restored.close(); restored = null;
    await assert.rejects(restoreBackup(encrypted,destination,key),error=>error.code==='EEXIST');
    const altered = Buffer.from(contents); altered[altered.length-1] ^= 1; const corrupt = path.join(directory,'corrupt.enc'); await writeFile(corrupt,altered);
    await assert.rejects(restoreBackup(corrupt,path.join(directory,'invalid.sqlite'),key));
    const wrongKey = path.join(directory,'wrong.key'); await writeFile(wrongKey,Buffer.alloc(32));
    await assert.rejects(restoreBackup(encrypted,path.join(directory,'wrong.sqlite'),wrongKey));
    assert.equal(store.get(booking.code).name,booking.name);
  } finally { restored?.close(); store?.close(); await rm(directory,{recursive:true,force:true}); }
});
