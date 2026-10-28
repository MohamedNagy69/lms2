import { Router } from 'express';
import { z } from 'zod';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { canAccess, courseBySlug, courseSelect } from '../lib/catalog.js';
import { reportFor } from '../services/reports.js';
import { ensure } from '../lib/errors.js';
export const publicRoutes = Router();
publicRoutes.get('/home', async (req, res) => {
  const [courses, announcements, testimonials, stats] = await Promise.all([
    db.rows(`${courseSelect} WHERE c.is_published=1 ORDER BY c.\`order\`,c.id DESC LIMIT 6`),
    db.rows('SELECT * FROM announcements WHERE grade_id IS NULL OR grade_id=? ORDER BY is_pinned DESC,created_at DESC LIMIT 6', [req.user?.grade_id || null]),
    db.rows('SELECT * FROM testimonials WHERE is_visible=1 LIMIT 12'),
    db.one(`SELECT (SELECT COUNT(*) FROM users WHERE role='student') AS students,
      (SELECT COUNT(*) FROM courses WHERE is_published=1) AS courses,
      (SELECT COUNT(*) FROM lessons l JOIN lectures t ON t.id=l.lecture_id JOIN courses c ON c.id=t.course_id WHERE c.is_published=1) AS lessons`),
  ]);
  res.json({ site: config.site, courses, announcements, testimonials, stats });
});
publicRoutes.get('/grades', async (_req, res) => res.json(await db.rows('SELECT * FROM grades WHERE is_active=1 ORDER BY `order`,name')));
publicRoutes.get('/courses', async (req, res) => {
  const q = String(req.query.q || '').slice(0, 150); const grade = Number(req.query.grade) || null;
  res.json(await db.rows(`${courseSelect} WHERE c.is_published=1 AND (? IS NULL OR c.grade_id=?) AND (c.title LIKE ? OR c.summary LIKE ?) ORDER BY c.\`order\`,c.id DESC`, [grade, grade, `%${q}%`, `%${q}%`]));
});
publicRoutes.get('/courses/:slug', async (req, res) => {
  const course = await courseBySlug(String(req.params.slug), req.user);
  const allowed = await canAccess(req.user, course);
  const lectures = await db.rows('SELECT * FROM lectures WHERE course_id=? ORDER BY `order`,id', [course.id]);
  const lessons = await db.rows(`SELECT l.id,l.lecture_id,l.title,l.description,l.duration_minutes,l.is_preview,l.\`order\`,
    COALESCE(p.is_completed,0) AS is_completed FROM lessons l JOIN lectures t ON t.id=l.lecture_id
    LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.student_id=? WHERE t.course_id=? ORDER BY t.\`order\`,l.\`order\`,l.id`, [req.user?.id || 0, course.id]);
  const exams = allowed ? await db.rows('SELECT e.id,e.title,e.duration_minutes,e.lesson_id,(SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS questions_count FROM exams e WHERE e.course_id=? AND e.is_published=1', [course.id]) : [];
  const enrollment = req.user ? await db.one('SELECT * FROM enrollments WHERE student_id=? AND course_id=?', [req.user.id, course.id]) : null;
  const { master_access_code, ...safe } = course;
  res.json({ course: safe, lectures: lectures.map(l => ({ ...l, lessons: lessons.filter(s => s.lecture_id === l.id) })), exams, allowed, enrollment });
});
// Keyed by phone as well as address: behind Hostinger's CDN visitors can share one edge address.
publicRoutes.post('/contact', rateLimit({ windowMs: 3600000, limit: 10, keyGenerator: req => `${ipKeyGenerator(req.ip || '')}|${String(req.body?.phone || '').trim().slice(0, 20)}`, message: { error: 'حاول مرة أخرى لاحقًا' } }), async (req, res) => {
  const data = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(8).max(20), message: z.string().trim().min(5).max(5000) }).parse(req.body);
  await db.run('INSERT INTO contact_messages SET ?', [data]); res.status(201).json({ message: 'تم إرسال رسالتك بنجاح' });
});
publicRoutes.get('/report/parent/:token', async (req, res) => {
  ensure(/^[A-Za-z0-9_-]{32,64}$/.test(String(req.params.token)), 404, 'الرابط غير موجود');
  const report = await db.one('SELECT * FROM parent_report_views WHERE token=?', [req.params.token]);
  ensure(report, 404, 'الرابط غير موجود');
  await db.run('UPDATE parent_report_views SET is_viewed=1,first_viewed_at=COALESCE(first_viewed_at,UTC_TIMESTAMP(3)),last_viewed_at=UTC_TIMESTAMP(3),view_count=view_count+1 WHERE id=?', [report.id]);
  res.json(await reportFor(report.student_id, report.week_start, report.week_end, report.course_id));
});
