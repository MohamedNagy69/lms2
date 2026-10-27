import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, transaction, type Row } from '../db/index.js';
import { authenticated, isTeacher, captureLockMinutes, captureLockRemaining, setCaptureLock } from '../lib/auth.js';
import { ensure, id } from '../lib/errors.js';
import { authorizedLesson, canAccess, courseBySlug, courseSelect } from '../lib/catalog.js';
import { attemptFor, examQuestions, finishAttempt, startExam } from '../services/exams.js';
import { reportFor } from '../services/reports.js';
import { config } from '../config.js';
import {queueResults} from '../services/notifications.js';
import {streamCipherFor,videoFingerprint} from '../lib/video-crypto.js';
export const student = Router();
const enrollmentLimit = rateLimit({windowMs:15*60_000,limit:20,keyGenerator:req=>String(req.user!.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'محاولات تفعيل كثيرة. حاول بعد قليل.'}});
const resultResendLimit = rateLimit({windowMs:15*60_000,limit:3,keyGenerator:req=>String(req.user!.id),standardHeaders:'draft-8',legacyHeaders:false,message:{error:'انتظر قليلًا قبل إعادة إرسال النتيجة.'}});
const answerSchema = z.object({ answers: z.record(z.string().regex(/^\d+$/), z.string().max(20000)).refine(v => Object.keys(v).length <= 500) });

