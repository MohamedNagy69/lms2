import { Router,type Request,type Response } from 'express';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { authenticated, teacherOnly, isTeacher } from '../lib/auth.js';
import { authorizedLesson } from '../lib/catalog.js';
import { ensure, id, HttpError } from '../lib/errors.js';
import {encryptVideo,encryptVideoCopy,encryptedVideoHeader,decryptedVideoRange,reencryptedVideoRange,streamCipherFor,videoFingerprint,videoHeaderSize} from '../lib/video-crypto.js';
import { validateSignaturePath } from '../lib/file-signature.js';
import { downloadDriveVideo } from '../lib/drive-import.js';
export const media=Router();
const blockedAgents=['idman','internet download manager','fdm','freedownloadmanager','aria2','curl','wget','python','postman','ffmpeg','videodownloadhelper','jdownloader','yt-dlp','youtube-dl','eagleget','downloader','grabber','teleport'];
const extensions: Record<string,string[]>= {videos:['.mp4','.webm','.mkv','.mov','.m4v','.avi'],attachments:['.pdf','.doc','.docx','.ppt','.pptx','.xls','.xlsx','.csv','.txt','.zip','.png','.jpg','.jpeg','.webp'],questions:['.png','.jpg','.jpeg','.webp']};
const videoExtensions=extensions.videos||[];
const storage=multer.diskStorage({
  destination(req,_file,callback){
    const kind=String(req.params.kind); const folder=path.join(config.uploads,kind);
    fs.mkdir(folder,{recursive:true}).then(()=>callback(null,folder),error=>callback(error,folder));
  },
  filename(_req,file,callback){callback(null,randomBytes(20).toString('hex')+path.extname(file.originalname).toLowerCase());},
});
const upload=multer({storage,limits:{fileSize:1024*1024*1024,files:1},fileFilter(req,file,callback){
  const kind=String(req.params.kind),ext=path.extname(file.originalname).toLowerCase();
  if(extensions[kind]?.includes(ext)) callback(null,true);else callback(new HttpError(400,'نوع الملف غير مسموح'));
}});
async function validateSignature(file:Express.Multer.File,kind:string){
  return validateSignaturePath(file.path,file.originalname,kind);
}
const localVideoRoot=path.resolve(process.env.LOCAL_VIDEO_IMPORT_ROOT||path.join(os.homedir(),'Downloads','Video'));
function localImportAllowed(){
  const host=new URL(config.origin).hostname;
  ensure(!config.production&&['localhost','127.0.0.1'].includes(host),404,'الاستيراد المحلي غير متاح');
}
media.get('/teacher/local-videos',teacherOnly,async(_req,res)=>{
  localImportAllowed();
  const entries=await fs.readdir(localVideoRoot,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT')return [];
    throw error;
  });
  const files=await Promise.all(entries.filter(entry=>entry.isFile()&&videoExtensions.includes(path.extname(entry.name).toLowerCase())).map(async entry=>{
    const stat=await fs.stat(path.join(localVideoRoot,entry.name));
    return {name:entry.name,size:stat.size};
  }));
  res.json({files:files.sort((a,b)=>a.name.localeCompare(b.name))});
});
media.post('/teacher/local-videos/import',teacherOnly,async(req,res)=>{
  localImportAllowed();
  const name=String(req.body?.name||'');
  ensure(name&&name===path.basename(name)&&!name.includes('/')&&!name.includes('\\'),400,'اسم ملف غير صالح');
  const ext=path.extname(name).toLowerCase();
  ensure(videoExtensions.includes(ext),400,'صيغة الفيديو غير مدعومة');
  const source=path.join(localVideoRoot,name),stat=await fs.lstat(source).catch(()=>null);
  ensure(stat,404,'الفيديو غير موجود في المجلد المحلي');
  ensure(stat.isFile(),404,'الفيديو غير موجود في المجلد المحلي');
  ensure(stat.size>0&&stat.size<=1024*1024*1024,413,'حجم الفيديو يجب أن يكون أقل من 1 جيجابايت');
  await validateSignaturePath(source,name,'videos');
  const destinationFolder=path.join(config.uploads,'videos');
  await fs.mkdir(destinationFolder,{recursive:true});
  const filename=randomBytes(20).toString('hex')+ext,destination=path.join(destinationFolder,filename);
  await encryptVideoCopy(source,destination);
  res.status(201).json({path:`videos/${filename}`,name});
});
// Converts a Google Drive video into a protected upload on demand (lessons saved with a Drive link are also
// converted automatically in the background, see lib/drive-import.ts).
media.post('/teacher/drive-videos/import',teacherOnly,async(req,res)=>{
  res.status(201).json(await downloadDriveVideo(String(req.body?.url||'').trim()));
});
media.post('/teacher/uploads/:kind',teacherOnly,(req,_res,next)=>{ensure(Object.keys(extensions).includes(String(req.params.kind)),400,'نوع ملف غير صالح');next();},upload.single('file'),async(req,res)=>{
  ensure(req.file,400,'اختر ملفًا');
  try{
    await validateSignature(req.file,String(req.params.kind));
    if(req.params.kind==='videos')await encryptVideo(req.file.path);
  }
  catch(error){await fs.unlink(req.file.path).catch(()=>{});throw error;}
  res.status(201).json({path:`${req.params.kind}/${req.file.filename}`,name:req.file.originalname});
});
function safeFile(relative:string){const absolute=path.resolve(config.uploads,relative);ensure(absolute.startsWith(config.uploads+path.sep),400,'مسار غير صالح');return absolute;}
const contentTypes:Record<string,string>={'.mp4':'video/mp4','.webm':'video/webm','.mkv':'video/x-matroska','.mov':'video/quicktime','.m4v':'video/mp4','.avi':'video/x-msvideo','.pdf':'application/pdf','.doc':'application/msword','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.ppt':'application/vnd.ms-powerpoint','.pptx':'application/vnd.openxmlformats-officedocument.presentationml.presentation','.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.csv':'text/csv; charset=utf-8','.zip':'application/zip','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.txt':'text/plain; charset=utf-8'};
async function sendStoredFile(req:Request,res:Response,absolute:string,disposition:'inline'|'attachment',encrypted=false){
  const stat=await fs.stat(absolute).catch((error:NodeJS.ErrnoException)=>{
    if(error.code==='ENOENT'||error.code==='ENOTDIR')throw new HttpError(404,'الملف غير موجود');
    throw error;
  });
  ensure(stat.isFile(),404,'الملف غير موجود');
  const header=encrypted?await encryptedVideoHeader(absolute):null;
  if(encrypted)ensure(header&&stat.size>=videoHeaderSize,503,'الفيديو يحتاج تهيئة التشفير قبل تشغيله');
  if(encrypted)ensure(req.headers.range,416,'طلب نطاق البث مطلوب');
  const size=encrypted?stat.size-videoHeaderSize:stat.size;
  const ext=path.extname(absolute).toLowerCase();
  const range=req.range(size,{combine:true});
  let start=0,end=size-1,status=200;
  res.setHeader('Accept-Ranges','bytes');
  if(range===-1){
    res.setHeader('Content-Range',`bytes */${size}`);
    throw new HttpError(416,'نطاق الملف غير صالح');
  }
  // Never turn a malformed or multipart request into a full-file response.
  if(range!==undefined && (!Array.isArray(range)||range.type!=='bytes'||range.length!==1))
    throw new HttpError(400,'نطاق الملف غير مدعوم');
  if(Array.isArray(range)){
    const requested=range[0];
    if(requested){
      start=requested.start;end=disposition==='inline'&&contentTypes[ext]?.startsWith('video/')?Math.min(requested.end,start+4*1024*1024-1):requested.end;status=206;
      res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
    }
  }
  res.status(status);
  res.setHeader('Content-Length',String(size?end-start+1:0));
  res.setHeader('Content-Type',contentTypes[ext]||'application/octet-stream');
  res.setHeader('Content-Disposition',`${disposition}; filename="${path.basename(absolute).replace(/[^\x20-\x7E]/g,'_')}"`);
  if(req.method==='HEAD'||!size){res.end();return;}
  const stream=header?decryptedVideoRange(absolute,header,start,end):createReadStream(absolute,{start,end});
  const close=()=>stream.destroy();
  res.once('close',close);
  stream.once('close',()=>res.off('close',close));
  stream.once('error',()=>res.destroy());
  stream.pipe(res);
}
// Shared checks for both video routes: signed-in, enrolled, a fresh token bound to this session and device,
// no known download tool, and a request coming from the platform's own pages (or its service worker).
async function authorizeVideoStream(req:Request,res:Response){
  ensure(req.user,401,'سجّل الدخول لمشاهدة الفيديو المرفوع');
  const {lesson}=await authorizedLesson(id(req.params.id),req.user);
  const agent=String(req.headers['user-agent']||'').toLowerCase();
  ensure(!blockedAgents.some(name=>agent.includes(name)),403,'برامج وأدوات التحميل محظورة لحماية المحتوى');
  const raw=String(req.query.token||'');
  let token:jwt.JwtPayload;
  try {token=jwt.verify(raw,config.secret,{algorithms:['HS256'],audience:'video'}) as jwt.JwtPayload;}catch{throw new HttpError(403,'انتهت صلاحية رابط الفيديو، أعد فتح الدرس');}
  ensure(token.lesson===lesson.id && token.sid===(req.sessionId||'preview') && token.uid===(req.user?.id||null),403,'الرابط غير صالح');
  ensure(token.fp===videoFingerprint(req.get('user-agent')),403,'رابط الفيديو مرتبط بالجهاز الذي فتح الدرس');
  ensure(lesson.video_source==='file' && lesson.video_file,404,'الفيديو غير موجود');
  // A CDN in front of the app (Hostinger's hcdn) can drop request headers, so a missing Referer is allowed; a
  // foreign one, or a browser saying the request is cross-site, is still refused. The token stays bound to the
  // session, user, browser and lesson.
  ensure(req.headers['sec-fetch-site']!=='cross-site',403,'الدخول المباشر لرابط البث محظور');
  const referer=String(req.headers.referer||'');
  if(referer)try{
    const source=new URL(referer),allowed=new URL(config.origin);
    const localAlias=!config.production && ['localhost','127.0.0.1'].includes(source.hostname) && ['localhost','127.0.0.1'].includes(allowed.hostname) && source.port===allowed.port && source.protocol===allowed.protocol;
    ensure(source.origin===allowed.origin||localAlias,403,'الدخول المباشر لرابط البث محظور');
  }catch{throw new HttpError(403,'الدخول المباشر لرابط البث محظور');}
  res.setHeader('Cache-Control','private, no-cache, no-store, must-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');res.setHeader('Expires','0');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive, nosnippet');
  res.setHeader('Cross-Origin-Resource-Policy','same-origin');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; media-src 'self'");
  return {lesson,raw};
}
// There is deliberately no plain video route: a decrypted video response is exactly what download managers grab.
// Protected stream: opaque, session-encrypted chunks that only the page's service worker can turn back into video.
const chunkSize=2*1024*1024;
media.get('/lessons/:id/chunk',async(req,res)=>{
  const {lesson,raw}=await authorizeVideoStream(req,res);
  const absolute=safeFile(lesson.video_file);
  const stat=await fs.stat(absolute).catch(()=>null);
  ensure(stat&&stat.isFile(),404,'الملف غير موجود');
  const header=await encryptedVideoHeader(absolute);
  ensure(header&&stat.size>=videoHeaderSize,503,'الفيديو يحتاج تهيئة التشفير قبل تشغيله');
  const size=stat.size-videoHeaderSize;
  // The worker sends the range as ?start=&end=: Hostinger's CDN removes the Range request header before it reaches
  // the app, then applies it to the app's answer. The header is still accepted for direct local requests.
  const queryRange=typeof req.query.start==='string'?`bytes=${req.query.start}-${typeof req.query.end==='string'?req.query.end:''}`:'';
  const match=/^bytes=(\d+)-(\d*)$/.exec(queryRange||String(req.headers.range||''));
  ensure(match,416,'طلب نطاق البث مطلوب');
  const requested=Number(match[1]);
  ensure(Number.isSafeInteger(requested)&&requested<size,416,'نطاق الملف غير صالح');
  const start=Math.floor(requested/16)*16,wanted=match[2]?Number(match[2]):size-1;
  const end=Math.min(size-1,Math.max(wanted,requested),start+chunkSize-1);
  res.status(200);
  res.setHeader('Content-Type','application/octet-stream');
  res.setHeader('Content-Length',String(end-start+1));
  res.setHeader('X-Chunk-Start',String(start));res.setHeader('X-Total-Size',String(size));
  res.setHeader('X-Media-Type',contentTypes[path.extname(absolute).toLowerCase()]||'video/mp4');
  const stream=reencryptedVideoRange(absolute,header,start,end,streamCipherFor(raw));
  const close=()=>stream.destroy();
  res.once('close',close);stream.once('close',()=>res.off('close',close));stream.once('error',()=>res.destroy());
  stream.pipe(res);
});
media.get('/attachments/:id/download',async(req,res)=>{
  const attachment=await db.one('SELECT * FROM attachments WHERE id=?',[id(req.params.id)]);ensure(attachment,404,'الملف غير موجود');
  await authorizedLesson(attachment.lesson_id,req.user);
  if(attachment.kind==='link'){ensure(/^https?:\/\//i.test(attachment.url),400,'رابط غير صالح');res.redirect(attachment.url);return;}
  res.setHeader('Cache-Control','private, no-store');await sendStoredFile(req,res,safeFile(attachment.file),'attachment');
});
media.get('/questions/:id/image',authenticated,async(req,res)=>{
  const question=await db.one('SELECT * FROM questions WHERE id=?',[id(req.params.id)]);ensure(question?.image,404,'الصورة غير موجودة');
  ensure(isTeacher(req.user)||await db.one('SELECT id FROM exam_attempts WHERE exam_id=? AND student_id=?',[question.exam_id,req.user!.id]),403,'سجّل الدخول للامتحان');
  res.setHeader('Cache-Control','private, no-store');await sendStoredFile(req,res,safeFile(question.image),'inline');
});
