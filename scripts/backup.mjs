import path from 'node:path';
import { backupDatabase, restoreBackup } from '../backups.mjs';
import { defaultDatabasePath } from '../database.mjs';

const filename = process.env.DATABASE_PATH || defaultDatabasePath;
const keyFile = process.env.BACKUP_KEY_FILE || path.join(path.dirname(filename),'backup.key');
const [operation,backup,destination] = process.argv.slice(2);
if (operation === 'restore') {
  if (!backup || !destination) throw Error('Uso: node scripts/backup.mjs restore arquivo.enc novo-banco.sqlite');
  console.log('Banco recuperado:',await restoreBackup(path.resolve(backup),path.resolve(destination),keyFile));
} else if (operation === undefined || operation === 'create') {
  console.log('Backup criptografado:',await backupDatabase(filename,{directory:process.env.BACKUP_DIRECTORY,keyFile}));
} else throw Error('Operação inválida. Use create ou restore.');
