import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { passwordHash } from '../admin-auth.mjs';

const directory = new URL('../data/',import.meta.url);
await mkdir(directory,{recursive:true});
const file = new URL('admin-auth.json',directory);
try { await access(file); console.log('O acesso já foi configurado. Consulte data/admin-access.txt.'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const password = randomBytes(18).toString('base64url');
  await writeFile(file,JSON.stringify({hash:passwordHash(password)}),{flag:'wx',mode:0o600});
  await writeFile(new URL('admin-access.txt',directory),`PAINEL ADMINISTRATIVO\nEndereço: /admin\nSenha: ${password}\n\nArquivo privado. Não publique nem compartilhe com clientes.\n`,{flag:'wx',mode:0o600});
  console.log('Senha criada em data/admin-access.txt. Reinicie o servidor para ativar.');
}
