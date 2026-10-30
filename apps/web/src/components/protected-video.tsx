'use client';

import {useCallback,useEffect,useRef,useState} from 'react';
import {api,post,type Row} from '@/lib/client';
import {captureShortcut} from '@/lib/capture-shortcuts';
import {CAPTURE_LOCK_EVENT,captureLockDuration,storeCaptureLock,storedCaptureLock} from '@/lib/capture-lock';

type Violation='screenshot'|'screen_recording'|'screen_selection'|'print'|'devtools'|'focus_lost';
type YouTubePlayer={playVideo:()=>void;pauseVideo:()=>void;stopVideo:()=>void;seekTo:(time:number,allowSeekAhead:boolean)=>void;setVolume:(volume:number)=>void;mute:()=>void;unMute:()=>void;setPlaybackRate:(rate:number)=>void;getCurrentTime:()=>number;getDuration:()=>number;getVideoLoadedFraction:()=>number;getPlayerState:()=>number;getIframe:()=>HTMLIFrameElement;destroy:()=>void};
// YouTube shows its title, channel, logo and "more videos" links whenever the video is not playing.
const YT_IDLE_STATES=new Set([-1,0,2,5]);
let youtubeReady:Promise<any>|undefined;
function loadYouTube(){
  if(typeof window==='undefined')return Promise.reject(new Error('المشغل غير متاح'));
  const browser=window as any;
  if(browser.YT?.Player)return Promise.resolve(browser.YT);
  if(!youtubeReady)youtubeReady=new Promise((resolve,reject)=>{
    const previous=browser.onYouTubeIframeAPIReady;
    browser.onYouTubeIframeAPIReady=()=>{previous?.();resolve(browser.YT);};
    if(document.querySelector('script[data-youtube-player]'))return;
    const script=document.createElement('script');script.dataset.youtubePlayer='1';script.src='https://www.youtube.com/iframe_api';script.onerror=()=>{youtubeReady=undefined;reject(new Error('تعذر تحميل مشغل يوتيوب'));};document.head.appendChild(script);
  });
  return youtubeReady;
}
// Inline SVG icons: the site font has no glyphs for ▶ / Ⅱ / ⛶, so text symbols rendered as empty boxes.
type IconName='play'|'pause'|'replay'|'back'|'forward'|'volume'|'volumeLow'|'mute'|'expand'|'shrink'|'shield';
function PlayerIcon({name}:{name:IconName}){
  const stroke={fill:'none',stroke:'currentColor',strokeWidth:2,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  const speaker=<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4Z" fill="currentColor"/>;
  const shapes:Record<IconName,React.ReactNode>={
    play:<path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l10-6.4a1 1 0 0 0 0-1.7l-10-6.4A1 1 0 0 0 8 5.6Z" fill="currentColor"/>,
    pause:<><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></>,
    replay:<><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" {...stroke}/><path d="M4.5 4.5v4h4" {...stroke}/></>,
    back:<><path d="M5 12a7 7 0 1 0 2.05-4.95" {...stroke}/><path d="M5 4.5v3.5h3.5" {...stroke}/><text x="12.3" y="15.2" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui,sans-serif">10</text></>,
    forward:<><path d="M19 12a7 7 0 1 1-2.05-4.95" {...stroke}/><path d="M19 4.5v3.5h-3.5" {...stroke}/><text x="11.7" y="15.2" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="system-ui,sans-serif">10</text></>,
    volume:<>{speaker}<path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" {...stroke}/><path d="M18.2 7a7 7 0 0 1 0 10" {...stroke}/></>,
    volumeLow:<>{speaker}<path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" {...stroke}/></>,
    mute:<>{speaker}<path d="m16 9.5 5 5m0-5-5 5" {...stroke}/></>,
    expand:<path d="M4.5 9V4.5H9M19.5 9V4.5H15M4.5 15v4.5H9M19.5 15v4.5H15" {...stroke}/>,
    shrink:<path d="M9 4.5V9H4.5M15 4.5V9h4.5M9 19.5V15H4.5M15 19.5V15h4.5" {...stroke}/>,
    shield:<path d="M12 3.5 5.5 6v5c0 4.2 2.8 7.8 6.5 9.4 3.7-1.6 6.5-5.2 6.5-9.4V6L12 3.5Z" {...stroke}/>,
  };
  return <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}
function formatTime(value:number){if(!Number.isFinite(value)||value<0)return '00:00';const seconds=Math.floor(value);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function formatLockTime(value:number){const seconds=Math.max(0,Math.floor(value));return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds%3600/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}

type ProtectedStream={token:string;key:string;nonce:string};
// Uploaded videos play through /media-sw.js, which fetches encrypted chunks and decrypts them in the browser, so
// download managers (IDM and the like) never see a video file on the network. There is no plain-stream fallback:
// a browser without service workers (for example a Firefox private window) gets a message instead.
function useProtectedSource(lessonId:number,streamUrl:string|null,stream:ProtectedStream|null,onUnsupported:()=>void){
  const [source,setSource]=useState<string|null>(null);
  useEffect(()=>{
    setSource(null);
    if(!streamUrl)return;
    if(!stream)return;
    if(!('serviceWorker' in navigator)){onUnsupported();return;}
    let cancelled=false;
    const virtual=`/protected-media/${lessonId}?token=${encodeURIComponent(stream.token)}&k=${stream.key}&n=${stream.nonce}`;
    const controlled=()=>new Promise<void>(resolve=>{if(navigator.serviceWorker.controller){resolve();return;}navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true});});
    navigator.serviceWorker.register('/media-sw.js',{scope:'/'}).then(()=>navigator.serviceWorker.ready).then(registration=>{if(!navigator.serviceWorker.controller)registration.active?.postMessage('claim');}).then(controlled)
      .then(()=>{if(!cancelled)setSource(virtual);},()=>{if(!cancelled)onUnsupported();});
    return()=>{cancelled=true;};
  },[lessonId,streamUrl,stream?.token,stream?.key,stream?.nonce]);
  return source;
}

