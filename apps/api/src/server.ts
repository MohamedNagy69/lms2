import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import {requestContext,errorHandler} from './lib/http.js';
import {config} from './config.js';
import {pool,db} from './db/index.js';
import {optionalAuth} from './lib/auth.js';
import {auth} from './routes/auth.js';
import {publicRoutes} from './routes/public.js';
import {student} from './routes/student.js';
import {teacher} from './routes/teacher.js';
import {media} from './routes/media.js';
import {startNotificationWorker} from './services/notifications.js';
import {startTelegramPoller} from './services/telegram.js';
import {resumeDriveImports} from './lib/drive-import.js';

if(config.secret.length<32 || config.secret==='replace-with-a-long-random-secret') throw new Error('Set JWT_SECRET to a random value of at least 32 characters in .env');
export const app=express();
app.disable('x-powered-by');
if(process.env.TRUST_PROXY==='1') app.set('trust proxy',1);
app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}}));
function allowedOrigin(origin:string){
  if(origin===config.origin)return true;
  if(config.production)return false;
  try{
    const source=new URL(origin),configured=new URL(config.origin);
    return ['localhost','127.0.0.1'].includes(source.hostname)
      && ['localhost','127.0.0.1'].includes(configured.hostname)
      && source.protocol===configured.protocol
      && source.port===configured.port;
  }catch{return false;}
}
app.use(cors({origin(origin,callback){callback(null,!origin||allowedOrigin(origin));},credentials:true}));
app.use(requestContext);
app.use(express.json({limit:'2mb'}),cookieParser());
app.use((req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method)){
    const origin=req.headers.origin;
    if(origin && !allowedOrigin(origin)){res.status(403).json({error:'مصدر الطلب غير مسموح'});return;}
    if(req.headers['sec-fetch-site']==='cross-site'){res.status(403).json({error:'طلب غير مسموح'});return;}
    // Browser mutations must carry an Origin; non-browser clients can use the custom header.
    if(!origin && req.headers['x-requested-with']!=='Mudarris'){res.status(403).json({error:'مصدر الطلب مفقود'});return;}
  }
  next();
});
app.get('/api/health',async(_req,res)=>{
  try{await db.one('SELECT 1 AS ok');res.json({ok:true,database:'mysql'});}catch{res.status(503).json({ok:false,error:'قاعدة البيانات غير متصلة'});}
});
app.use('/api',optionalAuth);
app.use('/api/auth',auth);
app.use('/api',publicRoutes);
app.use('/api',media);
app.use('/api/teacher',teacher);
app.use('/api',student);
app.use((_req,res)=>res.status(404).json({error:'المسار غير موجود'}));
app.use(errorHandler);
// API_EMBEDDED: server.mjs mounts `app` on the same HTTP server as Next (single-process hosts such as Hostinger).
const server=process.env.API_EMBEDDED==='1'?null:app.listen(config.port,'127.0.0.1',()=>console.log(`API listening on http://127.0.0.1:${config.port}`));
// Large video uploads outlast Node's default 5-minute request limit on slow connections (server.mjs does the same).
if(server)server.requestTimeout=60*60_000;
startNotificationWorker();
startTelegramPoller();
void resumeDriveImports().catch(error=>console.error('Drive video conversion could not resume:',error));
async function shutdown(){
  if(!server){await pool.end().catch(()=>{});process.exit(0);}
  server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
