import fs from 'node:fs/promises';
import path from 'node:path';
import {config} from '../config.js';
import {encryptVideo,encryptedVideoHeader} from '../lib/video-crypto.js';

const directory=path.join(config.uploads,'videos');
const entries=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{
  if((error as NodeJS.ErrnoException).code==='ENOENT')return [];
  throw error;
});
let encrypted=0,alreadyEncrypted=0;
for(const entry of entries){
  if(!entry.isFile()||!/^\.(mp4|webm|mkv|mov|m4v|avi)$/i.test(path.extname(entry.name)))continue;
  const file=path.join(directory,entry.name);
  if(await encryptedVideoHeader(file)){alreadyEncrypted++;continue;}
  await encryptVideo(file);
  encrypted++;
}
console.log(`Encrypted ${encrypted} videos; ${alreadyEncrypted} were already encrypted.`);
