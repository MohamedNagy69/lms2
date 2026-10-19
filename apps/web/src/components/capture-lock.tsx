'use client';

import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {api,useAuth} from '@/lib/client';
import {CAPTURE_LOCK_EVENT,captureLockDuration,captureLockStartedAt,clearCaptureLock,rememberCaptureLockDuration,storeCaptureLock,storedCaptureLock} from '@/lib/capture-lock';

function clock(value:number){const seconds=Math.max(0,Math.floor(value));return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
// Inline !important on a container React does not own beats any stylesheet rule added from DevTools.
const HOST_STYLE='position:absolute!important;inset:0!important;z-index:60!important;display:block!important;background:#020817!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;transform:none!important;clip-path:none!important;border-radius:inherit!important';
const PLAYER='.universal-player';

// Lock drawn over the video player (normal or fullscreen) after a capture attempt; the rest of the page stays usable.
// It has no close control and puts itself back if removed or hidden from DevTools. The account itself is banned and
// signed out on the server. The teacher can stop the timer or lift the ban from the dashboard; the lock checks the
// server every 10 seconds and reloads the page once it is lifted.
export function CaptureLockGate(){
  const {refresh}=useAuth();
  const [until,setUntil]=useState(0),[now,setNow]=useState(0),[duration,setDuration]=useState(3600),[host,setHost]=useState<HTMLDivElement|null>(null),card=useRef<HTMLDivElement>(null);
  // A local lock younger than 15 seconds is kept, because its violation request may still be in flight.
  const syncWithServer=async()=>{
    try{
      const {remaining_seconds,duration_seconds}=await api<{remaining_seconds:number;duration_seconds:number}>('/auth/security-lock');
      if(duration_seconds>0){rememberCaptureLockDuration(duration_seconds);setDuration(duration_seconds);}
      if(remaining_seconds>0){storeCaptureLock(Date.now()+remaining_seconds*1000,true);return;}
      if(!storedCaptureLock()||captureLockStartedAt()>Date.now()-15_000)return;
      clearCaptureLock();setUntil(0);window.location.reload();
    }catch{}
  };

  useEffect(()=>{
    setDuration(captureLockDuration());setUntil(storedCaptureLock());setNow(Date.now());
    const onLock=(event:Event)=>{setUntil(Number((event as CustomEvent<number>).detail)||0);setNow(Date.now());};
    const onStorage=()=>{setUntil(storedCaptureLock());setNow(Date.now());};
    window.addEventListener(CAPTURE_LOCK_EVENT,onLock);window.addEventListener('storage',onStorage);
    void syncWithServer();
    return()=>{window.removeEventListener(CAPTURE_LOCK_EVENT,onLock);window.removeEventListener('storage',onStorage);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const active=until>0&&until>now;
  useEffect(()=>{if(!active)return;const timer=window.setInterval(()=>void syncWithServer(),10_000);return()=>window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[active]);
  // Sign the student out in this tab too (the server has already ended the session); the lesson page stays open.
  useEffect(()=>{if(!active)return;const timer=window.setTimeout(()=>void refresh(),1500);return()=>window.clearTimeout(timer);},[active,refresh]);
  useEffect(()=>{
    if(!until)return;
    if(until<=now){clearCaptureLock();setUntil(0);window.location.reload();return;}
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[until,now]);

  useEffect(()=>{
    if(!active)return;
    // The lock lives in a container React does not own, placed inside whichever player is on the page (the player is
    // also the fullscreen element when maximised). Pages without a player show nothing; the lock follows the student
    // to the next lesson they open.
    const root=document.createElement('div');root.setAttribute('style',HOST_STYLE);setHost(root);
    const watcher=new MutationObserver(()=>enforce());
    let watched:Element|null=null;
    const enforce=()=>{
      // An iframe or video cannot hold the lock, so fullscreen on one of those (not on the player) is closed instead.
      const fullscreen=document.fullscreenElement;
      if(fullscreen&&['IFRAME','VIDEO','IMG'].includes(fullscreen.tagName))void document.exitFullscreen().catch(()=>{});
      const player=document.querySelector(PLAYER);
      if(!player){if(root.isConnected)root.remove();return;}
      if(root.parentNode!==player)player.appendChild(root);
      if(watched!==player){watched=player;watcher.observe(player,{childList:true});}
      if(root.getAttribute('style')!==HOST_STYLE)root.setAttribute('style',HOST_STYLE);
      if(root.hidden)root.hidden=false;
      const node=card.current;
      if(node){if(node.parentNode!==root)root.appendChild(node);if(node.hasAttribute('style'))node.removeAttribute('style');if(node.hidden)node.hidden=false;if(!node.classList.contains('capture-lock'))node.className='capture-lock';}
      player.querySelectorAll('video').forEach(video=>{if(!video.paused)video.pause();});
    };
    watcher.observe(root,{attributes:true,childList:true,subtree:true});
    const timer=window.setInterval(enforce,500);
    document.addEventListener('fullscreenchange',enforce);
    enforce();
    return()=>{watcher.disconnect();window.clearInterval(timer);document.removeEventListener('fullscreenchange',enforce);root.remove();setHost(null);};
  },[active]);

  if(!active||!host)return null;
  const remaining=Math.ceil((until-now)/1000),progress=Math.min(1,remaining/Math.max(duration,remaining,1)),circumference=2*Math.PI*54;
  return createPortal(<div ref={card} className="capture-lock" role="alertdialog" aria-modal="true" aria-labelledby="capture-lock-title" aria-describedby="capture-lock-text">
    <div className="capture-lock-card">
      <div className="capture-lock-ring" aria-hidden="true">
        <svg viewBox="0 0 120 120"><circle className="capture-lock-track" cx="60" cy="60" r="54"/><circle className="capture-lock-progress" cx="60" cy="60" r="54" strokeDasharray={circumference} strokeDashoffset={circumference*(1-progress)}/></svg>
        <span className="capture-lock-spinner"/>
        <span className="capture-lock-icon">🔒</span>
      </div>
      <h2 id="capture-lock-title">تم رصد محاولة تصوير أو تسجيل الشاشة</h2>
      <p id="capture-lock-text">تم تسجيل خروجك وإيقاف حسابك ونقله إلى قائمة الحسابات المحظورة. الفيديوهات مقفولة على هذا الجهاز حتى ينتهي العداد، ولن يعمل الحساب مرة أخرى إلا بعد أن يعيد المدرس تفعيله.</p>
      <b className="capture-lock-countdown" dir="ltr" role="timer" aria-live="off">{clock(remaining)}</b>
    </div>
  </div>,host);
}