student.get('/lessons/:id', async (req, res) => {
  const { lesson, course } = await authorizedLesson(id(req.params.id), req.user);
  // The Django lesson view records the first visit as completed for students.
  // Keep that behavior so progress and weekly reports do not regress after migration.
  if (req.user && !isTeacher(req.user) && await canAccess(req.user, course)) {
    await db.run('INSERT INTO lesson_progress(student_id,lesson_id,is_completed,completed_at) VALUES (?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE lesson_id=lesson_id', [req.user.id, lesson.id]);
  }
  const attachments = await db.rows('SELECT id,title,kind,url FROM attachments WHERE lesson_id=?', [lesson.id]);
  const siblingLessons = await db.rows('SELECT l.id,l.title FROM lessons l JOIN lectures t ON t.id=l.lecture_id WHERE t.course_id=? ORDER BY t.`order`,t.id,l.`order`,l.id', [course.id]);
  const progress = req.user ? await db.one('SELECT is_completed FROM lesson_progress WHERE student_id=? AND lesson_id=?', [req.user.id, lesson.id]) : null;
  const token = req.user && lesson.video_source === 'file' && lesson.video_file
    ? jwt.sign({ lesson: lesson.id, sid: req.sessionId || 'preview', uid: req.user?.id || null, fp:videoFingerprint(req.get('user-agent')) }, config.secret, { algorithm: 'HS256', audience: 'video', expiresIn: '6h' })
    : null;
  const demoVideo=lesson.video_source==='youtube' && ['aircAruvnKk','kYB8IZa5AuE','9vJRopau0g0','ZM8ECpBuQYE','p7bzE1E5PMY'].includes(String(lesson.youtube_id))
    || lesson.video_source==='drive' && String(lesson.drive_url).includes('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms')
    || lesson.video_source==='file' && /تجريبي/.test(String(lesson.title));
  // Drive lessons are only played after the server has converted them into a protected upload; students never get
  // the Drive link itself (Drive's player streams straight from Google, where download managers grab it).
  const { video_file, video_import_error, ...safe } = lesson;
  if (lesson.video_source === 'drive' && !isTeacher(req.user)) { safe.drive_url = ''; safe.video_preparing = lesson.video_import_status !== 'failed'; }
  // The protected player plays through the page's service worker, which needs this stream's key to decrypt the chunks.
  const cipher = token ? streamCipherFor(token) : null;
  const protectedStream = token && cipher ? { token, key: cipher.key.toString('hex'), nonce: cipher.nonce.toString('hex') } : null;
  res.json({ lesson: {...safe,demo_video:demoVideo}, course: { id: course.id, title: course.title, slug: course.slug, enable_watermark: course.enable_watermark }, attachments, siblingLessons, is_completed: progress?.is_completed || false, protected_stream: protectedStream });
});
// Any capture attempt locks this browser for the timer set in the dashboard. A student is also banned at once (until the teacher
// restores the account) and signed out of every device. A banned student must still be able to report further attempts.
student.post('/security/record-violation', async (req, res) => {
  const { type } = z.object({ type: z.enum(['screenshot','screen_recording','screen_selection','print','devtools','focus_lost']) }).parse(req.body);
  const violationLabel=({screenshot:'محاولة تصوير الشاشة',screen_recording:'محاولة تسجيل الشاشة',screen_selection:'محاولة تحديد أو قص محتوى الفيديو',print:'محاولة طباعة المحتوى',devtools:'محاولة فتح أدوات المطور',focus_lost:'مغادرة نافذة الدرس (محاولة تصوير أو تسجيل الشاشة)'} as const)[type];
  if(isTeacher(req.user)){res.json({status:'ignored'});return;}
  const minutes=await captureLockMinutes(),existing=await captureLockRemaining(req),until=existing?Date.now()+existing*1000:Date.now()+minutes*60_000;
  // Guests watching a free lesson have no account to ban, so only this browser is locked.
  if(!req.user){setCaptureLock(res,0,until);res.json({status:'locked',remaining_seconds:Math.ceil((until-Date.now())/1000),duration_seconds:minutes*60,message:`تم رصد ${violationLabel}. تم قفل المنصة على هذا الجهاز.`});return;}
  const userId=req.user.id;
  const strikes=await transaction(async tx=>{
    const user=(await tx.one('SELECT * FROM users WHERE id=? FOR UPDATE',[userId]))!;
    await tx.run('INSERT INTO security_events(student_id,event_type) VALUES (?,?)', [user.id, type]);
    const strikes=Number(user.screenshot_strikes||0)+1;
    await tx.run('UPDATE users SET screenshot_strikes=?,is_security_banned=1,banned_until=NULL,locked_until=? WHERE id=?',[strikes,new Date(until),user.id]);
    await tx.run('UPDATE student_devices SET is_active=0,session_key=\'\' WHERE student_id=?',[user.id]);
    return strikes;
  });
  setCaptureLock(res,userId,until);
  res.clearCookie('session',{path:'/'});
  res.json({status:'banned',strikes,logout:true,remaining_seconds:Math.ceil((until-Date.now())/1000),duration_seconds:minutes*60,message:`تم رصد ${violationLabel}. تم تسجيل خروجك وإيقاف الحساب، ولن يعمل حتى يعيد المدرس تفعيله.`});
});
student.use(authenticated);
student.get('/dashboard', async (req, res) => {
  const courses = await db.rows(`${courseSelect} JOIN enrollments en ON en.course_id=c.id WHERE en.student_id=? AND en.status='active' AND c.is_published=1 ORDER BY en.created_at DESC`, [req.user!.id]);
  const completed = await db.rows('SELECT t.course_id,COUNT(*) AS n FROM lesson_progress p JOIN lessons l ON l.id=p.lesson_id JOIN lectures t ON t.id=l.lecture_id WHERE p.student_id=? AND p.is_completed=1 GROUP BY t.course_id', [req.user!.id]);
  const results = await db.rows('SELECT a.*,e.title FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 6', [req.user!.id]);
  const announcements = await db.rows('SELECT * FROM announcements WHERE grade_id IS NULL OR grade_id=? ORDER BY is_pinned DESC,created_at DESC LIMIT 15', [req.user!.grade_id]);
  const pending = await db.rows('SELECT en.*,c.title FROM enrollments en JOIN courses c ON c.id=en.course_id WHERE en.student_id=? AND en.status=\'pending\' ORDER BY en.created_at DESC', [req.user!.id]);
  const exams = await db.rows(`SELECT e.id,e.title,e.duration_minutes,e.pass_percent,e.course_id,c.title AS course_title,
    (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS questions_count
    FROM exams e JOIN courses c ON c.id=e.course_id
    WHERE e.is_published=1 AND c.is_published=1 AND EXISTS(SELECT 1 FROM enrollments en WHERE en.course_id=e.course_id AND en.student_id=? AND en.status='active')
    AND (e.allow_retake=1 OR NOT EXISTS(SELECT 1 FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=? AND a.submitted_at IS NOT NULL))
    AND (e.max_attempts=0 OR (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=? AND a.submitted_at IS NOT NULL)<e.max_attempts)
    ORDER BY e.created_at DESC LIMIT 5`, [req.user!.id, req.user!.id, req.user!.id]);
  const submitted = await db.one('SELECT COUNT(*) AS n,COALESCE(AVG(percent),0) AS average FROM exam_attempts WHERE student_id=? AND submitted_at IS NOT NULL', [req.user!.id]);
  res.json({ courses: courses.map(c => ({ ...c, completed: completed.find(p => p.course_id === c.id)?.n || 0 })), results, announcements, pending, exams,
    stats:{courses:courses.length,lessons_done:completed.reduce((n,p)=>n+Number(p.n),0),exams_done:Number(submitted?.n||0),avg:Number(submitted?.average||0)} });
});
student.post('/courses/:slug/enroll', enrollmentLimit, async (req, res) => {
  const course = await courseBySlug(String(req.params.slug), req.user);
  const { code } = z.object({ code: z.string().trim().max(50).default('') }).parse(req.body);
  const status = await transaction(async tx => {
    await tx.one('SELECT id FROM users WHERE id=? FOR UPDATE', [req.user!.id]);
    const currentCourse=await tx.one('SELECT is_free,price,master_access_code,is_published FROM courses WHERE id=? FOR UPDATE',[course.id]);
    ensure(currentCourse&&(currentCourse.is_published||isTeacher(req.user)),404,'الكورس غير موجود');
    const enrollment = await tx.one('SELECT * FROM enrollments WHERE student_id=? AND course_id=?', [req.user!.id, course.id]);
    if (enrollment?.status === 'active') return 'active';
    let active = currentCourse.is_free || Number(currentCourse.price) === 0;
    if (code && !active) {
      if (currentCourse.master_access_code && code === currentCourse.master_access_code) active = true;
      else {
        const access = await tx.one('SELECT * FROM access_codes WHERE code=? FOR UPDATE', [code.toUpperCase()]);
        ensure(access && !access.is_used && (!access.course_id || access.course_id === course.id), 400, 'كود التفعيل غير صالح أو مستخدم');
        await tx.run('UPDATE access_codes SET is_used=1,used_by_id=?,used_at=UTC_TIMESTAMP(3) WHERE id=?', [req.user!.id, access.id]); active = true;
      }
    }
    const status = active ? 'active' : 'pending';
    await tx.run('INSERT INTO enrollments(student_id,course_id,status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status)', [req.user!.id, course.id, status]);
    return status;
  });
  res.json({ status });
});
student.post('/lessons/:id/progress', async (req, res) => {
  const { lesson } = await authorizedLesson(id(req.params.id), req.user);
  const { is_completed } = z.object({ is_completed: z.boolean() }).parse(req.body);
  await db.run('INSERT INTO lesson_progress(student_id,lesson_id,is_completed,completed_at) VALUES (?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE completed_at=IF(VALUES(is_completed)=1 AND is_completed=0,UTC_TIMESTAMP(3),completed_at),is_completed=VALUES(is_completed)', [req.user!.id, lesson.id, is_completed]);
  res.json({ is_completed });
});
student.get('/exams', async (req, res) => {
  res.json(await db.rows(`SELECT e.*,c.title AS course_title,
    (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS questions_count,
    (SELECT COUNT(*) FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=? AND a.submitted_at IS NOT NULL) AS completed_count,
    (SELECT MAX(a.id) FROM exam_attempts a WHERE a.exam_id=e.id AND a.student_id=?) AS last_attempt_id
    FROM exams e JOIN courses c ON c.id=e.course_id WHERE e.is_published=1 AND c.is_published=1 AND
    (c.is_free=1 OR c.price=0 OR ?=1 OR EXISTS(SELECT 1 FROM enrollments en WHERE en.course_id=c.id AND en.student_id=? AND en.status='active')) ORDER BY e.created_at DESC`, [req.user!.id, req.user!.id, isTeacher(req.user), req.user!.id]));
});
student.post('/exams/:id/start', async (req, res) => res.json({ id: await startExam(id(req.params.id), req.user!) }));
student.get('/attempts/:id', async (req, res) => {
  let attempt = await attemptFor(id(req.params.id), req.user!);
  if (!attempt.submitted_at && new Date(attempt.deadline).getTime() < Date.now()) attempt = await finishAttempt(attempt.id, req.user!);
  const questions = await examQuestions(attempt.exam_id);
  const review = Boolean(attempt.submitted_at);
  if (attempt.shuffle_questions) questions.sort((a,b) => createHash('sha256').update(`${attempt.id}:${a.id}`).digest('hex').localeCompare(createHash('sha256').update(`${attempt.id}:${b.id}`).digest('hex')));
  res.json({ attempt, server_time: new Date(), questions: review ? questions : questions.map(({ explanation, ...q }) => ({ ...q, choices: q.choices.map(({ is_correct, ...c }) => c) })),
    answers: review ? await db.rows('SELECT * FROM attempt_answers WHERE attempt_id=?', [attempt.id]) : [] });
});
student.put('/attempts/:id/answers', async (req, res) => {
  const { answers } = answerSchema.parse(req.body);
  await transaction(async tx => {
    const attempt = await attemptFor(id(req.params.id), req.user!, tx, true);
    ensure(!attempt.submitted_at && Date.now() <= new Date(attempt.deadline).getTime(), 409, 'انتهى وقت الامتحان');
    ensure(attempt.student_id === req.user!.id, 403, 'ليس لديك صلاحية');
    await tx.run('UPDATE exam_attempts SET draft_answers=? WHERE id=?', [JSON.stringify(answers), attempt.id]);
  }); res.json({ saved: true });
});
student.post('/attempts/:id/submit', async (req, res) => {
  const { answers } = answerSchema.parse(req.body);
  const attempt = await attemptFor(id(req.params.id), req.user!);
  ensure(attempt.student_id === req.user!.id, 403, 'ليس لديك صلاحية');
  res.json(await finishAttempt(attempt.id, req.user!, answers));
});
student.post('/attempts/:id/violation', async (req, res) => {
  const { type } = z.object({ type: z.enum(['tab_hidden','fullscreen_exit','camera_stopped','camera_covered','multiple_people','camera_absence','multiple_screens']) }).parse(req.body);
  const attemptId = id(req.params.id);
  const attempt = await transaction(async tx => {
    const a = await attemptFor(attemptId, req.user!, tx, true);
    ensure(a.student_id === req.user!.id && !a.submitted_at, 409, 'المحاولة مغلقة');
    await tx.run('INSERT INTO security_events(student_id,attempt_id,event_type) VALUES (?,?,?)', [req.user!.id, a.id, type]);
    await tx.run('UPDATE exam_attempts SET infractions_count=infractions_count+1 WHERE id=?', [a.id]);
    return { ...a, infractions_count: a.infractions_count + 1 } as Row;
  });
  const closed = attempt.max_infractions > 0 && attempt.infractions_count >= attempt.max_infractions;
  if (closed) await finishAttempt(attemptId, req.user!);
  res.json({ count: attempt.infractions_count, closed });
});
student.get('/results', async (req, res) => res.json(await db.rows('SELECT a.*,e.title,c.title AS course_title,e.pass_percent FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id WHERE a.student_id=? AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC', [req.user!.id])));
student.post('/attempts/:id/resend',resultResendLimit,async(req,res)=>{
  const attempt=await attemptFor(id(req.params.id),req.user!);ensure(attempt.submitted_at,409,'الامتحان لم يُسلّم بعد');
  await queueResults(attempt.id,true);
  const jobs=await db.rows('SELECT channel,status FROM notification_jobs WHERE attempt_id=?',[attempt.id]);
  res.json({enabled:process.env.NOTIFICATIONS_ENABLED==='1',jobs});
});
student.get('/my-report', async (req, res) => res.json(await reportFor(req.user!.id, req.query.start as string, req.query.end as string, Number(req.query.course)||null, Number(req.query.offset)||0)));
