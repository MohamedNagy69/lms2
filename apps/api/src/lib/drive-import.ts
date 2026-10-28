import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { ensure, HttpError } from './errors.js';
import { encryptVideoCopy } from './video-crypto.js';
import { validateSignaturePath, videoExtensions } from './file-signature.js';

// A Google Drive video played in Drive's own player streams straight from Google to the browser, where download
// managers (IDM and browser extensions) pick it up. So every Drive lesson is converted once into a protected upload:
// downloaded by the server, encrypted at rest and then streamed like any uploaded lesson (encrypted chunks + service
// worker). Students never get the Drive link; until the copy is ready the lesson shows "being prepared".
const maxVideoBytes=1024*1024*1024;
const videoTypes:Record<string,string>={'video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov','video/x-matroska':'.mkv','video/x-m4v':'.m4v','video/x-msvideo':'.avi'};

// Node's default user agent is refused more often by Google; network errors and 5xx answers are retried.
const browserAgent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
async function driveFetch(url:string){
  let last='';
  for(let attempt=1;attempt<=3;attempt++){
    const response=await fetch(url,{redirect:'follow',headers:{'User-Agent':browserAgent,Accept:'*/*'},signal:AbortSignal.timeout(30*60_000)}).catch((error:Error)=>{last=error.message;return null;});
    if(response?.ok&&response.body)return response;
    if(response){last=`HTTP ${response.status}`;await response.body?.cancel();if(response.status<500&&response.status!==429)break;}
    await new Promise(resolve=>setTimeout(resolve,attempt*5000));
  }
  throw new HttpError(502,`تعذر الوصول للملف على جوجل درايف (${last||'بدون رد'}). تأكد من الرابط وأن المشاركة «أي شخص لديه الرابط».`);
}
function confirmationUrl(page:string){
  const form=page.match(/<form[^>]+id="download-form"[^>]+action="([^"]+)"[\s\S]*?<\/form>/i);
  if(!form)return '';
  const url=new URL(form[1]!.replace(/&amp;/g,'&'));
  for(const input of form[0].matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/gi))url.searchParams.set(input[1]!,input[2]!.replace(/&amp;/g,'&'));
  return url.hostname.endsWith('google.com')?url.toString():'';
}

export async function downloadDriveVideo(raw:string):Promise<{path:string;name:string}>{
  const fileId=raw.match(/(?:\/d\/|[?&]id=)([\w-]{10,})/)?.[1]||(/^[\w-]{10,}$/.test(raw)?raw:'');
  ensure(fileId,400,'رابط جوجل درايف غير صالح');
  let resourceKey='';try{resourceKey=new URL(raw).searchParams.get('resourcekey')||'';}catch{}
  const source=`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t${resourceKey?`&resourcekey=${encodeURIComponent(resourceKey)}`:''}`;
  let response=await driveFetch(source);
  let type=(response.headers.get('content-type')||'').split(';')[0]!.trim().toLowerCase();
  // Google sometimes answers with its "can't scan this file for viruses" page instead of the file (more often for
  // requests from hosting servers); that page holds a form whose fields lead to the real download.
  if(type==='text/html'){
    const page=await response.text();
    const confirmed=confirmationUrl(page);
    if(confirmed){response=await driveFetch(confirmed);type=(response.headers.get('content-type')||'').split(';')[0]!.trim().toLowerCase();}
    if(type==='text/html'){
      if(!response.bodyUsed)await response.body!.cancel();
      const title=(page.match(/<title>([^<]{1,120})/i)?.[1]||'').trim();
      throw new HttpError(400,`جوجل درايف رفض التحميل${title?` («${title}»)`:''}: اجعل الملف متاحًا لأي شخص لديه الرابط واسمح بالتنزيل، ثم احفظ الدرس مرة أخرى. لو المشكلة استمرت ارفع الفيديو كملف.`);
    }
  }
  const disposition=response.headers.get('content-disposition')||'';
  // Header values arrive as Latin-1, so a plain filename="…" holding UTF-8 (Arabic names) is decoded back here.
  const encodedName=disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1],plainName=disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const name=encodedName?decodeURIComponent(encodedName):plainName?Buffer.from(plainName,'latin1').toString('utf8'):`drive-${fileId}`;
  const ext=(videoExtensions.includes(path.extname(name).toLowerCase())?path.extname(name).toLowerCase():videoTypes[type])||'';
  if(!ext){await response.body?.cancel();throw new HttpError(400,'الملف على درايف ليس فيديو بصيغة مدعومة (MP4 أو WebM أو MKV أو MOV أو M4V أو AVI).');}
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>maxVideoBytes){await response.body?.cancel();throw new HttpError(413,'حجم الفيديو يجب أن يكون أقل من 1 جيجابايت');}
  const folder=path.join(config.uploads,'videos');await fs.mkdir(folder,{recursive:true});
  const temporary=path.join(folder,`.drive-${randomBytes(8).toString('hex')}.download`);
  let received=0;
  const limit=new Transform({transform(chunk:Buffer,_encoding,callback){received+=chunk.length;callback(received>maxVideoBytes?new HttpError(413,'حجم الفيديو يجب أن يكون أقل من 1 جيجابايت'):null,chunk);}});
  try{
    await pipeline(Readable.fromWeb(response.body as any),limit,createWriteStream(temporary,{flags:'wx',mode:0o600}));
    ensure(received>0,502,'الملف الذي وصل من جوجل درايف فارغ');
    await validateSignaturePath(temporary,`video${ext}`,'videos');
    const filename=randomBytes(20).toString('hex')+ext;
    await encryptVideoCopy(temporary,path.join(folder,filename));
    return {path:`videos/${filename}`,name};
  }finally{await fs.unlink(temporary).catch(()=>{});}
}

