import type { Request } from 'express';
import { config } from '../config.js';

const local=['localhost','127.0.0.1'];

// WEB_ORIGIN may hold several comma-separated origins; each is normalised (no trailing slash or path), and a public
// host also accepts its www/non-www twin, so "https://example.com/" still matches the browser's "https://www.example.com".
function parseOrigins(value:string){
  const list=new Set<string>();
  for(const raw of value.split(',').map(item=>item.trim()).filter(Boolean)){
    try{
      const url=new URL(raw);list.add(url.origin);
      if(!local.includes(url.hostname)&&!/^[\d.]+$/.test(url.hostname)){
        const twin=url.hostname.startsWith('www.')?url.hostname.slice(4):`www.${url.hostname}`;
        list.add(`${url.protocol}//${twin}${url.port?`:${url.port}`:''}`);
      }
    }catch{}
  }
  return list;
}
const origins=parseOrigins(config.origins);
const configured=(()=>{try{return new URL(config.origin);}catch{return null;}})();

// The host the browser addressed. A page can only send its own origin, so an Origin naming this same host is a
// same-origin request even when WEB_ORIGIN on the host was left at a different value.
function requestHosts(req:Request){
  const hosts=new Set<string>();
  for(const value of [req.headers.host,req.headers['x-forwarded-host']]){
    for(const host of String(value||'').split(',').map(item=>item.trim().toLowerCase()).filter(Boolean))hosts.add(host);
  }
  return hosts;
}

export function trustedOrigin(origin:string,req?:Request){
  let source:URL;
  try{source=new URL(origin);}catch{return false;}
  if(origins.has(source.origin))return true;
  if(req&&requestHosts(req).has(source.host.toLowerCase()))return true;
  if(config.production||!configured)return false;
  return local.includes(source.hostname)&&local.includes(configured.hostname)
    &&source.protocol===configured.protocol&&source.port===configured.port;
}
