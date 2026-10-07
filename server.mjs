import http from 'node:http';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const base=new URL('./',import.meta.url), data=new URL('data/',base);
await mkdir(data,{recursive:true});
const file=new URL('reservas.json',data);let bookings=[];
try{bookings=JSON.parse(await readFile(file,'utf8'));if(!Array.isArray(bookings))throw Error('Banco inválido')}catch(e){if(e.code!=='ENOENT')throw e}
const services={'Corte masculino':35,'Barba alinhada':25,'Corte + barba':55};
const dateNow=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Fortaleza',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function slots(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return [];const d=new Date(date+'T12:00:00-03:00');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==date||[0,1].includes(d.getUTCDay()))return [];return Array.from({length:d.getUTCDay()===6?8:10},(_,i)=>String(i+9).padStart(2,'0')+':00')}
function available(date,time){return slots(date).includes(time)&&new Date(date+'T'+time+':00-03:00')>new Date()&&!bookings.some(b=>b.date===date&&b.time===time)}
async function persist(next){const temp=new URL('reservas.tmp',data);await writeFile(temp,JSON.stringify(next,null,2));await rename(temp,file);bookings=next}
let queue=Promise.resolve();const serial=fn=>{const p=queue.then(fn);queue=p.catch(()=>{});return p};
function json(res,status,payload){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload))}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw Error('Requisição muito grande')}return JSON.parse(text)}
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/api/availability'){const date=url.searchParams.get('date');return json(res,200,{date,today:dateNow(),slots:slots(date).map(time=>({time,available:available(date,time)}))})}
if(req.method==='POST'&&url.pathname==='/api/bookings'){const b=await body(req);return await serial(async()=>{if(typeof b.name!=='string'||b.name.trim().length<2||b.name.length>80||!Object.hasOwn(services,b.service)||!/^\d{10,11}$/.test(b.phone||''))return json(res,400,{error:'Preencha nome, telefone com DDD e serviço.'});if(!available(b.date,b.time))return json(res,409,{error:'Horário indisponível. Escolha outro.'});const record={code:randomBytes(16).toString('hex'),name:b.name.trim(),phone:b.phone,service:b.service,price:services[b.service],date:b.date,time:b.time};await persist([...bookings,record]);json(res,201,record)})}
if(url.pathname.startsWith('/api/bookings/')){const code=url.pathname.split('/').pop();if(req.method==='GET'){const b=bookings.find(x=>x.code===code);return json(res,b?200:404,b||{error:'Reserva não encontrada.'})}if(req.method==='DELETE')return await serial(async()=>{if(!bookings.some(x=>x.code===code))return json(res,404,{error:'Reserva não encontrada.'});await persist(bookings.filter(x=>x.code!==code));json(res,200,{ok:true})})}
if(req.method==='GET'&&['/','/index.html','/app.js'].includes(url.pathname)){const name=url.pathname==='/app.js'?'app.js':'index.html';res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8'});return res.end(await readFile(new URL(name,base)))}json(res,404,{error:'Página não encontrada.'})}catch(e){console.error(e.message);json(res,500,{error:'Não foi possível concluir. Tente novamente.'})}});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('Linha Fina: http://localhost:'+server.address().port));
