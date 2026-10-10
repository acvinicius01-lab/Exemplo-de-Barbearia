import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;
}

export async function createAuth() {
  let hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash && process.env.ADMIN_PASSWORD) hash = passwordHash(process.env.ADMIN_PASSWORD);
  if (!hash && process.env.NODE_ENV !== 'production') {
    try { hash = JSON.parse(await readFile(new URL('./data/admin-auth.json',import.meta.url),'utf8')).hash; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (hash && !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)) throw new Error('ADMIN_PASSWORD_HASH inválido.');
  const sessions = new Map(), attempts = new Map();
  const duration = 8 * 60 * 60 * 1000;
  const key = token => createHash('sha256').update(token).digest('hex');
  const cookie = request => /(?:^|;\s*)nelson_admin=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
  function cleanup() {
    const now = Date.now();
    for (const [id,expiry] of sessions) if (expiry <= now) sessions.delete(id);
    for (const [id,entry] of attempts) if (entry.until <= now) attempts.delete(id);
  }
  return {
    enabled: !!hash,
    authenticated(request) { cleanup(); const token = cookie(request); return !!token && (sessions.get(key(token)) || 0) > Date.now(); },
    login(password,address) {
      cleanup();
      const now = Date.now(), entry = attempts.get(address) || {count:0,until:now+10*60*1000};
      if (entry.count >= 5) return {status:429,error:'Muitas tentativas. Aguarde 10 minutos.'};
      entry.count++; attempts.set(address,entry);
      if (!hash) return {status:503,error:'Acesso administrativo ainda não configurado.'};
      if (typeof password !== 'string' || password.length > 256) return {status:401,error:'Senha incorreta.'};
      const [salt,expected] = hash.split(':');
      if (!timingSafeEqual(scryptSync(password,salt,64),Buffer.from(expected,'hex'))) return {status:401,error:'Senha incorreta.'};
      attempts.delete(address);
      const token = randomBytes(32).toString('hex');
      if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
      sessions.set(key(token),now+duration); return {status:200,token};
    },
    logout(request) { const token = cookie(request); if (token) sessions.delete(key(token)); },
    setCookie(request,response,token = '') {
      const secure = request.socket.encrypted || request.headers['x-forwarded-proto'] === 'https';
      response.setHeader('Set-Cookie',`nelson_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${token ? duration/1000 : 0}${secure ? '; Secure' : ''}`);
    },
  };
}
