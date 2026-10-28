// Protected video player bridge.
// The lesson page points its <video> at /protected-media/<lesson>?token&k&n, a path that never reaches the network.
// This worker answers those range requests by fetching opaque, session-encrypted chunks from
// /api/lessons/<lesson>/chunk, decrypting them with WebCrypto (AES-CTR) and returning normal 206 video responses.
// Download managers watching network traffic only ever see application/octet-stream ciphertext.
'use strict';

const PREFIX='/protected-media/';
const keys=new Map();

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// A hard reload (Ctrl+Shift+R) loads the page without a controller; the page asks to be claimed again.
self.addEventListener('message',event=>{if(event.data==='claim')event.waitUntil(self.clients.claim());});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(PREFIX))return;
  event.respondWith(serve(event.request,url,event.clientId).catch(error=>{
    const timedOut=error?.name==='TimeoutError';
    if(!event.request.signal.aborted)report(event.clientId,timedOut?'السيرفر لم يرسل جزء الفيديو في الوقت المحدد. تأكد من الإنترنت وأعد فتح الدرس.':'تعذر الاتصال بالسيرفر لتحميل الفيديو.',timedOut?504:502);
    return new Response(null,{status:timedOut?504:502});
  }));
});
// The <video> element only reports "failed" (or keeps spinning), so the page is told why a chunk could not be served.
async function report(clientId,error,status){
  const client=clientId&&await self.clients.get(clientId);
  const targets=client?[client]:await self.clients.matchAll({type:'window'});
  for(const target of targets)target.postMessage({type:'protected-media-error',error,status});
}

function hexBytes(hex){
  const bytes=new Uint8Array(hex.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.substr(i*2,2),16);
  return bytes;
}
function cryptoKey(hex){
  if(!keys.has(hex))keys.set(hex,crypto.subtle.importKey('raw',hexBytes(hex),{name:'AES-CTR'},false,['decrypt']));
  return keys.get(hex);
}

async function serve(request,url,clientId){
  const lesson=url.pathname.slice(PREFIX.length).split('/')[0];
  const token=url.searchParams.get('token')||'',keyHex=url.searchParams.get('k')||'',nonceHex=url.searchParams.get('n')||'';
  if(!/^\d+$/.test(lesson)||!/^[0-9a-f]{64}$/.test(keyHex)||!/^[0-9a-f]{16}$/.test(nonceHex))return new Response(null,{status:400});
  const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range')||'bytes=0-');
  if(!match)return new Response(null,{status:416});
  const start=Number(match[1]);
  // The range travels only in the query string. Hostinger's CDN strips a Range header before it reaches the app and
  // then applies it to the chunk itself, so every chunk after the first came back 416 (or never came back) and the
  // player kept spinning. A request that is still unanswered after a minute fails instead of spinning forever.
  const controller=new AbortController(),abort=()=>controller.abort(request.signal.reason);
  const timer=setTimeout(()=>controller.abort(new DOMException('Chunk timed out','TimeoutError')),60_000);
  request.signal.addEventListener('abort',abort,{once:true});
  try{
    const upstream=await fetch(`/api/lessons/${lesson}/chunk?token=${encodeURIComponent(token)}&start=${start}&end=${match[2]}`,{
      headers:{'X-Requested-With':'Mudarris'},credentials:'same-origin',cache:'no-store',signal:controller.signal,
    });
    if(!upstream.ok){
      const body=await upstream.json().catch(()=>null);
      report(clientId,body?.error||'رد غير متوقع من السيرفر',upstream.status);
      return new Response(null,{status:upstream.status});
    }
    const chunkStart=Number(upstream.headers.get('X-Chunk-Start')),total=Number(upstream.headers.get('X-Total-Size'));
    if(!upstream.headers.has('X-Chunk-Start')||!Number.isSafeInteger(chunkStart)||chunkStart>start||!(total>0)){
      report(clientId,'رد السيرفر وصل ناقص (غالبًا بسبب الـ CDN).',502);
      return new Response(null,{status:502});
    }
    return await decrypted(upstream,start,chunkStart,total,keyHex,nonceHex);
  }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}
async function decrypted(upstream,start,chunkStart,total,keyHex,nonceHex){
  const type=upstream.headers.get('X-Media-Type')||'video/mp4';
  const counter=new Uint8Array(16);
  counter.set(hexBytes(nonceHex),0);
  new DataView(counter.buffer).setBigUint64(8,BigInt(chunkStart/16));
  const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-CTR',counter,length:64},await cryptoKey(keyHex),await upstream.arrayBuffer()));
  const body=plain.subarray(start-chunkStart);
  return new Response(body,{status:206,headers:{
    'Content-Type':type,
    'Content-Length':String(body.length),
    'Content-Range':`bytes ${start}-${start+body.length-1}/${total}`,
    'Accept-Ranges':'bytes',
    'Cache-Control':'no-store',
  }});
}
