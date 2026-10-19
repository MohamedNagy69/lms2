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

export async function downloadDriveVideo(raw:string):Promise<{path:string;name:string}>{
  const fileId=raw.match(/(?:\/d\/|[?&]id=)([\w-]{10,})/)?.[1]||(/^[\w-]{10,}$/.test(raw)?raw:'');
  ensure(fileId,400,'رابط جوجل درايف غير صالح');
  let resourceKey='';try{resourceKey=new URL(raw).searchParams.get('resourcekey')||'';}catch{}
  const source=`https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t${resourceKey?`&resourcekey=${encodeURIComponent(resourceKey)}`:''}`;
  const response=await fetch(source,{redirect:'follow',signal:AbortSignal.timeout(30*60_000)}).catch(()=>null);
  ensure(response?.ok&&response.body,502,'تعذر الوصول للملف على جوجل درايف. تأكد من الرابط وأن المشاركة «أي شخص لديه الرابط».');
  const type=(response.headers.get('content-type')||'').split(';')[0]!.trim().toLowerCase();
  if(type==='text/html'){await response.body.cancel();throw new HttpError(400,'جوجل درايف رفض التحميل: اجعل الملف متاحًا لأي شخص لديه الرابط واسمح بالتنزيل مؤقتًا، ثم جرّب مرة أخرى.');}
  const disposition=response.headers.get('content-disposition')||'';
  const name=decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1]||disposition.match(/filename="?([^";]+)"?/i)?.[1]||`drive-${fileId}`);
  const ext=(videoExtensions.includes(path.extname(name).toLowerCase())?path.extname(name).toLowerCase():videoTypes[type])||'';
  if(!ext){await response.body.cancel();throw new HttpError(400,'الملف على درايف ليس فيديو بصيغة مدعومة (MP4 أو WebM أو MKV أو MOV أو M4V أو AVI).');}
  const declared=Number(response.headers.get('content-length')||0);
  if(declared>maxVideoBytes){await response.body.cancel();throw new HttpError(413,'حجم الفيديو يجب أن يكون أقل من 1 جيجابايت');}
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
        await db.run(`UPDATE lessons SET video_import_status='failed',video_import_error=? WHERE id=? AND drive_url=?`,[message.slice(0,255),lessonId,lesson.drive_url]).catch(()=>{});
      }
    }
  }finally{working=false;}
}
