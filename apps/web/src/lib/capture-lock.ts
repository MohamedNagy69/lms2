// Client side of the capture lock. The server keeps the authoritative timer (the student's account, or a signed
// cookie for guests); localStorage only makes the lock appear instantly and survive a reload while a request is in flight.
const KEY='mudarris-capture-lock',STARTED_KEY='mudarris-capture-lock-started',DURATION_KEY='mudarris-capture-lock-duration';
export const CAPTURE_LOCK_EVENT='mudarris:capture-lock';
const DEFAULT_SECONDS=3600;

// Last duration the teacher configured, as reported by the server. Used for the instant lock and the progress ring.
export function captureLockDuration(){
  try{const seconds=Number(localStorage.getItem(DURATION_KEY));return seconds>0?seconds:DEFAULT_SECONDS;}catch{return DEFAULT_SECONDS;}
}
export function rememberCaptureLockDuration(seconds:number){
  try{if(seconds>0)localStorage.setItem(DURATION_KEY,String(seconds));}catch{}
}
export function storedCaptureLock(){
  try{const until=Number(localStorage.getItem(KEY));return until>Date.now()?until:0;}catch{return 0;}
}
export function captureLockStartedAt(){
  try{return Number(localStorage.getItem(STARTED_KEY))||0;}catch{return 0;}
}
// `exact` replaces the stored end time with the server's; otherwise the later of the two wins.
export function storeCaptureLock(until:number,exact=false){
  const previous=storedCaptureLock(),next=exact?until:Math.max(until,previous);
  try{localStorage.setItem(KEY,String(next));if(!previous)localStorage.setItem(STARTED_KEY,String(Date.now()));}catch{}
  window.dispatchEvent(new CustomEvent(CAPTURE_LOCK_EVENT,{detail:next}));
}
export function clearCaptureLock(){
  try{localStorage.removeItem(KEY);localStorage.removeItem(STARTED_KEY);}catch{}
}
