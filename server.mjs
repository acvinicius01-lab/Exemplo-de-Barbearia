import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { openDatabase, defaultDatabasePath } from './database.mjs';
import { services } from './services.mjs';

const base = new URL('./', import.meta.url);
const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const database = await openDatabase(process.env.DATABASE_PATH || defaultDatabasePath, process.env.DATABASE_PATH ? null : new URL('./data/reservas.json',base));
const staticFiles = new Map([
  ['/', ['index.html','text/html']], ['/index.html',['index.html','text/html']],
  ['/styles.css',['styles.css','text/css']], ['/app.js',['app.js','text/javascript']],
  ['/assets/brand.svg',['assets/brand.svg','image/svg+xml']], ['/assets/barber-art.svg',['assets/barber-art.svg','image/svg+xml']],
]);

export function slots(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const day = new Date(`${date}T12:00:00-03:00`);
  if (!Number.isFinite(+day) || day.toISOString().slice(0,10) !== date || [0,1].includes(day.getUTCDay())) return [];
  return Array.from({length:day.getUTCDay() === 6 ? 8 : 10},(_,index) => `${String(index+9).padStart(2,'0')}:00`);
}

function json(response, code, payload) {
  response.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(payload));
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Envie os dados em JSON.'),{status:415});
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw Object.assign(new Error('Requisição muito grande.'),{status:413}); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw Object.assign(new Error('Dados inválidos.'),{status:400}); }
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  response.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const url = new URL(request.url,'http://localhost');
    if (['POST','DELETE'].includes(request.method) && request.headers['sec-fetch-site'] === 'cross-site') return json(response,403,{error:'Requisição não permitida.'});
    if (request.method === 'GET' && url.pathname === '/api/config') return json(response,200,{today:today(),services});
    if (request.method === 'GET' && url.pathname === '/api/availability') {
      const date = url.searchParams.get('date'), occupied = database.occupied(date || '');
      return json(response,200,{date,today:today(),slots:slots(date).map(time => ({time,available:new Date(`${date}T${time}:00-03:00`) > new Date() && !occupied.has(time)}))});
    }
    if (request.method === 'POST' && url.pathname === '/api/bookings') {
      const data = await body(request);
      const service = services.find(item => item.name === data.service);
      if (typeof data.name !== 'string' || data.name.trim().length < 2 || data.name.length > 80 || /[\x00-\x1f\x7f]/.test(data.name) || typeof data.phone !== 'string' || !/^\d{10,11}$/.test(data.phone) || !service) return json(response,400,{error:'Informe nome, telefone com DDD e um serviço válido.'});
      if (!slots(data.date).includes(data.time) || !(new Date(`${data.date}T${data.time}:00-03:00`) > new Date())) return json(response,409,{error:'Horário indisponível. Escolha outro.'});
      const booking = {code:randomBytes(16).toString('hex'),name:data.name.trim(),phone:data.phone,service:service.name,price:service.price,date:data.date,time:data.time};
      try { database.create(booking); } catch (error) { if (error.errcode === 2067 || String(error.message).includes('UNIQUE constraint failed: bookings.date, bookings.time')) return json(response,409,{error:'Este horário acabou de ser reservado. Escolha outro.'}); throw error; }
      return json(response,201,booking);
    }
    const bookingRoute = /^\/api\/bookings\/([a-f0-9]{32})$/.exec(url.pathname);
    if (bookingRoute) {
      if (request.method === 'GET') { const record = database.get(bookingRoute[1]); return json(response,record ? 200 : 404,record || {error:'Reserva não encontrada. Confira o código.'}); }
      if (request.method === 'DELETE') { const removed = database.remove(bookingRoute[1]); return json(response,removed ? 200 : 404,removed ? {ok:true} : {error:'Reserva não encontrada.'}); }
    }
    if (request.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file,type] = staticFiles.get(url.pathname);
      const content = await readFile(new URL(file,base));
      response.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-cache'}); return response.end(content);
    }
    if (url.pathname === '/health' && request.method === 'GET') return json(response,200,{ok:true});
    return json(response,404,{error:'Página ou reserva não encontrada.'});
  } catch (error) { if (!error.status) console.error('Erro no servidor:',error.code || error.name); if (!response.headersSent) json(response,error.status || 500,{error:error.status ? error.message : 'Não foi possível concluir. Tente novamente.'}); else response.end(); }
});
server.requestTimeout = 20000;
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '0.0.0.0',() => console.log(`Nelson Cabeleireiro: http://localhost:${server.address().port}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => { database.close(); process.exit(0); }));
