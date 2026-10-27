import fs from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import path from 'node:path';
import {config} from '../config.js';

const magic=Buffer.from('MUDARRIS-VIDEO1!');
export const videoHeaderSize=32;

function key(){
  const raw=process.env.VIDEO_ENCRYPTION_KEY||'';
  if(!/^[a-f0-9]{64}$/i.test(raw))throw new Error('VIDEO_ENCRYPTION_KEY must be a 64-character hexadecimal key');
  return Buffer.from(raw,'hex');
}

export async function encryptedVideoHeader(file:string){
  const handle=await fs.open(file,'r');
  try{
    const header=Buffer.alloc(videoHeaderSize);
    const {bytesRead}=await handle.read(header,0,header.length,0);
    return bytesRead===videoHeaderSize&&header.subarray(0,16).equals(magic)?header:null;
  }finally{await handle.close();}
}

function counterAt(iv:Buffer,block:number){
  const result=Buffer.from(iv);
  let carry=BigInt(block);
  for(let i=15;i>=0&&carry>0n;i--){carry+=BigInt(result[i]??0);result[i]=Number(carry&255n);carry>>=8n;}
  return result;
}

export async function encryptVideo(file:string){
  if(await encryptedVideoHeader(file))return;
  const iv=randomBytes(16),temporary=path.join(path.dirname(file),`.${path.basename(file)}.${randomBytes(8).toString('hex')}.encrypting`);
  try{
    const output=createWriteStream(temporary,{flags:'wx',mode:0o600});
    await new Promise<void>((resolve,reject)=>output.write(Buffer.concat([magic,iv]),error=>error?reject(error):resolve()));
    await pipeline(createReadStream(file),createCipheriv('aes-256-ctr',key(),iv),output);
    await fs.rename(temporary,file);
  }catch(error){await fs.unlink(temporary).catch(()=>{});throw error;}
}

// Import a local video straight into encrypted storage; no plaintext upload copy is created.
export async function encryptVideoCopy(source:string,destination:string){
  const iv=randomBytes(16),secret=key();
  const output=createWriteStream(destination,{flags:'wx',mode:0o600});
  try{
    await new Promise<void>((resolve,reject)=>output.write(Buffer.concat([magic,iv]),error=>error?reject(error):resolve()));
    await pipeline(createReadStream(source),createCipheriv('aes-256-ctr',secret,iv),output);
  }catch(error){output.destroy();await fs.unlink(destination).catch(()=>{});throw error;}
}

// Ties a video token to the browser that opened the lesson (the token is also bound to its session and user).
// The client IP is left out on purpose: behind Hostinger's CDN the address the app sees changes between requests
// (different edge nodes, IPv4/IPv6), which rejected every chunk after the first and broke playback.
export function videoFingerprint(userAgent:string|undefined){
  return createHash('sha256').update(`video-fp|${userAgent||''}`).digest('base64url').slice(0,24);
}

// Per-stream key for the protected player. Chunks travel as opaque AES-CTR ciphertext (not a video file), so
// download managers watching the network never see playable media; the page's service worker decrypts them.
// The counter block is an 8-byte nonce followed by the 64-bit block index, which WebCrypto's AES-CTR (length 64) matches.
export function streamCipherFor(token:string){
  const digest=createHmac('sha256',config.secret).update(`video-stream:${token}`).digest();
  const nonce=createHmac('sha256',config.secret).update(`video-nonce:${token}`).digest().subarray(0,8);
  return {key:digest,nonce};
}
function streamCounter(nonce:Buffer,block:number){
  const counter=Buffer.alloc(16);nonce.copy(counter,0);counter.writeBigUInt64BE(BigInt(block),8);return counter;
}
// `start` must be a multiple of 16 so the browser can rebuild the same counter from the chunk offset.
export function reencryptedVideoRange(file:string,header:Buffer,start:number,end:number,stream:{key:Buffer;nonce:Buffer}){
  const cipher=createCipheriv('aes-256-ctr',stream.key,streamCounter(stream.nonce,start/16));
  const source=decryptedVideoRange(file,header,start,end);
  source.on('error',error=>cipher.destroy(error));
  cipher.on('close',()=>source.destroy());
  return source.pipe(cipher);
}

export function decryptedVideoRange(file:string,header:Buffer,start:number,end:number){
  const aligned=Math.floor(start/16)*16,skip=start-aligned;
  let remainingSkip=skip;
  const trim=new Transform({transform(chunk:Buffer,_encoding,callback){
    if(remainingSkip>=chunk.length){remainingSkip-=chunk.length;callback();return;}
    const data=chunk.subarray(remainingSkip);remainingSkip=0;callback(null,data);
  }});
  const source=createReadStream(file,{start:videoHeaderSize+aligned,end:videoHeaderSize+end});
  const decipher=createDecipheriv('aes-256-ctr',key(),counterAt(header.subarray(16,32),Math.floor(start/16)));
  source.on('error',error=>trim.destroy(error));
  decipher.on('error',error=>trim.destroy(error));
  trim.on('close',()=>{source.destroy();decipher.destroy();});
  return source.pipe(decipher).pipe(trim);
}
