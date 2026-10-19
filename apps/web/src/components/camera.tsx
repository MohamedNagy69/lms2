'use client';
import {useEffect,useRef,useState} from 'react';
import type {Row} from '@/lib/client';
let modelPromise:Promise<any>|undefined;
function script(src:string){return new Promise<void>((resolve,reject)=>{const element=document.createElement('script');element.src=src;element.onload=()=>resolve();element.onerror=()=>reject(new Error('تعذر تحميل نموذج مراقبة الكاميرا'));document.head.appendChild(element);});}
async function detector(){
  const browser=window as any;
  if(browser.FaceDetector){const d=new browser.FaceDetector({fastMode:true,maxDetectedFaces:5});return {detect:(v:HTMLVideoElement)=>d.detect(v)};}
  if(!modelPromise)modelPromise=(async()=>{await script('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');await script('https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.1.0/dist/blazeface.min.js');const model=await browser.blazeface.load();return {detect:(v:HTMLVideoElement)=>model.estimateFaces(v,false)};})().catch(e=>{modelPromise=undefined;throw e;});
  return modelPromise;
}
// getUserMedia rejects with English browser messages ("Permission denied", "Requested device not found");
// students get an Arabic explanation of what to do instead. Our own errors are already in Arabic and pass through.
function cameraErrorMessage(error:unknown){
  const name=(error as {name?:string})?.name||'';
  if(name==='NotAllowedError'||name==='SecurityError'||name==='PermissionDeniedError')return 'لم يُسمح بالوصول للكاميرا. اضغط على أيقونة القفل بجانب عنوان الموقع واسمح بالكاميرا، ثم اضغط «إعادة المحاولة».';
  if(name==='NotFoundError'||name==='OverconstrainedError'||name==='DevicesNotFoundError')return 'مفيش كاميرا متوصلة بالجهاز. وصّل كاميرا أو استخدم جهاز فيه كاميرا، ثم اضغط «إعادة المحاولة».';
  if(name==='NotReadableError'||name==='TrackStartError'||name==='AbortError')return 'الكاميرا مستخدمة في برنامج تاني أو مش شغالة. اقفل أي برنامج بيستخدمها (زي زووم) وجرّب تاني.';
  const message=error instanceof Error?error.message:'';
  return /[؀-ۿ]/.test(message)?message:'تعذر تشغيل الكاميرا. جرّب تاني أو استخدم متصفح Chrome أو Edge.';
}
export function Camera({settings,onReady,onViolation}:{settings?:Row;onReady?:(ready:boolean)=>void;onViolation?:(type:string)=>void}){
  const video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null),[error,setError]=useState(''),[status,setStatus]=useState('جاري طلب الكاميرا…'),[retryKey,setRetryKey]=useState(0),callbacks=useRef({onReady,onViolation});
  callbacks.current={onReady,onViolation};
  const ai=Boolean(settings?.ai_multi_person_detection||settings?.ai_absence_and_camera_block),multi=Boolean(settings?.ai_multi_person_detection),absence=Boolean(settings?.ai_absence_and_camera_block);
  useEffect(()=>{let stream:MediaStream|undefined,stopped=false,timer:ReturnType<typeof setInterval>|undefined,permissionTimer:ReturnType<typeof setTimeout>|undefined,permissionExpired=false,busy=false,missing=0,extra=0,covered=0,lastViolation=0;
    const violation=(type:string)=>{if(Date.now()-lastViolation>12000){lastViolation=Date.now();callbacks.current.onViolation?.(type);}};
    async function start(){try{
      setError('');setStatus('جاري طلب الكاميرا…');
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('الكاميرا تحتاج متصفحًا مدعومًا واتصال HTTPS أو localhost');
      permissionTimer=setTimeout(()=>{if(!stopped){permissionExpired=true;setStatus('في انتظار صلاحية الكاميرا…');setError('لم يتم الرد على طلب صلاحية الكاميرا. اسمح بالوصول من إعدادات المتصفح ثم اضغط «إعادة المحاولة».');callbacks.current.onReady?.(false);}},15000);
      stream=await navigator.mediaDevices.getUserMedia({video:{width:320,height:240},audio:false});
      if(permissionTimer)clearTimeout(permissionTimer);
      if(stopped||permissionExpired){stream.getTracks().forEach(t=>t.stop());return;}
      if(video.current){video.current.srcObject=stream;await video.current.play();}
      stream.getVideoTracks().forEach(t=>t.onended=()=>{if(!stopped){callbacks.current.onReady?.(false);setError('توقفت الكاميرا');violation('camera_stopped');}});
      let detection:any;if(ai){setStatus('جاري تجهيز المراقبة…');detection=await detector();}
        if(stopped)return;setStatus('الكاميرا تعمل — المعالجة على جهازك');callbacks.current.onReady?.(true);
      if(detection)timer=setInterval(async()=>{if(busy||!video.current||video.current.readyState<2)return;busy=true;try{const faces=await detection.detect(video.current);missing=faces.length===0?missing+1:0;extra=faces.length>1?extra+1:0;if(absence&&missing>=5){violation('camera_absence');missing=0;}if(multi&&extra>=3){violation('multiple_people');extra=0;}
          const ctx=absence?canvas.current?.getContext('2d',{willReadFrequently:true}):null;if(ctx&&canvas.current){canvas.current.width=48;canvas.current.height=36;ctx.drawImage(video.current,0,0,48,36);const pixels=ctx.getImageData(0,0,48,36).data;const count=pixels.length/4;let lumSum=0,rSum=0,gSum=0,bSum=0,square=0;for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2],lum=0.299*r+0.587*g+0.114*b;lumSum+=lum;rSum+=r;gSum+=g;bSum+=b;square+=lum*lum;}const avgLum=lumSum/count,avgR=rSum/count,avgG=gSum/count,avgB=bSum/count,stdDev=Math.sqrt(Math.max(0,square/count-avgLum*avgLum));const isDark=avgLum<20,isFlat=stdDev<10&&(avgLum<85||avgLum>235),isFingerSkin=avgR>40&&avgR>(avgG+avgB)*1.4&&stdDev<18;covered=(isDark||isFlat||isFingerSkin)?covered+1:0;if(covered>=3){violation('camera_covered');covered=0;}}
        }catch{setError('تعذر فحص الكاميرا. أعد فتحها أو تواصل مع المدرس.');callbacks.current.onReady?.(false);}finally{busy=false;}},500);
    }catch(e){if(permissionTimer)clearTimeout(permissionTimer);if(!stopped){setError(cameraErrorMessage(e));callbacks.current.onReady?.(false);}}}
    void start();return()=>{stopped=true;if(timer)clearInterval(timer);if(permissionTimer)clearTimeout(permissionTimer);stream?.getTracks().forEach(t=>t.stop());};
  },[ai,multi,absence,retryKey]);
  return <div><video className="camera-preview" ref={video} muted playsInline/><canvas ref={canvas} hidden/><small className="muted">{status}</small>{error&&<><p className="notice error">{error}</p><button className="secondary" type="button" onClick={()=>setRetryKey(key=>key+1)}>إعادة المحاولة</button></>}</div>;
}
