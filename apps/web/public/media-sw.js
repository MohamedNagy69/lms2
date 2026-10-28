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
  event.respondWith(serve(event.request,url).catch(()=>new Response(null,{status:502})));
});

function hexBytes(hex){
  const bytes=new Uint8Array(hex.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.substr(i*2,2),16);
  return bytes;
}
function cryptoKey(hex){
  if(!keys.has(hex))keys.set(hex,crypto.subtle.importKey('raw',hexBytes(hex),{name:'AES-CTR'},false,['decrypt']));
  return keys.get(hex);
}

async function serve(request,url){
  const lesson=url.pathname.slice(PREFIX.length).split('/')[0];
  const token=url.searchParams.get('token')||'',keyHex=url.searchParams.get('k')||'',nonceHex=url.searchParams.get('n')||'';
  if(!/^\d+$/.test(lesson)||!/^[0-9a-f]{64}$/.test(keyHex)||!/^[0-9a-f]{16}$/.test(nonceHex))return new Response(null,{status:400});
  const match=/^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range')||'bytes=0-');
  if(!match)return new Response(null,{status:416});
  const start=Number(match[1]);
  // The range also travels in the query string: Hostinger's CDN strips the Range request header.
  const upstream=await fetch(`/api/lessons/${lesson}/chunk?token=${encodeURIComponent(token)}&start=${start}&end=${match[2]}`,{
    headers:{Range:`bytes=${start}-${match[2]}`,'X-Requested-With':'Mudarris'},
    credentials:'same-origin',cache:'no-store',signal:request.signal,
  });
  if(!upstream.ok)return new Response(null,{status:upstream.status});
  const chunkStart=Number(upstream.headers.get('X-Chunk-Start')),total=Number(upstream.headers.get('X-Total-Size'));
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
