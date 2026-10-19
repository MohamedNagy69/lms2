import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const envFile=path.join(root,'.env');
const env={};
for(const line of (await fs.readFile(envFile,'utf8')).split(/\r?\n/)){const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(match)env[match[1]]=match[2].replace(/^"|"$/g,'');}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backupDir=path.join(root,process.env.BACKUP_DIR||'.local/backups');
await fs.mkdir(backupDir,{recursive:true});
const output=path.join(backupDir,`${env.MYSQL_DATABASE||'mudarris'}-${stamp}.sql`);
let dump=process.env.MYSQLDUMP_PATH||'mysqldump';
if(!process.env.MYSQLDUMP_PATH&&process.platform==='win32'){
  const base='C:\\Program Files\\MySQL';
  for(const folder of (await fs.readdir(base).catch(()=>[])).filter(name=>name.startsWith('MySQL Server')).sort().reverse()){
    const candidate=path.join(base,folder,'bin','mysqldump.exe');
    try{await fs.access(candidate);dump=candidate;break;}catch{}
  }
}
const args=['--single-transaction','--routines','--events','--hex-blob','--host',env.MYSQL_HOST||'127.0.0.1','--port',env.MYSQL_PORT||'3306','--user',env.MYSQL_USER||'root','--result-file',output,env.MYSQL_DATABASE||'mudarris'];
try{await new Promise((resolve,reject)=>{const child=spawn(dump,args,{env:{...process.env,MYSQL_PWD:env.MYSQL_PASSWORD||''},windowsHide:true,stdio:['ignore','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('error',errorEvent=>reject(new Error(`لم يتم العثور على mysqldump. اضبط MYSQLDUMP_PATH. ${errorEvent.message}`)));child.on('exit',code=>code===0?resolve():reject(new Error(error||`mysqldump exited with ${code}`)));});}catch(error){await fs.rm(output,{force:true});throw error;}
console.log(`تم إنشاء النسخة الاحتياطية: ${output}`);
