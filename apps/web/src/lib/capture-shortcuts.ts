export type CaptureViolation='screenshot'|'screen_recording';

// Browsers only expose shortcuts delivered to the page. OS tools may consume them first.
export function captureShortcut(event:KeyboardEvent):CaptureViolation|null{
  const key=event.key.toLowerCase(),code=event.code.toLowerCase();
  const platform=String((navigator as Navigator&{userAgentData?:{platform?:string}}).userAgentData?.platform||navigator.platform||navigator.userAgent);
  const windows=/win/i.test(platform),meta=event.metaKey||event.getModifierState?.('Meta')||event.getModifierState?.('OS');
  if(key==='printscreen'||key==='snapshot'||key==='prtsc'||key==='prtscn'||code==='printscreen'||event.keyCode===44)return 'screenshot';
  if(windows&&meta&&event.shiftKey&&(key==='s'||code==='keys'))return 'screenshot';
  if(!windows&&meta&&event.shiftKey&&['3','4'].includes(key))return 'screenshot';
  if(windows&&meta&&event.altKey&&(key==='r'||code==='keyr'))return 'screen_recording';
  if(windows&&meta&&(key==='g'||code==='keyg'))return 'screen_recording';
  if(!windows&&meta&&event.shiftKey&&key==='5')return 'screen_recording';
  return null;
}
