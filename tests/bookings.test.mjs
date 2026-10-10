import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { openDatabase } from '../database.mjs';

test('migração preserva JSON, códigos e cancelamentos após reabrir o banco', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-migration-'));
  const legacy = path.join(directory,'reservas.json'), filename = path.join(directory,'reservas.sqlite');
  const record = {code:'a'.repeat(32),name:'Cliente teste',phone:'85999999999',service:'Corte masculino',price:35,date:'2099-01-06',time:'09:00'};
  const original = JSON.stringify([record]); await writeFile(legacy,original);
  let database;
  try {
    database = await openDatabase(filename,legacy);
    assert.deepEqual({...database.get(record.code)},record);
    assert.equal(await readFile(legacy,'utf8'),original);
    assert.throws(() => database.create({...record,code:'b'.repeat(32)}),/UNIQUE/);
    database.remove(record.code); database.close(); database = null;
    database = await openDatabase(filename,legacy);
    assert.equal(database.get(record.code),undefined);
  } finally { database?.close(); await rm(directory,{recursive:true,force:true}); }
});

test('API cria, bloqueia concorrência, consulta, persiste e cancela reservas', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-api-'));
  const filename = path.join(directory,'reservas.sqlite'); let child;
  async function start() {
    child = spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:filename},stdio:['ignore','pipe','pipe']});
    const base = await new Promise((resolve,reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Servidor não iniciou')),10000);
      child.on('error',error => {clearTimeout(timeout);reject(error);});
      child.stdout.on('data',chunk => {output += chunk;const match = /http:\/\/localhost:(\d+)/.exec(output);if(match){clearTimeout(timeout);resolve(`http://127.0.0.1:${match[1]}`);}});
      child.on('exit',code => {clearTimeout(timeout);reject(new Error(`Servidor encerrou: ${code}`));});
    });
    return base;
  }
  async function stop() { if(child && child.exitCode === null){const exited = once(child,'exit');child.kill();await exited;} }
  try {
    let base = await start();
    const call = (route,options) => fetch(base + route,options);
    const config = await (await call('/api/config')).json(); assert.equal(config.services.length,4);
    let date = new Date(`${config.today}T12:00:00-03:00`); date.setUTCDate(date.getUTCDate()+7);
    while([0,1].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate()+1);
    const key = date.toISOString().slice(0,10);
    const record = {name:'Cliente teste',phone:'85999999999',service:'Corte masculino',date:key,time:'09:00'};
    const options = value => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    const concurrent = await Promise.all([call('/api/bookings',options(record)),call('/api/bookings',options(record))]);
    assert.deepEqual(concurrent.map(response => response.status).sort(),[201,409]);
    const created = await concurrent.find(response => response.status === 201).json();
    assert.equal(created.price,35); assert.match(created.code,/^[a-f0-9]{32}$/);
    assert.equal((await call('/api/bookings/'+created.code)).status,200);
    let availability = await (await call('/api/availability?date='+key)).json(); assert.equal(availability.slots.find(slot=>slot.time==='09:00').available,false);
    await stop(); base = await start();
    assert.equal((await call('/api/bookings/'+created.code)).status,200);
    assert.equal((await call('/api/bookings/'+created.code,{method:'DELETE'})).status,200);
    assert.equal((await call('/api/bookings/'+created.code)).status,404);
    availability = await (await call('/api/availability?date='+key)).json(); assert.equal(availability.slots.find(slot=>slot.time==='09:00').available,true);
    assert.equal((await call('/api/bookings',options({...record,phone:'123'}))).status,400);
    assert.equal((await call('/api/bookings',options({...record,date:'2026-02-31'}))).status,409);
    assert.equal((await call('/api/bookings',options(null))).status,400);
    assert.equal((await call('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
    assert.equal((await call('/api/bookings',{...options(record),headers:{'Content-Type':'application/json','Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await call('/data/reservas.sqlite')).status,404);
    for(const file of ['/','/styles.css?v=3','/app.js?v=3','/api-client.mjs','/admin.js?v=3','/admin.css?v=3','/assets/barber-art.svg']) {
      const response = await call(file); assert.equal(response.status,200);
      if (file.includes('.mjs') || file.includes('.js')) assert.match(response.headers.get('content-type'),/text\/javascript/);
    }
  } finally { await stop(); await rm(directory,{recursive:true,force:true}); }
});
