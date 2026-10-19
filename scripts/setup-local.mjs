import fs from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import net from 'node:net';
import mysql from 'mysql2/promise';
const root=fileURLToPath(new URL('../',import.meta.url));
const stateDir=path.join(root,'.local');await fs.mkdir(stateDir,{recursive:true});
const statePath=path.join(stateDir,'mysql.json');
let state;try{state=JSON.parse(await fs.readFile(statePath,'utf8'));}catch{}
let binary=process.env.MYSQLD_PATH;
if(!binary&&process.platform==='win32'){
  const base='C:\\Program Files\\MySQL';
  const folders=await fs.readdir(base).catch(()=>[]);
  for(const folder of folders.filter(f=>f.startsWith('MySQL Server')).sort().reverse()){const candidate=path.join(base,folder,'bin','mysqld.exe');try{await fs.access(candidate);binary=candidate;break;}catch{}}
}
if(!binary)throw new Error('MySQL server binary not found. Set MYSQLD_PATH to mysqld.');
const datadir=path.join(stateDir,'mysql-data');
if(!state){
  let port=3307;
  while(port<3320){const free=await new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});if(free)break;port++;}
  if(port===3320)throw new Error('No free local MySQL port');
  state={port,password:randomBytes(24).toString('hex'),rootPassword:randomBytes(24).toString('hex'),database:'mudarris_next',user:'mudarris_app',initialized:false};
  await fs.writeFile(statePath,JSON.stringify(state),{mode:0o600});
}
async function connect(password){return mysql.createConnection({host:'127.0.0.1',port:state.port,user:'root',password,connectTimeout:1000});}
let connection;try{connection=await connect(state.rootPassword);}catch{}
if(!connection){
  await fs.mkdir(datadir,{recursive:true});
  const existing=await fs.readdir(datadir);
  if(!existing.length){
    console.log('Initializing a new private MySQL data directory…');
    await new Promise((resolve,reject)=>{const init=spawn(binary,['--no-defaults','--initialize-insecure',`--basedir=${path.dirname(path.dirname(binary))}`,`--datadir=${datadir}`,'--console'],{windowsHide:true,stdio:['ignore','ignore','pipe']});let log='';init.stderr.on('data',chunk=>log+=chunk);init.on('error',reject);init.on('exit',code=>code===0?resolve():reject(new Error(`MySQL initialization failed: ${log}`)));});
  }
  const out=openSync(path.join(stateDir,'mysql.log'),'a');
  const child=spawn(binary,['--no-defaults',`--basedir=${path.dirname(path.dirname(binary))}`,`--datadir=${datadir}`,`--port=${state.port}`,'--bind-address=127.0.0.1','--mysqlx=0','--console'],{detached:true,windowsHide:true,stdio:['ignore',out,out]});
  child.unref();closeSync(out);
  for(let i=0;i<60;i++){try{connection=await connect(state.initialized?state.rootPassword:'');break;}catch{await new Promise(r=>setTimeout(r,500));}}
  if(!connection)throw new Error('MySQL startup failed; inspect .local/mysql.log');
}
try{
  if(!state.initialized){
    await connection.query("ALTER USER 'root'@'localhost' IDENTIFIED BY ?",[state.rootPassword]);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${state.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query("CREATE USER IF NOT EXISTS 'mudarris_app'@'127.0.0.1' IDENTIFIED BY ?",[state.password]);
    await connection.query(`GRANT ALL PRIVILEGES ON \`${state.database}\`.* TO 'mudarris_app'@'127.0.0.1'`);
    state.initialized=true;await fs.writeFile(statePath,JSON.stringify(state),{mode:0o600});
  }
  const envPath=path.join(root,'.env');
  try{await fs.access(envPath);}catch{
    await fs.writeFile(envPath,`MYSQL_HOST=127.0.0.1\nMYSQL_PORT=${state.port}\nMYSQL_USER=${state.user}\nMYSQL_PASSWORD=${state.password}\nMYSQL_DATABASE=${state.database}\nJWT_SECRET=${randomBytes(48).toString('hex')}\nWEB_ORIGIN=http://localhost:3000\nAPI_PORT=4000\nSITE_NAME=منصة الغيطي\nTEACHER_NAME=د. ناجي الغيطي\nTEACHER_SUBJECT=اللغة العربية IGCSE\nTEACHER_TAGLINE=هدفنا إنك تتفوق في العربي\nNOTIFICATIONS_ENABLED=0\n`,{mode:0o600});
  }
  const savedEnv=await fs.readFile(envPath,'utf8');
  if(!/^VIDEO_ENCRYPTION_KEY=[a-f0-9]{64}$/im.test(savedEnv)){
    await fs.appendFile(envPath,`${savedEnv.endsWith('\n')?'':'\n'}VIDEO_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`);
  }
  console.log(`Local MySQL ready at 127.0.0.1:${state.port}; database ${state.database}. Credentials saved privately in .env.`);
}finally{await connection.end();}
