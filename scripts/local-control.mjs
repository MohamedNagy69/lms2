// Logic behind تشغيل.bat / إيقاف.bat. The .bat files stay ASCII-only because cmd misreads UTF-8 batch files;
// every Arabic message is printed from here instead.
//   node scripts/local-control.mjs start     start MySQL, open the dev server in its own window, wait, open the browser
//   node scripts/local-control.mjs running   exit code 0 when the site is already answering, 1 otherwise
//   node scripts/local-control.mjs open      wait (up to 3 minutes) for the site and its API, then open the browser
//   node scripts/local-control.mjs stop      stop the web + API dev servers and shut the local MySQL down cleanly
import {execFileSync,spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

const root=fileURLToPath(new URL('../',import.meta.url));
dotenv.config({path:path.join(root,'.env'),quiet:true});
const origin=new URL(process.env.WEB_ORIGIN||'http://localhost:3000');
const webPort=Number(process.env.WEB_PORT||origin.port||(origin.protocol==='https:'?443:80));
const apiPort=Number(process.env.API_PORT||4000);
const siteUrl=`${origin.protocol}//127.0.0.1:${webPort}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Connection: close and a consumed body leave no open socket behind, so the process can exit right away
// (exiting with a keep-alive fetch socket still open crashes Node on Windows with a libuv assertion).
async function healthy(){
  try{const response=await fetch(`${siteUrl}/api/health`,{headers:{connection:'close'},signal:AbortSignal.timeout(3000)});await response.arrayBuffer();return response.ok;}catch{return false;}
}
function openBrowser(url){
  if(process.env.LOCAL_CONTROL_NO_BROWSER==='1')return; // used by automated checks
  if(process.platform==='win32')spawn('cmd',['/c','start','',url],{detached:true,stdio:'ignore',windowsHide:true}).unref();
  else spawn(process.platform==='darwin'?'open':'xdg-open',[url],{detached:true,stdio:'ignore'}).unref();
}
// Process ids listening on a TCP port (Windows: netstat; elsewhere: lsof).
function listeners(port){
  try{
    if(process.platform==='win32'){
      const output=execFileSync('netstat',['-ano','-p','tcp'],{encoding:'utf8',windowsHide:true});
      return [...new Set(output.split(/\r?\n/).map(line=>line.trim().split(/\s+/)).filter(cols=>cols[3]==='LISTENING'&&cols[1]?.endsWith(`:${port}`)).map(cols=>Number(cols[4])).filter(pid=>pid>0))];
    }
    return execFileSync('lsof',['-ti',`tcp:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).split(/\s+/).filter(Boolean).map(Number);
  }catch{return [];}
}
function kill(pid){
  try{
    if(process.platform==='win32')execFileSync('taskkill',['/PID',String(pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
    else process.kill(pid,'SIGTERM');
    return true;
  }catch{return false;}
}

const command=process.argv[2];
async function waitAndOpen(){
  process.stdout.write('في انتظار الموقع');
  let ready=false;
  for(let i=0;i<90&&!ready;i++){ready=await healthy();if(!ready){process.stdout.write('.');await sleep(2000);}}
  if(ready){console.log(`\nالموقع جاهز: ${siteUrl}`);openBrowser(siteUrl);return true;}
  console.log('\nالموقع لم يعمل خلال 3 دقائق. راجع نافذة السيرفر لمعرفة السبب.');return false;
}
function run(file,args){return new Promise(resolve=>{const child=spawn(process.execPath,[file,...args],{cwd:root,stdio:'inherit'});child.on('exit',code=>resolve(code===0));child.on('error',()=>resolve(false));});}

// Exit codes are set with process.exitCode (not process.exit) so pending I/O can finish cleanly.
if(command==='start'){
  if(await healthy()){console.log('الموقع شغال بالفعل، بفتحه في المتصفح...');process.exitCode=await waitAndOpen()?0:1;}
  else{
    console.log('[1/3] تشغيل قاعدة البيانات...');
    if(!await run(path.join(root,'scripts','setup-local.mjs'),[])){console.log('فشل تشغيل قاعدة البيانات. راجع الملف .local\\mysql.log');process.exitCode=1;}
    else if(!await run('--import',['tsx','apps/api/src/db/migrate.ts'])){console.log('فشل تحديث جداول قاعدة البيانات.');process.exitCode=1;}
    else{
      console.log('[2/3] تشغيل الموقع في نافذة منفصلة (لإيقافه شغّل إيقاف.bat)...');
      if(process.platform==='win32')spawn('cmd.exe',['/d','/s','/c','start "Mudarris - server" cmd /c npm run dev'],{cwd:root,detached:true,stdio:'ignore',windowsVerbatimArguments:true,windowsHide:true}).unref();
      else{const log=await fs.open(path.join(root,'.local','dev.log'),'a');spawn('npm',['run','dev'],{cwd:root,detached:true,stdio:['ignore',log.fd,log.fd]}).unref();}
      console.log('[3/3] فتح الموقع في المتصفح...');
      process.exitCode=await waitAndOpen()?0:1;
    }
  }
}else if(command==='running'){
  process.exitCode=await healthy()?0:1;
}else if(command==='open'){
  process.exitCode=await waitAndOpen()?0:1;
}else if(command==='stop'){
  let stopped=0;
  for(const port of [webPort,apiPort])for(const pid of listeners(port))if(kill(pid)){stopped++;console.log(`تم إيقاف العملية ${pid} على المنفذ ${port}`);}
  console.log(stopped?'تم إيقاف الموقع والـ API.':'الموقع والـ API كانوا متوقفين بالفعل.');
  // MySQL is asked to shut down (a clean stop that flushes data), not killed.
  try{
    const state=JSON.parse(await fs.readFile(path.join(root,'.local','mysql.json'),'utf8'));
    const connection=await mysql.createConnection({host:'127.0.0.1',port:state.port,user:'root',password:state.rootPassword,connectTimeout:2000});
    await connection.query('SHUTDOWN');await connection.end().catch(()=>{});
    for(let i=0;i<20&&listeners(state.port).length;i++)await sleep(500);
    console.log(listeners(state.port).length?'قاعدة البيانات لسه بتقفل…':'تم إيقاف قاعدة البيانات.');
  }catch(error){
    const code=error&&typeof error==='object'&&'code' in error?error.code:'';
    console.log(code==='ECONNREFUSED'||code==='ENOENT'?'قاعدة البيانات كانت متوقفة بالفعل.':`تعذر إيقاف قاعدة البيانات: ${error instanceof Error?error.message:error}`);
  }
}else{
  console.log('الاستخدام: node scripts/local-control.mjs start | running | open | stop');process.exitCode=2;
}
