import { db, type Database, type Row } from '../db/index.js';
import { ensure } from './errors.js';
import { isTeacher } from './auth.js';
export async function canAccess(user: Row | undefined, course: Row, conn: Database = db) {
  if (isTeacher(user)) return true;
  if(user&&(user.is_security_banned||user.locked_until&&new Date(user.locked_until).getTime()>Date.now()))return false;
  if (!course.is_published) return false;
  if (course.is_free || Number(course.price) === 0) return true;
  return Boolean(user && await conn.one('SELECT id FROM enrollments WHERE student_id=? AND course_id=? AND status=\'active\'', [user.id, course.id]));
}
export async function courseBySlug(slug: string, user?: Row) {
  const course = await db.one(`${courseSelect} WHERE c.slug=?`, [slug]);
  ensure(course && (course.is_published || isTeacher(user)), 404, 'الكورس غير موجود');
  return course;
}
export async function authorizedLesson(lessonId: number, user?: Row) {
  ensure(!user||isTeacher(user)||!user.is_security_banned&&(!user.locked_until||new Date(user.locked_until).getTime()<=Date.now()),403,'الحساب موقوف أو مقفول مؤقتًا');
  const lesson = await db.one('SELECT l.*,t.course_id FROM lessons l JOIN lectures t ON t.id=l.lecture_id WHERE l.id=?', [lessonId]);
  ensure(lesson, 404, 'الدرس غير موجود');
  const course = (await db.one('SELECT * FROM courses WHERE id=?', [lesson.course_id]))!;
  ensure(isTeacher(user) || (course.is_published && (lesson.is_preview || await canAccess(user, course))), 403, 'اشترك في الكورس للوصول لهذا الدرس');
  return { lesson, course };
}
export const courseSelect = `SELECT c.id,c.title,c.slug,c.grade_id,c.summary,c.description,c.price,c.is_free,c.is_published,c.emoji,c.accent,c.\`order\`,c.created_at,g.name AS grade_name,
 (SELECT COUNT(*) FROM lectures t JOIN lessons l ON l.lecture_id=t.id WHERE t.course_id=c.id) AS lessons_count,
 (SELECT COUNT(*) FROM exams e WHERE e.course_id=c.id AND e.is_published=1) AS exams_count,
 (SELECT COUNT(*) FROM enrollments en WHERE en.course_id=c.id AND en.status='active') AS students_count
 FROM courses c JOIN grades g ON g.id=c.grade_id`;
