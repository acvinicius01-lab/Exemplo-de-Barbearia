import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApiClient } from '../api-client.mjs';

test('sistema integrado: arquivos da interface → cliente API → servidor → banco → painel',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-system-'));
  const filename = path.join(directory,'db.sqlite'); let child, raw;
  try {
    child = spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:filename,NODE_ENV:'production',ADMIN_PASSWORD:'integracao-senha-teste',ADMIN_PASSWORD_HASH:'',BACKUP_INTERVAL_HOURS:'0'},stdio:['ignore','pipe','pipe']});
    const base = await new Promise((resolve,reject) => {
      let output = ''; const timer = setTimeout(()=>reject(Error('Servidor não iniciou')),10000);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.stdout.on('data',chunk=>{output+=chunk;const match=/http:\/\/localhost:(\d+)/.exec(output);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});
      child.on('exit',code=>{clearTimeout(timer);reject(Error('Servidor encerrou: '+code));});
    });
    for (const page of ['/','/admin']) {
      const response = await fetch(base+page); assert.equal(response.status,200);
      assert.match(response.headers.get('content-type'),/text\/html/);
      const html = await response.text(); assert.match(html,/name="viewport"/);
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]); assert.equal(new Set(ids).size,ids.length);
      const resources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match=>match[1]).filter(url=>!url.startsWith('#') && !url.startsWith('https:'));
      for (const resource of new Set(resources)) {
        const asset = await fetch(new URL(resource,base+page)); assert.equal(asset.status,200,resource);
        if (resource.includes('.css')) { assert.match(asset.headers.get('content-type'),/text\/css/); assert.match(await asset.text(),/\{/); }
        if (resource.includes('.js')) {
          assert.match(asset.headers.get('content-type'),/text\/javascript/);
          const script = await asset.text(); assert.match(script,/createApiClient/);
          for(const match of script.matchAll(/\$\('#([^']+)'\)/g)) assert.ok(ids.includes(match[1]),`Elemento ausente: ${match[1]}`);
        }
      }
      for(const tag of html.matchAll(/<script\b[^>]*>/g)) assert.match(tag[0],/type="module"/);
    }
    let cookie = '';
    const fetchImpl = async (url,options) => {
      const response = await fetch(url,{...options,headers:{...options.headers,...(cookie ? {Cookie:cookie} : {})}});
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      return response;
    };
    const site = createApiClient({base,fetchImpl});
    const admin = createApiClient({base:base+'/api/admin/',fetchImpl});
    const post = data => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    await assert.rejects(admin('session'),error=>error.status===401);
    const config = await site('/api/config');
    let date = new Date(`${config.today}T12:00:00-03:00`);date.setUTCDate(date.getUTCDate()+7);while([0,1].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1);
    const key = date.toISOString().slice(0,10), service = config.services[0];
    const booking = await site('/api/bookings',post({name:'Teste integrado',phone:'85999999999',service:service.name,date:key,time:'09:00'}));
    assert.equal(booking.price,service.price);
    await admin('login',post({password:'integracao-senha-teste'}));
    const schedule = await admin('schedule?date='+key); assert.equal(schedule.bookings[0].code,booking.code);
    raw = new DatabaseSync(filename,{readOnly:true});
    const joined = raw.prepare('SELECT c.phone,s.name AS service,b.code FROM bookings b JOIN clients c ON c.id=b.client_id JOIN services s ON s.id=b.service_id WHERE b.code=?').get(booking.code);
    assert.equal(joined.phone,'85999999999'); assert.equal(joined.service,service.name);
    await admin('blocks',post({date:key,time:'10:00',reason:'Pausa de teste'}));
    const availability = await site('/api/availability?date='+key);
    assert.equal(availability.slots.find(slot=>slot.time==='09:00').available,false);
    assert.equal(availability.slots.find(slot=>slot.time==='10:00').available,false);
    await admin(`blocks/${key}/10:00`,{method:'DELETE'});
    await admin(`bookings/${booking.code}`,{method:'DELETE'});
    const released = await site('/api/availability?date='+key);
    assert.equal(released.slots.find(slot=>slot.time==='09:00').available,true);
    assert.equal(released.slots.find(slot=>slot.time==='10:00').available,true);
    assert.equal(raw.prepare('PRAGMA foreign_key_check').all().length,0);
    await admin('logout',{method:'POST'}); await assert.rejects(admin('session'),error=>error.status===401);
  } finally {
    raw?.close();
    if(child?.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}
    await rm(directory,{recursive:true,force:true});
  }
});
