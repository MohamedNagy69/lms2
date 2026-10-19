import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';
import { db, transaction, type Row } from '../db/index.js';
import { ensure } from './errors.js';

declare global { namespace Express { interface Request { user?: Row; sessionId?: string; } } }
export const publicUser = (user: Row) => {
  const { password, active_session_key, ...safe } = user;
  return { ...safe, display_name: `${user.first_name} ${user.last_name}`.trim() || user.username,
    is_teacher: user.role === 'teacher' || Boolean(user.is_superuser) };
};
export const isTeacher = (user?: Row) => user?.role === 'teacher' || Boolean(user?.is_superuser);
export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (token) {
    let payload: jwt.JwtPayload | undefined;
    try { payload = jwt.verify(token, config.secret, { algorithms: ['HS256'] }) as jwt.JwtPayload; } catch { res.clearCookie('session'); }
    if (payload?.sub && typeof payload.sid === 'string') {
      const user = await db.one('SELECT u.* FROM users u JOIN student_devices d ON d.student_id=u.id WHERE u.id=? AND d.session_key=? AND d.is_active=1 AND u.is_active=1', [payload.sub, payload.sid]);
      if (user) {
        if(user.is_security_banned&&user.banned_until&&new Date(user.banned_until).getTime()<=Date.now()){
          await db.run('UPDATE users SET is_security_banned=0,banned_until=NULL WHERE id=?',[user.id]);user.is_security_banned=0;user.banned_until=null;
        }
        req.user = user; req.sessionId = payload.sid;
      }
    }
  }
  next();
}
export function authenticated(req: Request, _res: Response, next: NextFunction) {
  ensure(req.user, 401, 'سجّل الدخول أولًا');
  if (!isTeacher(req.user)) {
    ensure(!req.user.is_security_banned, 403, 'الحساب موقوف، تواصل مع المدرس');
  }
  next();
}
export function teacherOnly(req: Request, res: Response, next: NextFunction) {
  authenticated(req, res, () => { ensure(isTeacher(req.user), 403, 'هذه الصفحة للمدرس فقط'); next(); });
}
// A capture lock is bound to the browser, so it survives logout and blocks the platform on that device.
// For a student the timer itself lives in users.locked_until, so the teacher can stop it from the dashboard
// (unbanning clears it too). A guest's lock (subject 0) only exists in the cookie and runs its full length.
export const CAPTURE_LOCK_DEFAULT_MINUTES = 60;
export async function captureLockMinutes() {
  const row = await db.one('SELECT value FROM platform_settings WHERE name=\'capture_lock_minutes\'');
  const minutes = Number(row?.value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : CAPTURE_LOCK_DEFAULT_MINUTES;
}
export async function captureLockRemaining(req: Request) {
  const token = req.cookies?.capture_lock;
  if (!token) return 0;
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(token, config.secret, { algorithms: ['HS256'] }) as jwt.JwtPayload; } catch { return 0; }
  if (!payload.sub || payload.sub === '0') {
    // Guests have no account, so the teacher stops their timers all at once: locks issued before the reset no longer count.
    const reset = await db.one('SELECT value FROM platform_settings WHERE name=\'guest_lock_reset_at\'');
    if (reset && Number(payload.iat) * 1000 < Number(reset.value)) return 0;
    return Math.max(0, Math.ceil((Number(payload.until) - Date.now()) / 1000));
  }
  const owner = await db.one('SELECT locked_until FROM users WHERE id=?', [payload.sub]);
  const until = owner?.locked_until ? new Date(owner.locked_until).getTime() : 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
// A student's cookie outlives the timer (24h) so that a timer the teacher extends or re-applies still reaches this device.
export function setCaptureLock(res: Response, userId: number, until: number) {
  const ms = userId ? 86400_000 : Math.max(1000, until - Date.now());
  res.cookie('capture_lock', jwt.sign({ until }, config.secret, { algorithm: 'HS256', subject: String(userId), expiresIn: Math.ceil(ms / 1000) }),
    { httpOnly: true, secure: config.production, sameSite: 'lax', path: '/', maxAge: ms });
}
export async function createSession(req: Request, res: Response, user: Row) {
  const sessionId = randomBytes(20).toString('hex');
  const deviceId = /^[a-f0-9]{32}$/.test(req.cookies?.device || '') ? req.cookies.device : randomBytes(16).toString('hex');
  await transaction(async tx => {
    const current=await tx.one('SELECT * FROM users WHERE id=? FOR UPDATE', [user.id]);
    ensure(current&&current.password===user.password,401,'تغيّرت بيانات الحساب، سجّل الدخول مرة أخرى');
    ensure(current.is_active&&!current.is_security_banned,403,'الحساب موقوف');
    await tx.run(`INSERT INTO student_devices(student_id,device_id,device_name,ip_address,user_agent,session_key)
      VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE session_key=VALUES(session_key),is_active=1,last_login=UTC_TIMESTAMP(3),ip_address=VALUES(ip_address)`,
      [user.id, deviceId, (req.headers['user-agent'] || 'Browser').slice(0, 150), req.ip || '', req.headers['user-agent'] || '', sessionId]);
    const devices = await tx.rows('SELECT id FROM student_devices WHERE student_id=? AND is_active=1 ORDER BY last_login DESC,id DESC', [user.id]);
    for (const old of devices.slice(isTeacher(user) ? 10 : 2)) await tx.run('UPDATE student_devices SET is_active=0,session_key=\'\' WHERE id=?', [old.id]);
    await tx.run('UPDATE users SET last_login=UTC_TIMESTAMP(3) WHERE id=?', [user.id]);
  });
  const cookie = { httpOnly: true, secure: config.production, sameSite: 'lax' as const, path: '/' };
  res.cookie('device', deviceId, { ...cookie, maxAge: 365 * 86400000 });
  res.cookie('session', jwt.sign({ sid: sessionId }, config.secret, { algorithm: 'HS256', subject: String(user.id), expiresIn: '7d' }), { ...cookie, maxAge: 7 * 86400000 });
}
