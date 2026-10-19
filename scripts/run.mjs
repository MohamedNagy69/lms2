import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
dotenv.config({path:path.join(root,'.env')});
const origin=new URL(process.env.WEB_ORIGIN||'http://localhost:3000');
const webPort=process.env.WEB_PORT||origin.port||(origin.protocol==='https:'?'443':'80');
const development=process.argv[2]==='dev';
const children=[
  spawn(process.execPath,development?['--import','tsx','--watch','src/server.ts']:['dist/server.js'],{cwd:path.join(root,'apps/api'),stdio:'inherit',windowsHide:true}),
  spawn(process.execPath,[require.resolve('next/dist/bin/next'),development?'dev':'start','--hostname',process.env.WEB_HOST||'127.0.0.1','--port',webPort],{cwd:path.join(root,'apps/web'),stdio:'inherit',windowsHide:true}),
];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children){if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill('SIGTERM');}setTimeout(()=>process.exit(code),700);}
for(const child of children){child.on('error',error=>{console.error(error.message);stop(1);});child.on('exit',code=>stop(code||0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