export function ProtectedVideo({lesson,streamUrl,protectedStream=null,embedUrl,user,watermark}:{lesson:Row;streamUrl:string|null;protectedStream?:ProtectedStream|null;embedUrl:string|null;user:Row|null;watermark:boolean}){
  const container=useRef<HTMLDivElement>(null),video=useRef<HTMLVideoElement>(null),drive=useRef<HTMLIFrameElement>(null),youtubeMount=useRef<HTMLDivElement>(null),youtube=useRef<YouTubePlayer|null>(null),recording=useRef(false),reported=useRef(false),lastShortcut=useRef(0);
  const initialLock=user?.locked_until?new Date(user.locked_until).getTime():0;
  const [curtain,setCurtain]=useState(false),[blocked,setBlocked]=useState(initialLock>Date.now()?'تم إيقاف الفيديو لمدة ساعة بسبب مخالفة حماية المحتوى':''),[lockUntil,setLockUntil]=useState(initialLock),[lockSeconds,setLockSeconds]=useState(Math.max(0,Math.ceil((initialLock-Date.now())/1000))),[position,setPosition]=useState({top:14,left:8}),[playing,setPlaying]=useState(false),[current,setCurrent]=useState(0),[duration,setDuration]=useState(0),[volume,setVolume]=useState(100),[speed,setSpeed]=useState(1),[playerError,setPlayerError]=useState(''),[fullscreen,setFullscreen]=useState(false),[ytState,setYtState]=useState(-1),[muted,setMuted]=useState(false),[autoMuted,setAutoMuted]=useState(false),[teacherNotice,setTeacherNotice]=useState(false),[buffered,setBuffered]=useState(0),[waiting,setWaiting]=useState(false),[controlsShown,setControlsShown]=useState(true);
  const hideControlsTimer=useRef<number|undefined>(undefined),overControls=useRef(false);
  // Controls fade out after a few seconds of playback without pointer movement, and come back on any movement, touch or focus.
  const revealControls=useCallback(()=>{
    setControlsShown(true);window.clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current=window.setTimeout(()=>{if(!overControls.current)setControlsShown(false);},2800);
  },[]);
  useEffect(()=>()=>window.clearTimeout(hideControlsTimer.current),[]);
  const source=String(lesson.video_source),isFile=source==='file',isYouTube=source==='youtube',isDrive=source==='drive';
  const videoId=isYouTube&&embedUrl?new URL(embedUrl).pathname.split('/').filter(Boolean).pop()||'':'';
  // The <video> element only reports "failed"; ask the chunk endpoint directly so the message says why.
  const explainFileError=async(stalled=false)=>{
    let reason='';
    if(!navigator.serviceWorker?.controller)reason='المشغل المحمي لم يتفعّل في الصفحة. اعمل تحديث للصفحة (Ctrl+Shift+R).';
    else try{
      const response=await fetch(`/api/lessons/${lesson.id}/chunk?token=${encodeURIComponent(protectedStream?.token||'')}&start=0&end=15`,{credentials:'same-origin',cache:'no-store',headers:{'X-Requested-With':'Mudarris'}});
      if(!response.ok){const body=await response.json().catch(()=>null);reason=`${body?.error||'رد غير متوقع من السيرفر'} (${response.status})`;}
    }catch{reason='تعذر الاتصال بالسيرفر.';}
    if(reason||!stalled)setPlayerError(reason||'تعذر تشغيل الملف. أعد فتح الدرس أو راجع صيغة الفيديو.');
  };
  const fileSource=useProtectedSource(Number(lesson.id),isFile?streamUrl:null,protectedStream,()=>setPlayerError('المتصفح ده مش بيدعم التشغيل المحمي (زي نافذة التصفح الخفي في فايرفوكس). افتح الدرس من Chrome أو Edge في نافذة عادية.'));
  // A video that keeps loading without ever failing gets the same check after 20 seconds.
  useEffect(()=>{if(!fileSource)return;const timer=window.setTimeout(()=>{if(!video.current||video.current.readyState<1)void explainFileError(true);},20_000);return()=>window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[fileSource]);

  useEffect(()=>{if(!watermark||!user)return;const timer=window.setInterval(()=>setPosition({top:10+Math.random()*58,left:7+Math.random()*62}),5500);return()=>window.clearInterval(timer);},[watermark,user]);
  useEffect(()=>{if(lockUntil<=Date.now())return;const update=()=>{const remaining=Math.max(0,Math.ceil((lockUntil-Date.now())/1000));setLockSeconds(remaining);if(!remaining)window.location.reload();};update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);},[lockUntil]);

  useEffect(()=>{
    if(!isYouTube||!videoId||!youtubeMount.current)return;
    let cancelled=false,timer:ReturnType<typeof setInterval>|undefined,player:YouTubePlayer|undefined;
    // YT.Player replaces its target element with an iframe. Giving it a child that React never rendered keeps
    // React's own nodes intact, so inserting siblings (spinner, covers) next to the mount cannot crash the page.
    const mount=youtubeMount.current,target=document.createElement('div');mount.replaceChildren(target);
    void loadYouTube().then(YT=>{if(cancelled)return;player=new YT.Player(target,{host:'https://www.youtube-nocookie.com',videoId,playerVars:{controls:0,disablekb:1,fs:0,rel:0,modestbranding:1,playsinline:1,iv_load_policy:3,origin:window.location.origin},events:{onReady:(event:any)=>{youtube.current=event.target;const frame=event.target.getIframe?.();frame?.setAttribute('tabindex','-1');setDuration(event.target.getDuration()||0);event.target.setVolume(volume);timer=setInterval(()=>{if(!youtube.current)return;const state=youtube.current.getPlayerState();setCurrent(youtube.current.getCurrentTime()||0);setDuration(youtube.current.getDuration()||0);setBuffered(youtube.current.getVideoLoadedFraction?.()||0);setPlaying(state===1);setYtState(state);},500);},onStateChange:(event:any)=>{setPlaying(event.data===1);setYtState(event.data);},onError:()=>setPlayerError('تعذر تشغيل فيديو يوتيوب')}});}).catch(error=>setPlayerError(error.message));
    return()=>{cancelled=true;if(timer)clearInterval(timer);youtube.current=null;player?.destroy();mount.replaceChildren();};
  },[isYouTube,videoId]);

  const pause=useCallback(()=>{video.current?.pause();youtube.current?.pauseVideo();setPlaying(false);},[]);
  // While this device is under a capture lock (set here, in another tab, or before a reload), unload the media so nothing
  // keeps playing behind the lock drawn over the player. `blocked` also removes the Drive iframe and the uploaded video.
  useEffect(()=>{
    const apply=()=>{if(storedCaptureLock()<=Date.now())return;pause();youtube.current?.stopVideo();setBlocked(current=>current||'المشغل مقفول على هذا الجهاز بسبب محاولة تصوير أو تسجيل الشاشة');};
    apply();window.addEventListener(CAPTURE_LOCK_EVENT,apply);const timer=window.setInterval(apply,2000);
    return()=>{window.removeEventListener(CAPTURE_LOCK_EVENT,apply);window.clearInterval(timer);};
  },[pause]);
  useEffect(()=>{
    if(!user||user.is_teacher)return;
    let active=true;
    const update=()=>{void api<{user:Row|null}>('/auth/me').then(({user:latest})=>{
      if(!active)return;
      // After a capture attempt the student stays on the lesson so the lock over the player stays visible.
      if(!latest||latest.is_security_banned){pause();if(storedCaptureLock()<=Date.now())window.location.assign('/login');return;}
      const until=latest.locked_until?new Date(latest.locked_until).getTime():0;
      if(until>Date.now()){
        pause();if(video.current){video.current.removeAttribute('src');video.current.load();}
        setCurtain(true);setBlocked('تم إيقاف الفيديو لمدة ساعة بسبب مخالفة حماية المحتوى');setLockUntil(until);
      }
    }).catch(()=>{});};
    const timer=window.setInterval(update,5000);
    return()=>{active=false;window.clearInterval(timer);};
  },[isFile,user,pause]);
  useEffect(()=>{
    // The lock screen appears before the request finishes; the server then bans the account and signs out every device.
    // Guests get the device lock too; the teacher is never locked out but sees that the attempt was caught.
    // A violation is reported once per page: after it the media is unloaded and the device is locked anyway.
    // Setting `blocked` also removes the Drive iframe, which is the only way to silence a cross-origin player.
    const record=(type:Violation)=>{
      if(user?.is_teacher){if(recording.current)return;recording.current=true;setTeacherNotice(true);window.setTimeout(()=>{setTeacherNotice(false);recording.current=false;},6000);return;}
      if(reported.current)return;reported.current=true;
      pause();youtube.current?.stopVideo();if(video.current){video.current.removeAttribute('src');video.current.load();}
      setCurtain(true);setBlocked('تم رصد محاولة تصوير أو تسجيل. تم إيقاف الحساب حتى يعيد المدرس تفعيله');setLockUntil(0);setLockSeconds(0);
      storeCaptureLock(Date.now()+captureLockDuration()*1000);
      void post('/security/record-violation',{type}).then(result=>{const remaining=Number(result.remaining_seconds);if(remaining>0)storeCaptureLock(Date.now()+remaining*1000,true);}).catch(()=>{});
    };
    // Windows delivers PrintScreen only on keyup, so both phases are watched.
    const securityKey=(event:KeyboardEvent)=>{const type=captureShortcut(event);if(type){event.preventDefault();event.stopPropagation();if(type==='screenshot')void navigator.clipboard?.writeText('').catch(()=>{});if(event.repeat||Date.now()-lastShortcut.current<1500)return;lastShortcut.current=Date.now();record(type);return;}const key=event.key.toLowerCase();if((event.ctrlKey||event.metaKey)&&['u','s','p'].includes(key)){event.preventDefault();event.stopPropagation();}};
    const beforePrint=()=>{pause();setCurtain(true);},context=(event:MouseEvent)=>{if((event.target as Element)?.closest('.video-wrap'))event.preventDefault();},selection=(event:Event)=>{if((event.target as Element)?.closest('.video-wrap'))event.preventDefault();};
    // Snipping and recording tools swallow their shortcuts, so the page only sees its window lose focus.
    // Leaving the lesson window is therefore treated as a capture attempt.
    const lostFocus=()=>{pause();setCurtain(true);record('focus_lost');};
    // Clicking into the Drive player blurs this window without leaving the page, so that one blur is ignored.
    const hide=()=>{if(document.activeElement===drive.current)return;lostFocus();};
    const focus=()=>{if(!blocked)setCurtain(false);};
    const visibility=()=>{if(document.hidden)lostFocus();else focus();};
    // While focus is inside the Drive player, key presses and blur never reach this page. document.hasFocus() still
    // turns false when the student switches to another app (a snipping or recording tool), so it is polled instead.
    // Counting starts only once the page has had focus, so opening a lesson in a background window is not a violation.
    let hadFocus=document.hasFocus(),away=false;
    const focusWatch=window.setInterval(()=>{if(document.hasFocus()){hadFocus=true;away=false;return;}if(hadFocus&&!away){away=true;lostFocus();}},400);
    window.addEventListener('blur',hide);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',visibility);window.addEventListener('keydown',securityKey,true);window.addEventListener('keyup',securityKey,true);window.addEventListener('beforeprint',beforePrint);document.addEventListener('contextmenu',context,true);document.addEventListener('selectstart',selection,true);document.addEventListener('dragstart',selection,true);const fs=()=>setFullscreen(document.fullscreenElement===container.current);document.addEventListener('fullscreenchange',fs);
    return()=>{window.clearInterval(focusWatch);window.removeEventListener('blur',hide);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('keydown',securityKey,true);window.removeEventListener('keyup',securityKey,true);window.removeEventListener('beforeprint',beforePrint);document.removeEventListener('contextmenu',context,true);document.removeEventListener('selectstart',selection,true);document.removeEventListener('dragstart',selection,true);document.removeEventListener('fullscreenchange',fs);};
  },[pause,user,isFile]);

  const toggle=()=>{if(isDrive){drive.current?.focus();return;}if(isFile&&video.current){if(video.current.paused)void video.current.play();else video.current.pause();return;}const player=youtube.current;if(!player)return;const state=player.getPlayerState();if(state===1){player.pauseVideo();return;}if(state===0)player.seekTo(0,true);player.playVideo();
    // The iframe never receives clicks, so browsers that refuse unmuted play from the page (iOS) get a muted start and an unmute button.
    window.setTimeout(()=>{if(youtube.current!==player||[1,3].includes(player.getPlayerState()))return;player.mute();setMuted(true);setAutoMuted(true);player.playVideo();},1200);};
  const unmute=()=>{const level=volume||100;youtube.current?.unMute();youtube.current?.setVolume(level);if(video.current){video.current.muted=false;video.current.volume=level/100;}if(!volume)setVolume(100);setMuted(false);setAutoMuted(false);};
  const toggleMute=()=>{if(muted||!volume){unmute();return;}if(video.current)video.current.muted=true;youtube.current?.mute();setMuted(true);setAutoMuted(false);};
  const seek=(time:number)=>{const next=Math.max(0,Math.min(duration,time));if(isFile&&video.current)video.current.currentTime=next;else youtube.current?.seekTo(next,true);setCurrent(next);};
  const changeVolume=(next:number)=>{setVolume(next);if(video.current){video.current.volume=next/100;if(next>0)video.current.muted=false;}if(muted&&next>0){youtube.current?.unMute();setMuted(false);setAutoMuted(false);}youtube.current?.setVolume(next);};
  const fileBuffered=(media:HTMLVideoElement)=>{const ranges=media.buffered;for(let i=0;i<ranges.length;i++)if(ranges.start(i)<=media.currentTime+0.5&&ranges.end(i)>=media.currentTime){setBuffered(media.duration?ranges.end(i)/media.duration:0);return;}};
  const changeSpeed=(next:number)=>{setSpeed(next);if(video.current)video.current.playbackRate=next;youtube.current?.setPlaybackRate(next);};
  const toggleFullscreen=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void container.current?.requestFullscreen();};
  const keyboard=(event:React.KeyboardEvent)=>{if((event.target as HTMLElement).matches('input,select,button'))return;if(event.key===' '){event.preventDefault();toggle();}if(event.key==='ArrowLeft')seek(current-10);if(event.key==='ArrowRight')seek(current+10);if(event.key.toLowerCase()==='f')toggleFullscreen();};
  const identity=user?[user.display_name||user.username,`ID ${user.id}`].filter(Boolean).join(' · '):'';
  const visible=!curtain&&!blocked,hasMedia=Boolean((isFile&&streamUrl)||(isYouTube&&videoId)||(isDrive&&embedUrl));
  const showControls=controlsShown||!playing,loading=visible&&!playerError&&(isFile?waiting:isYouTube&&ytState===3);
  const ended=isYouTube?ytState===0:Boolean(isFile&&duration&&!playing&&current>=duration-0.25);
  const progress=duration?Math.min(100,current/duration*100):0,volumeLevel=muted?0:volume;
  const fill=(value:number)=>({'--vp-fill':`${value}%`}) as React.CSSProperties;

  return <>{lesson.demo_video&&<p className="demo-video-note" role="note">هذا الفيديو مضاف لأغراض تجربة المنصة ولا يمثل شرح الدرس. يحتاج إلى رابط الشرح الصحيح قبل الاعتماد عليه.</p>}<div ref={container} className={`video-wrap protected-video universal-player ${isDrive?'drive-player':''} ${showControls||isDrive?'':'controls-hidden'}`} style={{userSelect:'none'}} tabIndex={0} onKeyDown={event=>{revealControls();keyboard(event);}} onMouseMove={revealControls} onTouchStart={revealControls} onMouseLeave={()=>{if(playing)setControlsShown(false);}}>
    {!hasMedia?<p className="player-empty">{isDrive&&lesson.video_preparing?'جارٍ تجهيز الفيديو بنسخة محمية، جرّب بعد دقائق':'الفيديو غير متاح أو الرابط غير صالح'}</p>:<>
      <div className={`player-surface ${isDrive?'drive-surface':''}`} onClick={isFile?toggle:undefined} onDoubleClick={isFile?toggleFullscreen:undefined}>
        <span className="player-source-badge"><PlayerIcon name="shield"/>محتوى تعليمي محمي</span>
        {loading&&<span className="vp-spinner" role="status" aria-label="جارٍ التحميل"/>}
        {isFile&&streamUrl&&!fileSource&&!blocked&&<p className="player-empty">جارٍ تجهيز المشغل المحمي…</p>}
        {isFile&&fileSource&&!blocked&&<video ref={video} src={fileSource}controls={false} controlsList="nodownload noremoteplayback" disablePictureInPicture playsInline preload="metadata" onLoadedMetadata={event=>setDuration(event.currentTarget.duration||0)} onTimeUpdate={event=>{setCurrent(event.currentTarget.currentTime);fileBuffered(event.currentTarget);}} onProgress={event=>fileBuffered(event.currentTarget)} onWaiting={()=>setWaiting(true)} onPlaying={()=>setWaiting(false)} onCanPlay={()=>setWaiting(false)} onPlay={()=>{setPlaying(true);revealControls();}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>void explainFileError()}/>}
        {isYouTube&&<><div ref={youtubeMount} className="youtube-player-mount" aria-hidden="true"/>
          {/* Transparent layer over the whole player: no click can reach YouTube's title, logo, share or suggested-video links. */}
          <span className="youtube-click-shield" aria-hidden="true" onClick={event=>{event.stopPropagation();toggle();}} onDoubleClick={event=>{event.preventDefault();toggleFullscreen();}}/>
          {visible&&!playerError&&YT_IDLE_STATES.has(ytState)&&<div className="youtube-idle-cover" onClick={event=>{event.stopPropagation();toggle();}}><button type="button" className="player-big-play" onClick={event=>{event.stopPropagation();toggle();}} aria-label={ytState===0?'إعادة تشغيل الفيديو':'تشغيل الفيديو'}><PlayerIcon name={ytState===0?'replay':'play'}/></button></div>}
          {autoMuted&&playing&&<button type="button" className="youtube-unmute" onClick={event=>{event.stopPropagation();unmute();}}>🔇 اضغط لتشغيل الصوت</button>}
        </>}
        {isDrive&&embedUrl&&<>{!blocked&&<iframe ref={drive} src={embedUrl} title={lesson.title} allow="autoplay; encrypted-media; fullscreen 'none'; picture-in-picture 'none'" sandbox="allow-scripts allow-same-origin allow-forms allow-presentation" referrerPolicy="strict-origin-when-cross-origin" style={{visibility:visible?'visible':'hidden',opacity:visible?1:0}}/>}<span className="drive-protection-top" title="محتوى محمي ضد الفتح والتحميل"/><span className="drive-protection-corner" title="استخدم زر ملء الشاشة الخاص بالمنصة"/></>}
        {isFile&&fileSource&&!playing&&!loading&&visible&&!playerError&&<button type="button" className="player-big-play" onClick={event=>{event.stopPropagation();if(ended)seek(0);toggle();}} aria-label={ended?'إعادة تشغيل الفيديو':'تشغيل الفيديو'}><PlayerIcon name={ended?'replay':'play'}/></button>}
      </div>
      {!isDrive&&<div className="vp-controls" dir="ltr" onMouseEnter={()=>{overControls.current=true;}} onMouseLeave={()=>{overControls.current=false;revealControls();}} onFocus={revealControls}>
        <div className="vp-timeline" style={{...fill(progress),'--vp-buffered':`${Math.max(progress,buffered*100)}%`} as React.CSSProperties}>
          <input className="vp-range" aria-label="وقت الفيديو" aria-valuetext={`${formatTime(current)} من ${formatTime(duration)}`} type="range" min={0} max={Math.max(duration,1)} step="0.1" value={Math.min(current,Math.max(duration,1))} disabled={!duration} onChange={event=>seek(Number(event.target.value))}/>
        </div>
        <div className="vp-row">
          <div className="vp-group">
            <button type="button" className="vp-btn vp-btn-primary" onClick={()=>{if(ended&&isFile)seek(0);toggle();}} aria-label={playing?'إيقاف مؤقت':ended?'إعادة التشغيل':'تشغيل'}><PlayerIcon name={playing?'pause':ended?'replay':'play'}/></button>
            <button type="button" className="vp-btn" onClick={()=>seek(current-10)} aria-label="رجوع 10 ثواني"><PlayerIcon name="back"/></button>
            <button type="button" className="vp-btn" onClick={()=>seek(current+10)} aria-label="تقديم 10 ثواني"><PlayerIcon name="forward"/></button>
            <div className="vp-volume">
              <button type="button" className="vp-btn" onClick={toggleMute} aria-label={volumeLevel?'كتم الصوت':'تشغيل الصوت'}><PlayerIcon name={!volumeLevel?'mute':volumeLevel<50?'volumeLow':'volume'}/></button>
              <input className="vp-range vp-volume-range" style={fill(volumeLevel)} aria-label="مستوى الصوت" type="range" min={0} max={100} value={volumeLevel} onChange={event=>changeVolume(Number(event.target.value))}/>
            </div>
            <span className="vp-time"><b>{formatTime(current)}</b><span>/ {formatTime(duration)}</span></span>
          </div>
          <div className="vp-group">
            <select className="vp-speed" aria-label="سرعة التشغيل" value={speed} onChange={event=>changeSpeed(Number(event.target.value))}>{[.75,1,1.25,1.5,1.75,2].map(value=><option key={value} value={value}>{value}x</option>)}</select>
            <button type="button" className="vp-btn" onClick={toggleFullscreen} aria-label={fullscreen?'إنهاء ملء الشاشة':'ملء الشاشة'}><PlayerIcon name={fullscreen?'shrink':'expand'}/></button>
          </div>
        </div>
      </div>}
      {isDrive&&<button type="button" className="vp-btn drive-fullscreen" onClick={toggleFullscreen} aria-label={fullscreen?'إنهاء ملء الشاشة':'ملء الشاشة'}><PlayerIcon name={fullscreen?'shrink':'expand'}/></button>}
      {playerError&&<div className="video-curtain" role="alert"><strong>تعذر تشغيل الفيديو</strong><span>{playerError}</span></div>}
      {watermark&&identity&&<><span className="video-watermark" style={{top:`${position.top}%`,left:`${position.left}%`}}>{identity}</span><span className="video-watermark-ghost">{identity}</span></>}
      {(curtain||teacherNotice)&&!blocked&&<div className="video-curtain privacy-curtain" role="status">{teacherNotice?<><strong>🛡️ تم رصد محاولة تصوير أو تسجيل الشاشة</strong><span>حساب المدرس مستثنى من القفل. لو كان طالبًا لبدأ عداد الساعة فورًا وتم حظر حسابه.</span></>:<><strong>🔒 تم إيقاف الفيديو</strong><span>جارٍ التحقق من حالة الحساب…</span></>}</div>}
      {blocked&&<div className="video-curtain security-lock" role="alert"><strong>{lockSeconds?'تم إيقاف الفيديو لمدة ساعة':'تم إيقاف الحساب'}</strong><span>{blocked}</span>{lockSeconds>0&&<b className="security-countdown" dir="ltr">{formatLockTime(lockSeconds)}</b>}</div>}
    </>}
  </div></>;
}

