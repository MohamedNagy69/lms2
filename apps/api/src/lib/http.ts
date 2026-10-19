import {randomUUID} from 'node:crypto';
import type {Request,Response,NextFunction} from 'express';
import {z} from 'zod';
import {HttpError} from './errors.js';

export function requestContext(_req:Request,res:Response,next:NextFunction){
  res.locals.requestId=randomUUID();
  res.setHeader('X-Request-ID',res.locals.requestId);
  res.setHeader('Cache-Control','private, no-store');
  next();
}

export function errorHandler(error:any,req:Request,res:Response,next:NextFunction){
  if(res.headersSent){next(error);return;}
  const send=(status:number,message:string,details?:unknown)=>res.status(status).json({
    error:message,request_id:res.locals.requestId,...(details?{details}:{})
  });
  if(error instanceof z.ZodError){send(400,'راجع البيانات المدخلة',error.issues.map(i=>({field:i.path.join('.'),message:i.message})));return;}
  if(error instanceof HttpError){send(error.status,error.message);return;}
  if(error.type==='entity.parse.failed'){send(400,'صيغة الطلب غير صحيحة');return;}
  if(error.type==='entity.too.large'||error.code==='LIMIT_FILE_SIZE'){send(413,'حجم الطلب أكبر من المسموح');return;}
  if(error.type==='charset.unsupported'||error.type==='encoding.unsupported'){send(415,'ترميز الطلب غير مدعوم');return;}
  if(error.code==='ER_DUP_ENTRY'){send(409,'هذه البيانات موجودة بالفعل');return;}
  if(error.code==='ER_NO_REFERENCED_ROW_2'){send(400,'العنصر المرتبط غير موجود');return;}
  if(error.code==='ER_ROW_IS_REFERENCED_2'){send(409,'لا يمكن حذف عنصر مرتبط ببيانات أخرى');return;}
  if(error.code?.startsWith('LIMIT_')){send(400,'طلب رفع الملف غير صالح');return;}
  // Log identifiers, never request bodies, query strings, SQL, or credentials.
  console.error(JSON.stringify({event:'request_failed',request_id:res.locals.requestId,method:req.method,code:error.code||error.name||'Error'}));
  if(['ECONNREFUSED','ETIMEDOUT','PROTOCOL_CONNECTION_LOST','ER_CON_COUNT_ERROR','ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code)){
    res.setHeader('Retry-After','3');send(503,'الخدمة مشغولة مؤقتًا، حاول مرة أخرى');return;
  }
  send(500,'تعذر تنفيذ الطلب، حاول لاحقًا');
}
