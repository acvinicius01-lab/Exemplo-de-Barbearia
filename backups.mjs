import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

async function encryptionKey(filename) {
  try { const key = await readFile(filename); if (key.length !== 32) throw Error('Chave de backup inválida.'); return key; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(path.dirname(filename),{recursive:true,mode:0o700});
    const key = randomBytes(32);
    try { await writeFile(filename,key,{flag:'wx',mode:0o600}); return key; }
    catch (conflict) { if(conflict.code === 'EEXIST') return encryptionKey(filename); throw conflict; }
  }
}

export async function backupDatabase(filename,{directory = path.join(path.dirname(filename),'backups'),keyFile = path.join(path.dirname(filename),'backup.key')} = {}) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const key = await encryptionKey(keyFile);
  const suffix = `${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}`;
  const temporary = path.join(directory,`${suffix}.tmp.sqlite`), destination = path.join(directory,`reservas-${suffix}.enc`);
  let db;
  try {
    db = new DatabaseSync(filename,{readOnly:true});
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw Error('Banco não passou na verificação de integridade.');
    // VACUUM INTO inclui os dados confirmados no WAL, mesmo com o servidor ativo.
    db.exec(`VACUUM INTO '${temporary.replaceAll("'","''")}'`); db.close(); db = null;
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv);
    const encrypted = Buffer.concat([cipher.update(await readFile(temporary)),cipher.final()]);
    await writeFile(destination,Buffer.concat([Buffer.from('NCB1'),iv,cipher.getAuthTag(),encrypted]),{flag:'wx',mode:0o600});
    return destination;
  } finally { db?.close(); await unlink(temporary).catch(error => {if(error.code !== 'ENOENT') throw error;}); }
}

export async function restoreBackup(backup,destination,keyFile) {
  const key = await readFile(keyFile), data = await readFile(backup);
  if (key.length !== 32 || data.length < 32 || data.subarray(0,4).toString() !== 'NCB1') throw Error('Chave ou backup inválido.');
  const decipher = createDecipheriv('aes-256-gcm',key,data.subarray(4,16)); decipher.setAuthTag(data.subarray(16,32));
  const plain = Buffer.concat([decipher.update(data.subarray(32)),decipher.final()]);
  await mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  // Nunca sobrescreve o banco atual, nem um destino já existente.
  await writeFile(destination,plain,{flag:'wx',mode:0o600});
  let db;
  try {
    db = new DatabaseSync(destination,{readOnly:true});
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Banco restaurado não passou na verificação.');
  } catch (error) { db?.close(); db = null; await unlink(destination); throw error; }
  finally { db?.close(); }
  return destination;
}
