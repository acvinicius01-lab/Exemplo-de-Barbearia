import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAuth, passwordHash } from '../admin-auth.mjs';

test('autenticação: hash, expiração, logout e limite de tentativas',async () => {
  const previousHash = process.env.ADMIN_PASSWORD_HASH;
  process.env.ADMIN_PASSWORD_HASH = passwordHash('senha-de-teste');
  try {
    const auth = await createAuth();
    for (let index = 0; index < 5; index++) assert.equal(auth.login('errada','test').status,401);
    assert.equal(auth.login('senha-de-teste','test').status,429);
    const login = auth.login('senha-de-teste','other'); assert.equal(login.status,200);
    const request = {headers:{cookie:`nelson_admin=${login.token}`}};
    assert.equal(auth.authenticated(request),true);
    assert.equal(auth.authenticated({headers:{cookie:'nelson_admin='+'a'.repeat(64)}}),false);
    auth.logout(request); assert.equal(auth.authenticated(request),false);
    const next = auth.login('senha-de-teste','other');
    const originalNow = Date.now;
    try { const now = Date.now(); Date.now = () => now + 9*60*60*1000; assert.equal(auth.authenticated({headers:{cookie:`nelson_admin=${next.token}`}}),false); }
    finally { Date.now = originalNow; }
  } finally { if(previousHash === undefined) delete process.env.ADMIN_PASSWORD_HASH; else process.env.ADMIN_PASSWORD_HASH = previousHash; }
});

test('produção não usa a senha local quando nenhuma credencial foi configurada',async () => {
  const previous = {NODE_ENV:process.env.NODE_ENV,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,ADMIN_PASSWORD_HASH:process.env.ADMIN_PASSWORD_HASH};
  try {
    process.env.NODE_ENV = 'production'; delete process.env.ADMIN_PASSWORD; delete process.env.ADMIN_PASSWORD_HASH;
    const auth = await createAuth(); assert.equal(auth.enabled,false); assert.equal(auth.login('qualquer','test').status,503);
  } finally { for (const [name,value] of Object.entries(previous)) { if(value === undefined) delete process.env[name]; else process.env[name] = value; } }
});

test('painel protege clientes, bloqueia horários, libera e cancela com persistência',async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'nelson-admin-'));
  let child, base, cookie = '';
  async function start() {
    child = spawn(process.execPath,['server.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,PORT:'0',HOST:'127.0.0.1',DATABASE_PATH:path.join(directory,'test.sqlite'),NODE_ENV:'production',ADMIN_PASSWORD:'senha-de-teste-admin',ADMIN_PASSWORD_HASH:''},stdio:['ignore','pipe','pipe']});
    base = await new Promise((resolve,reject) => { let output = ''; const timer = setTimeout(()=>reject(Error('Timeout ao iniciar servidor')),10000); child.on('error',reject); child.stdout.on('data',chunk=>{output+=chunk;const match=/http:\/\/localhost:(\d+)/.exec(output);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}}); child.on('exit',code=>{clearTimeout(timer);reject(Error('Servidor encerrou: '+code));}); });
  }
  async function stop() { if(child?.exitCode === null){ const exited = once(child,'exit'); child.kill(); await exited; } }
  const call = (route,options={}) => fetch(base+route,{...options,headers:{...options.headers,...(cookie ? {Cookie:cookie} : {})}});
  const post = data => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  async function login() { const response = await call('/api/admin/login',post({password:'senha-de-teste-admin'})); assert.equal(response.status,200); const header = response.headers.get('set-cookie'); assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);cookie = header.split(';')[0]; }
  try {
    await start();
    assert.equal((await call('/admin')).status,200);
    assert.equal((await call('/api/admin/schedule?date=2099-01-06')).status,401);
    assert.equal((await call('/api/admin/blocks',post({date:'2099-01-06',time:'09:00',reason:''}))).status,401);
    assert.equal((await call('/api/admin/login',post({password:'errada'}))).status,401);
    await login();
    let date = new Date(); date.setUTCDate(date.getUTCDate()+14); while([0,1].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate()+1); const key = date.toISOString().slice(0,10);
    const block = {date:key,time:'09:00',reason:'Almoço'};
    assert.equal((await call('/api/admin/schedule?date=2026-02-31')).status,400);
    assert.equal((await call('/api/admin/blocks',post({...block,reason:'x'.repeat(121)}))).status,400);
    assert.equal((await call('/api/admin/blocks',post(block))).status,201);
    assert.equal((await call('/api/admin/blocks',post(block))).status,409);
    let availability = await (await call('/api/availability?date='+key)).json(); assert.equal(availability.slots.find(slot=>slot.time==='09:00').available,false);
    const booking = {name:'Cliente teste',phone:'85999999999',service:'Corte masculino',date:key,time:'09:00'};
    assert.equal((await call('/api/bookings',post(booking))).status,409);
    await stop(); await start(); cookie=''; await login();
    let schedule = await (await call('/api/admin/schedule?date='+key)).json(); assert.equal(schedule.blocks[0].reason,'Almoço');
    assert.equal((await call(`/api/admin/blocks/${key}/09:00`,{method:'DELETE'})).status,200);
    availability = await (await call('/api/availability?date='+key)).json(); assert.equal(availability.slots.find(slot=>slot.time==='09:00').available,true);
    const created = await (await call('/api/bookings',post(booking))).json(); assert.ok(created.code);
    assert.equal((await call('/api/admin/blocks',post(block))).status,409);
    schedule = await (await call('/api/admin/schedule?date='+key)).json(); assert.equal(schedule.bookings[0].phone,booking.phone);
    const crossSite = {...post({...block,time:'10:00'}),headers:{'Content-Type':'application/json',Origin:'https://example.com'}};
    assert.equal((await call('/api/admin/blocks',crossSite)).status,403);
    assert.equal((await call('/api/admin/bookings/'+created.code,{method:'DELETE'})).status,200);
    assert.equal((await call('/api/bookings/'+created.code)).status,404);
    // Uma disputa entre bloqueio e reserva deve produzir somente um vencedor.
    const race = await Promise.all([call('/api/bookings',post({...booking,time:'10:00'})),call('/api/admin/blocks',post({...block,time:'10:00'}))]);
    assert.deepEqual(race.map(response=>response.status).sort(),[201,409]);
    const secureLogin = await call('/api/admin/login',{...post({password:'senha-de-teste-admin'}),headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'}});assert.match(secureLogin.headers.get('set-cookie'),/Secure/);
    const oldCookie = cookie; assert.equal((await call('/api/admin/logout',{method:'POST'})).status,200);
    cookie = oldCookie; assert.equal((await call('/api/admin/session')).status,401);
    for(const route of ['/data/admin-auth.json','/data/admin-access.txt','/admin-auth.mjs','/.env']) assert.equal((await call(route)).status,404);
  } finally { await stop(); await rm(directory,{recursive:true,force:true}); }
});
