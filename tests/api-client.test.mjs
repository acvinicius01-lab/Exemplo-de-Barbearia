import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../api-client.mjs';

test('cliente envia credenciais e corpo da operação para a API configurada',async () => {
  let received;
  const api = createApiClient({base:'/api/admin/',fetchImpl:async (url,options) => { received = {url,options}; return Response.json({ok:true}); }});
  assert.deepEqual(await api('blocks',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"date":"2099-01-06"}'}),{ok:true});
  assert.equal(received.url,'/api/admin/blocks'); assert.equal(received.options.credentials,'same-origin'); assert.equal(received.options.method,'POST'); assert.equal(received.options.body,'{"date":"2099-01-06"}');
});
test('sessão vencida aciona o retorno ao login e preserva status 401',async () => {
  let expired;
  const api = createApiClient({onUnauthorized:path => {expired=path;},fetchImpl:async()=>Response.json({error:'Entre novamente'},{status:401})});
  await assert.rejects(api('session'),error=>error instanceof ApiError && error.status === 401 && error.message === 'Entre novamente');
  assert.equal(expired,'session');
});
test('conflito de horário permanece distinguível na interface',async () => {
  const api = createApiClient({fetchImpl:async()=>Response.json({error:'Horário indisponível'},{status:409})});
  await assert.rejects(api('/api/bookings'),error=>error.status === 409 && error.message === 'Horário indisponível');
});
test('falhas de rede e páginas HTML retornam mensagens utilizáveis',async () => {
  const offline = createApiClient({fetchImpl:async()=>{throw new TypeError('Failed to fetch');}});
  await assert.rejects(offline('/api/config'),/Não foi possível conectar/);
  const html = createApiClient({fetchImpl:async()=>new Response('<html>Proxy error</html>',{status:502})});
  await assert.rejects(html('/api/config'),error=>error.status === 502 && /resposta inválida/.test(error.message));
});
test('timeout cancela a requisição sem repetir uma gravação',async () => {
  let calls = 0;
  const api = createApiClient({timeout:10,fetchImpl:(_,options)=>{calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));}});
  await assert.rejects(api('/api/bookings',{method:'POST'}),/verificar se a operação foi concluída/);
  assert.equal(calls,1);
});
