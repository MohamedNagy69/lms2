import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const sourcePath=path.resolve(root,'../mudarris-platform/pro/db.sqlite3');
const destination=path.join(root,'.local/source-snapshot.sqlite3');
try{await fs.access(destination);throw new Error('Snapshot already exists; refusing to overwrite');}catch(e){if(e.code!=='ENOENT')throw e;}
const source=new DatabaseSync(sourcePath,{readOnly:true});
try{
  await backup(source,destination);
  const tables=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'academy_%'").all();
  const counts={};for(const {name} of tables)counts[name]=source.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
  await fs.writeFile(path.join(root,'.local/source-counts.json'),JSON.stringify({source:sourcePath,created_at:new Date(),counts},null,2));
  console.log('Read-only SQLite snapshot created. Domain table counts:',counts);
}finally{source.close();}