// One conversion at a time, in this process. Rows marked 'pending' or 'running' are picked up again after a restart.
const queue:number[]=[];
let working=false;
export async function queueDriveImport(lessonId:number){
  await db.run(`UPDATE lessons SET video_import_status='pending',video_import_error='' WHERE id=? AND video_source='drive'`,[lessonId]);
  if(!queue.includes(lessonId))queue.push(lessonId);
  void work();
}
export async function resumeDriveImports(){
  const rows=await db.rows(`SELECT id FROM lessons WHERE video_source='drive' AND drive_url<>'' AND video_import_status<>'failed' ORDER BY id`);
  for(const row of rows)await queueDriveImport(row.id);
}
async function work(){
  if(working)return;
  working=true;
  try{
    for(let lessonId=queue.shift();lessonId!==undefined;lessonId=queue.shift()){
      const lesson=await db.one(`SELECT id,drive_url FROM lessons WHERE id=? AND video_source='drive'`,[lessonId]);
      if(!lesson?.drive_url)continue;
      await db.run(`UPDATE lessons SET video_import_status='running' WHERE id=?`,[lessonId]);
      try{
        const stored=await downloadDriveVideo(lesson.drive_url);
        // Only switch the lesson if the teacher has not changed its video in the meantime.
        const switched=await db.run(`UPDATE lessons SET video_source='file',video_file=?,video_import_status='',video_import_error='' WHERE id=? AND video_source='drive' AND drive_url=?`,[stored.path,lessonId,lesson.drive_url]);
        if(!switched.affectedRows)await fs.unlink(path.resolve(config.uploads,stored.path)).catch(()=>{});
      }catch(error){
        const message=error instanceof HttpError?error.message:'تعذر تحويل فيديو درايف. تأكد أن الملف مشارك «أي شخص لديه الرابط» ثم احفظ الدرس مرة أخرى.';
        // Shows up in the host's runtime log (Hostinger: hPanel → the Node.js app's logs).
        console.error(JSON.stringify({event:'drive_import_failed',lesson:lessonId,reason:error instanceof Error?error.message:String(error)}));
        await db.run(`UPDATE lessons SET video_import_status='failed',video_import_error=? WHERE id=? AND drive_url=?`,[message.slice(0,255),lessonId,lesson.drive_url]).catch(()=>{});
      }
    }
  }finally{working=false;}
}
