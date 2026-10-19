import fs from 'node:fs/promises';
import path from 'node:path';
import { ensure } from './errors.js';

export const videoExtensions=['.mp4','.webm','.mkv','.mov','.m4v','.avi'];
// Checks the first bytes of a stored file against the type its extension claims.
export async function validateSignaturePath(filePath:string,originalName:string,kind:string){
  const handle=await fs.open(filePath,'r');
  const bytes=Buffer.alloc(16);
  try{await handle.read(bytes,0,bytes.length,0);}finally{await handle.close();}
  const ext=path.extname(originalName).toLowerCase();
  const ascii=(start:number,end:number)=>bytes.subarray(start,end).toString('ascii');
  const imageOk=ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
    :['.jpg','.jpeg'].includes(ext)?bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
    :ext==='.webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP':true;
  const videoOk=['.mp4','.mov','.m4v'].includes(ext)?ascii(4,8)==='ftyp'
    :['.webm','.mkv'].includes(ext)?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
    :ext==='.avi'?ascii(0,4)==='RIFF'&&ascii(8,11)==='AVI':true;
  ensure(kind==='videos'?videoOk:kind==='questions'?imageOk:true,400,'محتوى الملف لا يطابق امتداده أو الملف تالف');
}