// Teacher-only check of every step an uploaded video goes through, run from the teacher's own browser, so a failure
// on the host (CDN, proxy, missing file) is named instead of guessed.
type Check={step:string;ok:boolean;detail:string};
export function VideoDiagnostics({lessonId}:{lessonId:number}){
  const [checks,setChecks]=useState<Check[]|null>(null),[running,setRunning]=useState(false);
  async function run(){
    setRunning(true);const out:Check[]=[];const add=(step:string,ok:boolean,detail:string)=>{out.push({step,ok,detail});setChecks([...out]);};
    try{
      const sw='serviceWorker' in navigator;
      add('المتصفح بيدعم التشغيل المحمي',sw,sw?(navigator.serviceWorker.controller?'المشغل المحمي شغال في الصفحة':'المشغل المحمي مش متفعّل لسه: اعمل Ctrl+Shift+R'):'افتح من Chrome أو Edge في نافذة عادية');
      const lessonResponse=await fetch(`/api/lessons/${lessonId}`,{credentials:'same-origin',cache:'no-store'});
      const data=await lessonResponse.json().catch(()=>null);
      add('بيانات الدرس من السيرفر',lessonResponse.ok,lessonResponse.ok?`مصدر الفيديو: ${data?.lesson?.video_source||'؟'}`:`${data?.error||'رد غير متوقع'} (HTTP ${lessonResponse.status})`);
      if(!lessonResponse.ok)return;
      const stream=data.protected_stream as ProtectedStream|null;
      add('ملف فيديو مربوط بالدرس',Boolean(stream),stream?'موجود':data.lesson.video_source==='drive'?'الدرس لسه على رابط درايف ومتحوّلش لنسخة محمية':'الدرس مالوش ملف فيديو، ارفعه من تعديل الدرس');
      if(!stream)return;
      const chunk=await fetch(`/api/lessons/${lessonId}/chunk?token=${encodeURIComponent(stream.token)}&start=0&end=15`,{credentials:'same-origin',cache:'no-store',headers:{'X-Requested-With':'Mudarris'}});
      const chunkError=chunk.ok?null:await chunk.json().catch(()=>null);
      const total=Number(chunk.headers.get('X-Total-Size'));
      add('السيرفر بيبعت أجزاء الفيديو',chunk.ok&&total>0,chunk.ok?(total>0?`حجم الفيديو ${(total/1048576).toFixed(0)} MB`:'الرد وصل من غير بيانات الحجم (X-Total-Size)، غالبًا الـ CDN شالها'):`${chunkError?.error||'رد غير متوقع من السيرفر أو الـ CDN'} (HTTP ${chunk.status})`);
      if(!chunk.ok||!sw||!navigator.serviceWorker.controller)return;
      const viaWorker=await fetch(`/protected-media/${lessonId}?token=${encodeURIComponent(stream.token)}&k=${stream.key}&n=${stream.nonce}`,{headers:{Range:'bytes=0-15'},cache:'no-store'});
      const head=new Uint8Array(await viaWorker.arrayBuffer().catch(()=>new ArrayBuffer(0)));
      const mp4=String.fromCharCode(...head.subarray(4,8))==='ftyp';
      add('فك التشفير في المتصفح',viaWorker.status===206&&mp4,viaWorker.status===206?(mp4?'الفيديو بيتفك صح':'البيانات اتفكت بس مش فيديو MP4 سليم'):`المشغل المحمي رد بـ HTTP ${viaWorker.status}`);
      // A chunk past the first: this is the request a CDN that rewrites Range answers with its own 416.
      const middle=Math.floor(total/2),later=await fetch(`/protected-media/${lessonId}?token=${encodeURIComponent(stream.token)}&k=${stream.key}&n=${stream.nonce}`,{headers:{Range:`bytes=${middle}-`},cache:'no-store'});
      await later.arrayBuffer().catch(()=>null);
      add('تحميل نص الفيديو',later.status===206,later.status===206?'الأجزاء التانية بتوصل':`المشغل المحمي رد بـ HTTP ${later.status}`);
    }catch(error){add('الاتصال',false,error instanceof Error?error.message:'خطأ غير معروف');}
    finally{setRunning(false);}
  }
  return <section className="panel video-diagnostics">
    <div className="row between"><h3>فحص تشغيل الفيديو</h3><button type="button" className="secondary" disabled={running} onClick={()=>void run()}>{running?'جارٍ الفحص…':'ابدأ الفحص'}</button></div>
    {checks&&<ol>{checks.map(check=><li key={check.step} className={check.ok?'ok':'fail'}><b>{check.ok?'✓':'✗'} {check.step}</b><span>{check.detail}</span></li>)}</ol>}
    {checks&&!running&&<p className="muted">لو فيه خطوة عليها ✗ صوّر النتيجة دي وابعتها.</p>}
  </section>;
}