import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db,transaction } from '../db/index.js';
import { config } from '../config.js';
import { authenticated, captureLockMinutes, captureLockRemaining, createSession, publicUser } from '../lib/auth.js';
import { ensure } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

export const auth = Router();
const limit = rateLimit({ windowMs: 15 * 60_000, limit: 30, message: { error: 'محاولات كثيرة. حاول بعد قليل.' }, standardHeaders: 'draft-8', legacyHeaders: false });
const text = (max: number) => z.string().trim().max(max).default('');
const profile = z.object({ first_name: text(150), last_name: text(150), email: z.union([z.email(), z.literal('')]).default(''),
  phone: text(20), parent_phone: text(20), mother_phone: text(20), father_email: text(254), mother_email: text(254),
  city: text(60), bio: text(2000), grade_id: z.number().int().positive().nullable().default(null) });
auth.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
auth.get('/security-lock', async (req, res) => {
  const remaining = await captureLockRemaining(req);
  if (!remaining && req.cookies?.capture_lock) res.clearCookie('capture_lock', { path: '/' });
  res.json({ remaining_seconds: remaining, duration_seconds: (await captureLockMinutes()) * 60 });
});
auth.get('/devices', authenticated, async (req, res) => {
  res.json(await db.rows('SELECT id,device_name,ip_address,last_login,is_active FROM student_devices WHERE student_id=? ORDER BY is_active DESC,last_login DESC', [req.user!.id]));
});
auth.get('/telegram-links', authenticated, limit, async (req, res) => {
  ensure(req.user!.role === 'student', 403, 'روابط الربط للطلاب فقط');
  const bot = config.site.telegram_bot_username.replace(/^@/, '');
  ensure(/^[A-Za-z0-9_]{5,32}$/.test(bot), 503, 'ربط تيليجرام غير متاح حاليًا');
  await db.run('DELETE FROM telegram_link_tokens WHERE expires_at<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)');
  const links: Record<string, string> = {};
  for (const role of ['father', 'mother', 'student'] as const) {
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    await db.run('INSERT INTO telegram_link_tokens(token_hash,student_id,recipient_role,expires_at) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))', [hash, req.user!.id, role]);
    links[role] = `https://t.me/${bot}?start=${role}_${token}`;
  }
  res.json({ links, expires_in_seconds: 900 });
});
auth.post('/login', limit, async (req, res) => {
  const data = z.object({ username: z.string().min(1).max(150), password: z.string().min(1).max(200) }).parse(req.body);
  ensure(!await captureLockRemaining(req), 423, 'هذا الجهاز مقفول بسبب محاولة تصوير أو تسجيل الشاشة. انتظر انتهاء العداد.');
  const users = await db.rows('SELECT * FROM users WHERE username=? OR (phone=? AND phone<>\'\') ORDER BY (username=?) DESC LIMIT 2', [data.username, data.username, data.username]);
  const user = users[0];
  ensure(user && await verifyPassword(data.password, user.password), 401, 'بيانات الدخول غير صحيحة');
  ensure(user.username===data.username||users.length===1,401,'استخدم اسم المستخدم لتحديد الحساب');
  if(user.is_security_banned&&user.banned_until&&new Date(user.banned_until).getTime()<=Date.now()){
    await db.run('UPDATE users SET is_security_banned=0,banned_until=NULL WHERE id=?',[user.id]);user.is_security_banned=0;
  }
  ensure(user.is_active && !user.is_security_banned, 403, 'الحساب موقوف');
  if (!user.password.startsWith('$2')) {
    const upgraded=await hashPassword(data.password);
    const changed=await db.run('UPDATE users SET password=? WHERE id=? AND password=?',[upgraded,user.id,user.password]);
    ensure(changed.affectedRows===1,401,'تغيّرت بيانات الحساب، سجّل الدخول مرة أخرى');
    user.password=upgraded;
  }
  await createSession(req, res, user); res.json({ user: publicUser(user) });
});
auth.post('/register', limit, async (req, res) => {
  const data = profile.extend({ username: z.string().trim().min(3).max(150).regex(/^[\p{L}\p{N}_.@+-]+$/u), password: z.string().min(8).max(200), first_name: z.string().trim().min(1).max(150), phone: z.string().trim().min(8).max(20) }).parse(req.body);
  const { password, ...fields } = data;
  ensure(!await captureLockRemaining(req), 423, 'هذا الجهاز مقفول بسبب محاولة تصوير أو تسجيل الشاشة. انتظر انتهاء العداد.');
  ensure(!await db.one('SELECT id FROM users WHERE username=? OR phone=?', [data.username, data.phone]), 409, 'اسم المستخدم أو الهاتف مستخدم بالفعل');
  const result = await db.run('INSERT INTO users SET ?', [{ ...fields, password: await hashPassword(password) }]);
  const user = (await db.one('SELECT * FROM users WHERE id=?', [result.insertId]))!;
  await createSession(req, res, user); res.status(201).json({ user: publicUser(user) });
});
auth.post('/logout', async (req, res) => {
  if (req.sessionId) await db.run('UPDATE student_devices SET is_active=0,session_key=\'\' WHERE session_key=?', [req.sessionId]);
  res.clearCookie('session', { path: '/' }); res.json({ ok: true });
});
auth.post('/password-reset', limit, async (req,res) => {
  // The student identifies the account by the phone number or the email saved on it. A request is only opened when
  // exactly one student matches; the teacher still verifies the student before changing the password.
  const {contact}=z.object({contact:z.string().trim().min(3).max(254)}).parse(req.body);
  let matches:{id:number}[]=[];
  if(contact.includes('@')){
    matches=await db.rows('SELECT id FROM users WHERE role=\'student\' AND email<>\'\' AND LOWER(email)=LOWER(?) LIMIT 2',[contact]) as {id:number}[];
  }else{
    // Compare digits only, so 0100…, +20 100… and spaced numbers all match; the last 9 digits identify an Egyptian mobile.
    const digits=contact.replace(/\D/g,'');
    if(digits.length>=9)matches=await db.rows('SELECT id FROM users WHERE role=\'student\' AND phone<>\'\' AND RIGHT(REGEXP_REPLACE(phone,\'[^0-9]\',\'\'),9)=? LIMIT 2',[digits.slice(-9)]) as {id:number}[];
  }
  const user=matches.length===1?matches[0]:null;
  if(user){
    await transaction(async tx=>{
      const current=await tx.one('SELECT id FROM users WHERE id=? AND role=\'student\' FOR UPDATE',[user.id]);
      if(!current)return;
      const pending=await tx.one('SELECT id FROM password_reset_requests WHERE student_id=? AND resolved_at IS NULL LIMIT 1',[user.id]);
      if(!pending)await tx.run('INSERT INTO password_reset_requests(student_id) VALUES (?)',[user.id]);
    });
  }
  res.json({ok:true,message:'إذا تطابقت البيانات، سيظهر طلب الاستعادة للمدرس لمراجعة الحساب.'});
});
auth.patch('/profile', authenticated, async (req, res) => {
  const parsed = profile.partial().parse(req.body);
  const data = Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.hasOwn(req.body,key))) as z.infer<typeof profile>;
  ensure(Object.keys(data).length, 400, 'لا توجد تغييرات');
  if (data.phone) ensure(!await db.one('SELECT id FROM users WHERE phone=? AND id<>?', [data.phone, req.user!.id]), 409, 'رقم الهاتف مستخدم');
  await db.run('UPDATE users SET ? WHERE id=?', [data, req.user!.id]);
  res.json({ user: publicUser((await db.one('SELECT * FROM users WHERE id=?', [req.user!.id]))!) });
});
auth.post('/password', authenticated, limit, async (req, res) => {
  const data = z.object({ current_password: z.string().max(200), password: z.string().min(8).max(200) }).parse(req.body);
  ensure(await verifyPassword(data.current_password, req.user!.password), 400, 'كلمة المرور الحالية غير صحيحة');
  const newHash=await hashPassword(data.password);
  await transaction(async tx=>{
    const current=await tx.one('SELECT password FROM users WHERE id=? FOR UPDATE',[req.user!.id]);
    ensure(current&&current.password===req.user!.password,409,'تغيّرت كلمة المرور، أعد تسجيل الدخول');
    await tx.run('UPDATE users SET password=? WHERE id=?',[newHash,req.user!.id]);
    await tx.run('UPDATE student_devices SET is_active=0,session_key=\'\' WHERE student_id=? AND session_key<>?',[req.user!.id,req.sessionId]);
  });
  res.json({ ok: true });
});
