// Single-process production entry for hosts that run one Node file and inject PORT (e.g. Hostinger Node.js apps).
// Runs migrations, then serves the Express API under /api and Next.js for everything else on the same port.
// Local/VPS setups can keep using `npm start` (scripts/run.mjs) or PM2 (deploy/ecosystem.config.cjs).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_ENV='production';
process.env.API_EMBEDDED='1';
process.env.TRUST_PROXY||='1';
// Keep uploads outside the deploy folder so redeploys from GitHub don't wipe videos.
process.env.UPLOAD_ROOT||=path.join(os.homedir(),'mudarris-uploads');
const uploads=path.resolve(root,process.env.UPLOAD_ROOT);
for(const folder of ['videos','questions'])fs.mkdirSync(path.join(uploads,folder),{recursive:true});

const api=file=>import(pathToFileURL(path.join(root,'apps/api/dist',file)).href);

const {runMigrations}=await api('db/migrate.js');
await runMigrations();

// No SSH needed for the first login: set INITIAL_TEACHER_USERNAME / INITIAL_TEACHER_PASSWORD once.
const {INITIAL_TEACHER_USERNAME:teacherUser,INITIAL_TEACHER_PASSWORD:teacherPassword}=process.env;
if(teacherUser&&teacherPassword){
  const {db}=await api('db/index.js');
  const {hashPassword}=await api('lib/password.js');
  if(await db.one("SELECT id FROM users WHERE role='teacher' LIMIT 1"))console.log('Teacher account exists; INITIAL_TEACHER_* ignored.');
  else if(teacherPassword.length<12)console.error('INITIAL_TEACHER_PASSWORD must be at least 12 characters; teacher not created.');
  else{
    await db.run("INSERT INTO users(username,password,first_name,role,is_staff,bio) VALUES (?,?,?,'teacher',1,'')",
      [teacherUser,await hashPassword(teacherPassword),process.env.TEACHER_NAME||teacherUser]);
    console.log('Initial teacher account created.');
  }
}

const {app:apiApp}=await api('server.js');
const {default:next}=await import('next');
const web=next({dev:false,dir:path.join(root,'apps/web')});
await web.prepare();
const handle=web.getRequestHandler();

const server=http.createServer((req,res)=>{
  const url=req.url||'/';
  if(url==='/api'||url.startsWith('/api/')||url.startsWith('/api?'))apiApp(req,res);
  else handle(req,res);
});
const port=process.env.PORT||process.env.WEB_PORT||3000;
server.listen(port,()=>console.log(`Mudarris listening on ${port}`));
