import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db, transaction, type Database } from '../db/index.js';
import { teacherOnly, publicUser, captureLockMinutes } from '../lib/auth.js';
import { googleDriveUrl, youtubeVideoId } from '../lib/video-links.js';
import { queueDriveImport } from '../lib/drive-import.js';
import { ensure, id } from '../lib/errors.js';
import { resources, resourceSchema } from '../lib/resources.js';
import { hashPassword } from '../lib/password.js';
import { reportFor } from '../services/reports.js';
import { codesWorkbook } from '../services/excel.js';
import { config } from '../config.js';
export const teacher = Router();
teacher.use(teacherOnly);
teacher.get('/dashboard', async (_req, res) => {
  const stats = await db.one(`SELECT (SELECT COUNT(*) FROM users WHERE role='student') AS students,
    (SELECT COUNT(*) FROM users WHERE role='student' AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 7 DAY)) AS new_students,
    (SELECT COUNT(*) FROM courses) AS courses,(SELECT COUNT(*) FROM lessons) AS lessons,
    (SELECT COUNT(*) FROM exams) AS exams,
    (SELECT COUNT(*) FROM exam_attempts a JOIN users u ON u.id=a.student_id WHERE u.role='student' AND a.submitted_at IS NOT NULL) AS attempts,
    (SELECT COALESCE(AVG(a.percent),0) FROM exam_attempts a JOIN users u ON u.id=a.student_id WHERE u.role='student' AND a.submitted_at IS NOT NULL) AS average`);
  const pending = await db.rows(`SELECT en.*,u.first_name,u.last_name,u.username,c.title FROM enrollments en JOIN users u ON u.id=en.student_id JOIN courses c ON c.id=en.course_id WHERE en.status='pending' ORDER BY en.created_at DESC LIMIT 100`);
  const popularity = await db.rows(`SELECT c.id,c.title,COUNT(en.id) AS students FROM courses c LEFT JOIN enrollments en ON en.course_id=c.id AND en.status='active' GROUP BY c.id ORDER BY students DESC LIMIT 10`);
  const latest_students = await db.rows(`SELECT u.id,u.username,u.first_name,u.last_name,u.phone,g.name AS grade_name,u.created_at FROM users u LEFT JOIN grades g ON g.id=u.grade_id WHERE u.role='student' ORDER BY u.created_at DESC LIMIT 6`);
  const latest_attempts = await db.rows(`SELECT a.id,a.student_id,a.percent,a.submitted_at,e.title,u.username,u.first_name,u.last_name,u.parent_phone,u.mother_phone,e.pass_percent FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.student_id WHERE u.role='student' AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 8`);
  const resets = await db.rows('SELECT r.*,u.username,u.first_name,u.phone FROM password_reset_requests r JOIN users u ON u.id=r.student_id WHERE resolved_at IS NULL ORDER BY r.id DESC');
  res.json({ stats, pending, popularity, latest_students, latest_attempts, resets });
});
teacher.get('/resources', async (_req,res) => res.json(resources));
teacher.get('/references', async (_req,res) => {
  const result: Record<string,unknown> = {};
  for (const name of ['grades','courses','lectures','lessons','exams','questions']) {
    const label = name === 'grades' ? 'name' : name === 'questions' ? 'text' : 'title';
    result[name] = await db.rows(`SELECT id,LEFT(\`${label}\`,100) AS label FROM \`${name}\` ORDER BY id DESC LIMIT 5000`);
  }
  result.users = await db.rows(`SELECT id,CONCAT(first_name,' ',last_name,' (',username,')') AS label FROM users WHERE role='student' ORDER BY id DESC LIMIT 5000`);
  res.json(result);
});
teacher.get('/resources/:resource', async (req,res) => {
  const resource = resources[String(req.params.resource)]; ensure(resource,404,'القسم غير موجود');
  const filters: string[] = [], values: unknown[] = [];
  for(const field of resource.fields.filter(f => f.type === 'reference')) {
    if(req.query[field.key]) { filters.push(`\`${field.key}\`=?`); values.push(id(req.query[field.key])); }
  }
  const searchField = resource.fields.find(f => ['title','name','text','student_name'].includes(f.key));
  if (req.query.q && searchField) { filters.push(`\`${searchField.key}\` LIKE ?`); values.push(`%${String(req.query.q).slice(0,150)}%`); }
  const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const resourceName = String(req.params.resource);
  const select = resourceName === 'exams' ? 'e.*,(SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) AS questions_count' : '*';
  const from = resourceName === 'exams' ? '`exams` e' : `\`${resource.table}\``;
  const items = await db.rows(`SELECT ${select} FROM ${from}${where} ORDER BY id DESC LIMIT 100 OFFSET ?`, [...values, (page-1)*100]);
  const total = (await db.one(`SELECT COUNT(*) AS n FROM \`${resource.table}\`${where}`, values))!.n;
  res.json({ items, total, page });
});
teacher.get('/resources/:resource/:id', async (req,res) => {
  const resource = resources[String(req.params.resource)]; ensure(resource,404,'القسم غير موجود');
  const row = await db.one(`SELECT * FROM \`${resource.table}\` WHERE id=?`, [id(req.params.id)]); ensure(row,404,'غير موجود'); res.json(row);
});
async function guardAssessment(resource: string, rowId?: number, data?: any) {
  let examId = resource === 'exams' ? rowId : undefined;
  if (resource === 'questions') examId = data?.exam_id || (await db.one('SELECT exam_id FROM questions WHERE id=?',[rowId]))?.exam_id;
  if (resource === 'choices') {
    const questionId = data?.question_id || (await db.one('SELECT question_id FROM choices WHERE id=?',[rowId]))?.question_id;
    examId = (await db.one('SELECT exam_id FROM questions WHERE id=?',[questionId]))?.exam_id;
  }
  if (examId && ['questions','choices'].includes(resource)) ensure(!await db.one('SELECT id FROM exam_attempts WHERE exam_id=? LIMIT 1',[examId]),409,'هذا الامتحان له محاولات محفوظة. أنشئ امتحانًا جديدًا لتغيير الأسئلة.');
  if (resource === 'exams' && rowId && data) {
    const current = await db.one('SELECT * FROM exams WHERE id=?',[rowId]);
    if(current && (data.duration_minutes !== undefined && data.duration_minutes !== current.duration_minutes || data.course_id !== undefined && data.course_id !== current.course_id || data.pass_percent !== undefined && data.pass_percent !== current.pass_percent)) ensure(!await db.one('SELECT id FROM exam_attempts WHERE exam_id=? LIMIT 1',[rowId]),409,'لا يمكن تغيير مدة أو كورس أو نسبة نجاح امتحان له محاولات');
  }
}
async function validateRelations(resource: string,data: any,current?: any) {
  if(resource === 'exams' && data.lesson_id) {
    const lesson = await db.one('SELECT t.course_id FROM lessons l JOIN lectures t ON t.id=l.lecture_id WHERE l.id=?',[data.lesson_id]);
    ensure(lesson?.course_id === data.course_id,400,'الدرس لا ينتمي للكورس');
  }
  if(resource === 'attachments') {
    if(data.kind === 'file') ensure(typeof data.file === 'string' && data.file.length > 0,400,'اختر ملفًا للمرفق');
    if(data.kind === 'link') ensure(typeof data.url === 'string' && /^https?:\/\//i.test(data.url),400,'اكتب رابطًا صحيحًا للمرفق');
  }
  if(resource === 'lessons') {
    if(data.video_source === 'youtube') ensure(typeof data.youtube_id === 'string' && data.youtube_id.trim().length > 0,400,'اكتب رابط أو كود فيديو يوتيوب');
    if(data.video_source === 'drive') ensure(typeof data.drive_url === 'string' && data.drive_url.trim().length > 0,400,'اكتب رابط أو كود ملف جوجل درايف');
    // A lesson that never had a file (seeded or a draft) can still be edited; removing an existing file needs a replacement.
    if(data.video_source === 'file' && (!current || current.video_file)) ensure(typeof data.video_file === 'string' && data.video_file.trim().length > 0,400,'اختر ملف الفيديو');
  }
}
// A link pasted into a lesson that is set to "file" but has no file means the teacher wants that link used.
function inferLessonSource(data: any, current: any) {
  const merged = {...current,...data};
  if (merged.video_source !== 'file' || String(merged.video_file || '').trim()) return;
  if (String(merged.drive_url || '').trim()) data.video_source = 'drive';
  else if (String(merged.youtube_id || '').trim()) data.video_source = 'youtube';
}
// Lessons: turn whatever was pasted (share link, embed code…) into one canonical value before saving.
// A value that cannot be understood is only an error for the source the lesson actually uses; for an unused
// source it is kept if it fits its column (youtube_id 150, drive_url 255) and dropped otherwise, since input
// may now be a long embed code.
function normalizeLessonVideo(data: any, source: string | undefined) {
  if (typeof data.youtube_id === 'string' && data.youtube_id.trim()) {
    const videoId = youtubeVideoId(data.youtube_id);
    if (videoId) data.youtube_id = videoId;
    else { ensure(source !== 'youtube', 400, 'رابط يوتيوب مش مفهوم. الصق رابط الفيديو أو كود التضمين (Embed) بتاعه.'); if (data.youtube_id.length > 150) data.youtube_id = ''; }
  }
  if (typeof data.drive_url === 'string' && data.drive_url.trim()) {
    const url = googleDriveUrl(data.drive_url);
    if (url) data.drive_url = url;
    else { ensure(source !== 'drive', 400, 'رابط جوجل درايف مش مفهوم. الصق رابط المشاركة أو كود التضمين (Embed) بتاع الملف.'); if (data.drive_url.length > 255) data.drive_url = ''; }
  }
}
async function removeUpload(relative: unknown) {
  if(typeof relative !== 'string' || !relative) return;
  const stillUsed=await db.one(`SELECT id FROM attachments WHERE file=? UNION ALL
    SELECT id FROM lessons WHERE video_file=? UNION ALL
    SELECT id FROM questions WHERE image=? LIMIT 1`, [relative,relative,relative]);
  if(stillUsed)return;
  const root = path.resolve(config.uploads), absolute = path.resolve(root, relative);
  if(!absolute.startsWith(root + path.sep)) return;
  await fs.unlink(absolute).catch(() => undefined);
}
teacher.post('/resources/:resource', async(req,res) => {
  const name = String(req.params.resource), resource = resources[name]; ensure(resource,404,'القسم غير موجود');
  const data = resourceSchema(name).parse(req.body);
  if (resource.fields.some(f => f.key === 'slug') && !data.slug) data.slug = `${String(data.title || data.name).trim().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,65)}-${randomBytes(3).toString('hex')}`;
  if (name === 'lessons') normalizeLessonVideo(data, String(data.video_source ?? ''));
  await guardAssessment(name,undefined,data); await validateRelations(name,data);
  const result = await db.run(`INSERT INTO \`${resource.table}\` SET ?`,[data]);
  if (name === 'lessons' && data.video_source === 'drive') await queueDriveImport(result.insertId);
  res.status(201).json({ id: result.insertId });
});
teacher.patch('/resources/:resource/:id', async(req,res) => {
  const name = String(req.params.resource), resource = resources[name]; ensure(resource,404,'القسم غير موجود');
  const rowId=id(req.params.id), parsed=resourceSchema(name,true).parse(req.body);
  const data=Object.fromEntries(Object.entries(parsed).filter(([key])=>Object.hasOwn(req.body,key))); ensure(Object.keys(data).length,400,'لا توجد تغييرات');
  const current=await db.one(`SELECT * FROM \`${resource.table}\` WHERE id=?`,[rowId]); ensure(current,404,'غير موجود');
  if (name === 'lessons') { inferLessonSource(data, current); normalizeLessonVideo(data, (data as any).video_source ?? current.video_source); }
  await guardAssessment(name,rowId); await guardAssessment(name,rowId,data); await validateRelations(name,{...current,...data},current);
  await db.run(`UPDATE \`${resource.table}\` SET ? WHERE id=?`,[data,rowId]);
  // Re-convert when a lesson switches to Drive or gets a new Drive link (or the teacher saves again after a failure).
  if (name === 'lessons' && ((data as any).video_source !== undefined || (data as any).drive_url !== undefined)) {
    const saved = await db.one('SELECT video_source FROM lessons WHERE id=?',[rowId]);
    if (saved?.video_source === 'drive') await queueDriveImport(rowId);
  }
  res.json({id:rowId});
});
// Cascading delete. Everything under the chosen rows (lectures → lessons → attachments, exams → questions → choices,
// a course's codes, students' lesson progress…) is collected first so the teacher sees exactly what goes. Student data
// (exam results, enrollments) comes back as "blockers": the delete is refused unless the request sets force, which the
// dashboard only sends after the teacher explicitly confirms wiping that data too.
const CASCADE_TABLES = ['grades', 'courses', 'lectures', 'lessons', 'attachments', 'exams', 'questions', 'choices'] as const;
type CascadeTable = typeof CASCADE_TABLES[number];
type DeletePlan = { ids: Record<CascadeTable, number[]>; counts: Record<string, number>; blockers: string[]; files: string[] };
const DELETE_SCHEMA = z.object({ resource: z.string().max(40), ids: z.array(z.number().int().positive()).min(1).max(500), force: z.boolean().optional() }).strict();
async function planDelete(conn: Database, name: string, rootIds: number[]): Promise<DeletePlan> {
  const resource = Object.hasOwn(resources, name) ? resources[name] : undefined; ensure(resource, 404, 'القسم غير موجود');
  const unique = [...new Set(rootIds)];
  const found = (await conn.rows(`SELECT id FROM \`${resource.table}\` WHERE id IN (?)`, [unique])).map(row => Number(row.id));
  ensure(found.length === unique.length, 404, 'بعض العناصر المحددة مش موجودة. حدّث الصفحة وجرّب تاني.');
  const pick = async (sql: string, parents: number[]) => parents.length ? (await conn.rows(sql, [parents])).map(row => Number(row.id)) : [];
  const merge = (...lists: number[][]) => [...new Set(lists.flat())];
  const ids = Object.fromEntries(CASCADE_TABLES.map(table => [table, [] as number[]])) as Record<CascadeTable, number[]>;
  const cascading = (CASCADE_TABLES as readonly string[]).includes(name);
  if (cascading) ids[name as CascadeTable] = found;
  if (name === 'grades') ids.courses = await pick('SELECT id FROM courses WHERE grade_id IN (?)', ids.grades);
  if (['grades', 'courses'].includes(name)) ids.lectures = await pick('SELECT id FROM lectures WHERE course_id IN (?)', ids.courses);
  if (['grades', 'courses', 'lectures'].includes(name)) ids.lessons = await pick('SELECT id FROM lessons WHERE lecture_id IN (?)', ids.lectures);
  if (['grades', 'courses', 'lectures', 'lessons'].includes(name)) {
    ids.attachments = await pick('SELECT id FROM attachments WHERE lesson_id IN (?)', ids.lessons);
    ids.exams = merge(await pick('SELECT id FROM exams WHERE course_id IN (?)', ids.courses), await pick('SELECT id FROM exams WHERE lesson_id IN (?)', ids.lessons));
  }
  if (name !== 'questions' && name !== 'choices') ids.questions = await pick('SELECT id FROM questions WHERE exam_id IN (?)', ids.exams);
  if (name !== 'choices') ids.choices = await pick('SELECT id FROM choices WHERE question_id IN (?)', ids.questions);

  const count = async (sql: string, parents: number[]) => parents.length ? Number((await conn.one(sql, [parents]))!.n) : 0;
  const counts: Record<string, number> = {};
  for (const [table, list] of Object.entries(ids)) if (list.length) counts[table] = list.length;
  if (!cascading) counts[name] = found.length;
  counts.announcements = await count('SELECT COUNT(*) AS n FROM announcements WHERE grade_id IN (?)', ids.grades);
  counts.access_codes = await count('SELECT COUNT(*) AS n FROM access_codes WHERE course_id IN (?)', ids.courses);
  counts.lesson_progress = await count('SELECT COUNT(*) AS n FROM lesson_progress WHERE lesson_id IN (?)', ids.lessons);
  counts.exam_attempts = await count('SELECT COUNT(*) AS n FROM exam_attempts WHERE exam_id IN (?)', ids.exams);
  counts.enrollments = await count('SELECT COUNT(*) AS n FROM enrollments WHERE course_id IN (?)', ids.courses);
  counts.students_unassigned = await count("SELECT COUNT(*) AS n FROM users WHERE role='student' AND grade_id IN (?)", ids.grades);
  for (const key of Object.keys(counts)) if (!counts[key]) delete counts[key];

  const blockers: string[] = [];
  const examsWithResults = ids.exams.length ? await conn.rows('SELECT e.title,COUNT(a.id) AS n FROM exams e JOIN exam_attempts a ON a.exam_id=e.id WHERE e.id IN (?) GROUP BY e.id', [ids.exams]) : [];
  for (const exam of examsWithResults) blockers.push(`امتحان «${exam.title}» عليه ${exam.n} نتيجة طلاب محفوظة`);
  if (name === 'questions' || name === 'choices') {
    const questionIds = name === 'questions' ? ids.questions : merge(await pick('SELECT question_id AS id FROM choices WHERE id IN (?)', ids.choices));
    const locked = questionIds.length ? await conn.rows('SELECT DISTINCT e.title FROM questions q JOIN exams e ON e.id=q.exam_id JOIN exam_attempts a ON a.exam_id=e.id WHERE q.id IN (?)', [questionIds]) : [];
    for (const exam of locked) blockers.push(`امتحان «${exam.title}» عليه نتائج طلاب: إجاباتهم على الأسئلة دي هتتمسح`);
  }
  const enrolled = ids.courses.length ? await conn.rows('SELECT c.title,COUNT(en.id) AS n FROM courses c JOIN enrollments en ON en.course_id=c.id WHERE c.id IN (?) GROUP BY c.id', [ids.courses]) : [];
  for (const course of enrolled) blockers.push(`كورس «${course.title}» فيه ${course.n} اشتراك طلاب`);

  const files: string[] = [];
  const collect = async (sql: string, list: number[]) => { if (list.length) for (const row of await conn.rows(sql, [list])) if (row.f) files.push(String(row.f)); };
  await collect('SELECT video_file AS f FROM lessons WHERE id IN (?)', ids.lessons);
  await collect('SELECT file AS f FROM attachments WHERE id IN (?)', ids.attachments);
  await collect('SELECT image AS f FROM questions WHERE id IN (?)', ids.questions);
  return { ids, counts, blockers, files };
}
async function runDelete(name: string, rootIds: number[], force = false) {
  const plan = await transaction(async tx => {
    const plan = await planDelete(tx, name, rootIds);
    ensure(force || !plan.blockers.length, 409, `مينفعش الحذف: ${plan.blockers.join('، ')}`);
    // Children first: exams hang off lessons with SET NULL, so they are removed explicitly; the rest follows the
    // ON DELETE CASCADE foreign keys from the rows removed here.
    const del = async (table: string, list: number[]) => { if (list.length) await tx.run(`DELETE FROM \`${table}\` WHERE id IN (?)`, [list]); };
    // Forced: results go first, since exam_attempts.exam_id is ON DELETE RESTRICT (answers and notifications cascade).
    if (plan.ids.exams.length) await tx.run('DELETE FROM exam_attempts WHERE exam_id IN (?)', [plan.ids.exams]);
    await del('choices', plan.ids.choices); await del('questions', plan.ids.questions); await del('exams', plan.ids.exams);
    await del('attachments', plan.ids.attachments); await del('lessons', plan.ids.lessons); await del('lectures', plan.ids.lectures);
    await del('courses', plan.ids.courses); await del('grades', plan.ids.grades);
    if (!(CASCADE_TABLES as readonly string[]).includes(name)) await del(resources[name]!.table, [...new Set(rootIds)]);
    return plan;
  });
  for (const file of new Set(plan.files)) await removeUpload(file);
  return plan;
}
teacher.post('/delete-preview', async(req,res) => {
  const { resource, ids } = DELETE_SCHEMA.parse(req.body);
  const plan = await planDelete(db, resource, ids);
  res.json({ counts: plan.counts, blockers: plan.blockers });
});
teacher.post('/bulk-delete', async(req,res) => {
  const { resource, ids, force } = DELETE_SCHEMA.parse(req.body);
  const plan = await runDelete(resource, ids, force);
  res.json({ ok: true, counts: plan.counts });
});
teacher.delete('/resources/:resource/:id', async(req,res) => {
  const plan = await runDelete(String(req.params.resource), [id(req.params.id)]);
  res.json({ ok: true, counts: plan.counts });
});
// Course builder: the whole outline (lectures with their lessons, in display order) in one request.
teacher.get('/courses/:id/outline', async(req,res) => {
  const courseId=id(req.params.id);
  const course=await db.one('SELECT id,title,slug FROM courses WHERE id=?',[courseId]); ensure(course,404,'الكورس غير موجود');
  const lectures=await db.rows('SELECT id,title,description,`order` FROM lectures WHERE course_id=? ORDER BY `order`,id',[courseId]);
  const lessons=await db.rows(`SELECT l.id,l.lecture_id,l.title,l.video_source,l.video_import_status,l.video_import_error,l.is_preview,l.duration_minutes,l.\`order\`,
    (SELECT COUNT(*) FROM attachments a WHERE a.lesson_id=l.id) AS attachments_count,
    ((l.video_source='youtube' AND l.youtube_id<>'') OR (l.video_source='drive' AND l.drive_url<>'') OR (l.video_source='file' AND l.video_file<>'')) AS has_video
    FROM lessons l JOIN lectures t ON t.id=l.lecture_id WHERE t.course_id=? ORDER BY l.\`order\`,l.id`,[courseId]);
  res.json({course,lectures:lectures.map(lecture=>({...lecture,lessons:lessons.filter(lesson=>lesson.lecture_id===lecture.id)}))});
});
// Saves a new order for every lecture of a course or every lesson of a lecture. The list must contain exactly the
// parent's items, so a stale or tampered list cannot move content between courses.
teacher.post('/reorder', async(req,res) => {
  const {resource,parent_id,ids}=z.object({resource:z.enum(['lectures','lessons']),parent_id:z.number().int().positive(),ids:z.array(z.number().int().positive()).min(1).max(500)}).strict().parse(req.body);
  const parentKey=resource==='lectures'?'course_id':'lecture_id';
  const owned=new Set((await db.rows(`SELECT id FROM \`${resource}\` WHERE \`${parentKey}\`=?`,[parent_id])).map(row=>Number(row.id)));
  ensure(ids.length===owned.size&&new Set(ids).size===ids.length&&ids.every(rowId=>owned.has(rowId)),409,'المحتوى اتغيّر من مكان تاني. حدّث الصفحة وجرّب تاني.');
  await transaction(async tx=>{for(const [index,rowId] of ids.entries())await tx.run(`UPDATE \`${resource}\` SET \`order\`=? WHERE id=?`,[index+1,rowId]);});
  res.json({ok:true});
});
teacher.get('/students',async(req,res) => {
  const search=`%${String(req.query.q || '').slice(0,150)}%`;
  const rows=await db.rows(`SELECT u.*,(SELECT COUNT(*) FROM enrollments en WHERE en.student_id=u.id AND en.status='active') AS courses_count,
    (SELECT COUNT(*) FROM exam_attempts a WHERE a.student_id=u.id AND a.submitted_at IS NOT NULL) AS exams_count
    FROM users u WHERE role='student' AND (username LIKE ? OR first_name LIKE ? OR last_name LIKE ? OR phone LIKE ?) ORDER BY created_at DESC LIMIT 500`,[search,search,search,search]);
  res.json(rows.map(publicUser));
});
teacher.get('/students/:id',async(req,res) => {
  const student=await db.one('SELECT * FROM users WHERE id=? AND role=\'student\'',[id(req.params.id)]); ensure(student,404,'الطالب غير موجود');
  const enrollments=await db.rows('SELECT en.*,c.title FROM enrollments en JOIN courses c ON c.id=en.course_id WHERE en.student_id=?',[student.id]);
  const devices=await db.rows('SELECT id,device_name,ip_address,last_login,is_active FROM student_devices WHERE student_id=?',[student.id]);
  const results=await db.rows('SELECT a.*,e.title FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id=? ORDER BY a.started_at DESC',[student.id]);
  res.json({student:publicUser(student),enrollments,devices,results});
});
teacher.patch('/students/:id',async(req,res) => {
  const data=z.object({is_active:z.boolean().optional(),is_security_banned:z.boolean().optional(),grade_id:z.number().int().positive().nullable().optional()}).strict().parse(req.body);
  ensure(Object.keys(data).length,400,'لا توجد تغييرات');
  await db.run('UPDATE users SET ? WHERE id=? AND role=\'student\'',[data,id(req.params.id)]); res.json({ok:true});
});
teacher.post('/students/:id/reset-devices',async(req,res) => { await db.run('UPDATE student_devices SET is_active=0,session_key=\'\' WHERE student_id=?',[id(req.params.id)]); res.json({ok:true}); });
teacher.post('/students/:id/unban',async(req,res) => { await db.run('UPDATE users SET is_security_banned=0,banned_until=NULL,locked_until=NULL,screenshot_strikes=0 WHERE id=? AND role=\'student\'',[id(req.params.id)]); res.json({ok:true}); });
// Ends the capture timer on every device of the student while keeping the ban in place.
teacher.post('/students/:id/stop-timer',async(req,res) => { await db.run('UPDATE users SET locked_until=NULL WHERE id=? AND role=\'student\'',[id(req.params.id)]); res.json({ok:true}); });
teacher.get('/security-settings',async(_req,res) => res.json({capture_lock_minutes:await captureLockMinutes()}));
teacher.post('/security/reset-guest-locks',async(_req,res) => { await db.run('INSERT INTO platform_settings(name,value) VALUES (\'guest_lock_reset_at\',?) ON DUPLICATE KEY UPDATE value=VALUES(value)',[String(Date.now())]); res.json({ok:true}); });
teacher.put('/security-settings',async(req,res) => {
  const {capture_lock_minutes}=z.object({capture_lock_minutes:z.number().int().min(1).max(1440)}).strict().parse(req.body);
  await db.run('INSERT INTO platform_settings(name,value) VALUES (\'capture_lock_minutes\',?) ON DUPLICATE KEY UPDATE value=VALUES(value)',[String(capture_lock_minutes)]);
  res.json({capture_lock_minutes});
});
teacher.post('/students/:id/reset-password',async(req,res) => {
  const data=z.object({password:z.string().min(8).max(200)}).parse(req.body), studentId=id(req.params.id);
  ensure(await db.one('SELECT id FROM users WHERE id=? AND role=\'student\'',[studentId]),404,'الطالب غير موجود');
  const hash=await hashPassword(data.password);
  await transaction(async tx => {
    await tx.run('UPDATE users SET password=? WHERE id=?',[hash,studentId]);
    await tx.run('UPDATE student_devices SET is_active=0,session_key=\'\' WHERE student_id=?',[studentId]);
    await tx.run('UPDATE password_reset_requests SET resolved_at=UTC_TIMESTAMP(3) WHERE student_id=?',[studentId]);
  }); res.json({ok:true});
});
teacher.get('/enrollments',async(_req,res) => res.json(await db.rows('SELECT en.*,u.username,u.first_name,c.title FROM enrollments en JOIN users u ON u.id=en.student_id JOIN courses c ON c.id=en.course_id ORDER BY en.created_at DESC LIMIT 1000')));
teacher.post('/enrollments',async(req,res) => {
  const data=z.object({student_id:z.number().int().positive(),course_id:z.number().int().positive(),status:z.enum(['active','pending']).default('active')}).parse(req.body);
  ensure(await db.one('SELECT id FROM users WHERE id=? AND role=\'student\'',[data.student_id]),400,'اختر طالبًا');
  await db.run('INSERT INTO enrollments SET ? ON DUPLICATE KEY UPDATE status=VALUES(status)',[data]); res.json({ok:true});
});
teacher.post('/enrollments/:id/:action',async(req,res) => {
  ensure(['activate','remove'].includes(String(req.params.action)),400,'إجراء غير صالح');
  if(req.params.action==='remove') await db.run('DELETE FROM enrollments WHERE id=?',[id(req.params.id)]);
  else await db.run('UPDATE enrollments SET status=\'active\' WHERE id=?',[id(req.params.id)]);
  res.json({ok:true});
});
async function filteredCodes(query:Record<string,unknown>){
  const course=Number(query.course)||null,used=query.status==='used'?1:query.status==='unused'?0:null;
  return db.rows('SELECT a.*,c.title,u.username FROM access_codes a LEFT JOIN courses c ON c.id=a.course_id LEFT JOIN users u ON u.id=a.used_by_id WHERE (? IS NULL OR a.course_id=?) AND (? IS NULL OR a.is_used=?) ORDER BY a.id DESC',[course,course,used,used]);
}
teacher.get('/codes',async(req,res) => res.json((await filteredCodes(req.query)).slice(0,5000)));
teacher.post('/codes',async(req,res) => {
  const data=z.object({course_id:z.number().int().positive().nullable().default(null),count:z.number().int().min(1).max(500),prefix:z.string().regex(/^[A-Za-z0-9]{1,6}$/).default('PH')}).parse(req.body);
  const codes=await transaction(async tx => { const list=[]; for(let i=0;i<data.count;i++){ const code=`${data.prefix.toUpperCase()}-${randomBytes(6).toString('hex').toUpperCase()}`; await tx.run('INSERT INTO access_codes(code,course_id) VALUES (?,?)',[code,data.course_id]);list.push(code); } return list; });
  res.status(201).json({codes});
});
teacher.get('/codes/export',async(req,res) => {
  const rows=await filteredCodes(req.query);
  if(req.query.format!=='csv'){res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('access-codes.xlsx').send(codesWorkbook(rows));return;}
  const cell=(v:unknown)=>`"${String(v ?? '').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')}"`;
  res.type('text/csv; charset=utf-8').attachment('access-codes.csv').send('\ufeffCode,Course,Used,Student\r\n'+rows.map(r=>[r.code,r.title,r.is_used,r.username].map(cell).join(',')).join('\r\n'));
});
teacher.get('/inbox',async(_req,res) => res.json(await db.rows('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 500')));
teacher.patch('/inbox/:id',async(req,res) => { const {is_read}=z.object({is_read:z.boolean()}).parse(req.body);await db.run('UPDATE contact_messages SET is_read=? WHERE id=?',[is_read,id(req.params.id)]);res.json({ok:true}); });
teacher.get('/results',async(req,res) => {
  const exam=Number(req.query.exam)||null;
  res.json(await db.rows("SELECT a.*,e.title,u.username,u.first_name,u.last_name,u.parent_phone,u.mother_phone FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN users u ON u.id=a.student_id WHERE u.role='student' AND a.submitted_at IS NOT NULL AND (? IS NULL OR e.id=?) ORDER BY a.submitted_at DESC LIMIT 1000",[exam,exam]));
});
teacher.patch('/answers/:id/grade',async(req,res) => {
  const data=z.object({score_awarded:z.number().int().min(0),teacher_feedback:z.string().max(5000).default('')}).parse(req.body);
  await transaction(async tx => {
    const answer=await tx.one('SELECT a.*,q.points FROM attempt_answers a JOIN questions q ON q.id=a.question_id WHERE a.id=? FOR UPDATE',[id(req.params.id)]);ensure(answer,404,'الإجابة غير موجودة');
    ensure(data.score_awarded<=answer.points,400,'الدرجة أكبر من درجة السؤال');
    await tx.run('UPDATE attempt_answers SET score_awarded=?,teacher_feedback=?,is_correct=? WHERE id=?',[data.score_awarded,data.teacher_feedback,data.score_awarded===answer.points,answer.id]);
    const score=(await tx.one('SELECT SUM(score_awarded) AS total FROM attempt_answers WHERE attempt_id=?',[answer.attempt_id]))!.total;
    await tx.run('UPDATE exam_attempts SET score=?,percent=IF(max_score>0,ROUND(?*100/max_score,1),0) WHERE id=?',[score,score,answer.attempt_id]);
  });res.json({ok:true});
});
teacher.get('/security',async(_req,res) => res.json({events:await db.rows('SELECT s.*,u.username FROM security_events s JOIN users u ON u.id=s.student_id ORDER BY s.id DESC LIMIT 500'),students:(await db.rows('SELECT * FROM users WHERE screenshot_strikes>0 OR is_security_banned=1 OR locked_until>UTC_TIMESTAMP(3)')).map(publicUser)}));
teacher.get('/notifications',async(_req,res)=>res.json({enabled:process.env.NOTIFICATIONS_ENABLED==='1',jobs:await db.rows('SELECT id,attempt_id,channel,recipient,status,tries,last_error,created_at,sent_at FROM notification_jobs ORDER BY id DESC LIMIT 500')}));
teacher.post('/notifications/:id/retry',async(req,res)=>{await db.run("UPDATE notification_jobs SET status='pending',tries=0 WHERE id=? AND status='failed'",[id(req.params.id)]);res.json({ok:true});});
teacher.get('/reports',async(req,res) => {
  const q=String(req.query.q||'').trim().slice(0,150),grade=Number(req.query.grade)||null,course=Number(req.query.course)||null,offset=Math.max(-52,Math.min(0,Number(req.query.offset)||0));
  const today=new Date(),days=(today.getUTCDay()+1)%7,since=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()-days+offset*7)),until=new Date(since);until.setUTCDate(until.getUTCDate()+7);
  const filters=['u.role=\'student\''],base:unknown[]=[];
  if(q){filters.push('(u.username LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ?)');base.push(`%${q}%`,`%${q}%`,`%${q}%`,`%${q}%`);}
  if(grade){filters.push('u.grade_id=?');base.push(grade);}
  const students=await db.rows(`SELECT u.id,u.username,u.first_name,u.last_name,u.phone,u.parent_phone,u.mother_phone,g.name AS grade_name FROM users u LEFT JOIN grades g ON g.id=u.grade_id WHERE ${filters.join(' AND ')} ORDER BY u.first_name,u.last_name,u.username LIMIT 1000`,base);
  if(!students.length){res.json([]);return;}
  const ids=students.map(student=>student.id);
  const [lessons,exams,views]=await Promise.all([
    db.rows(`SELECT p.student_id,COUNT(*) AS n FROM lesson_progress p JOIN lessons l ON l.id=p.lesson_id JOIN lectures t ON t.id=l.lecture_id WHERE p.student_id IN (?) AND p.is_completed=1 AND p.completed_at>=? AND p.completed_at<?${course?' AND t.course_id=?':''} GROUP BY p.student_id`,[ids,since,until,...(course?[course]:[])]),
    db.rows(`SELECT a.student_id,AVG(a.percent) AS average,COUNT(*) AS n FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.student_id IN (?) AND a.submitted_at>=? AND a.submitted_at<?${course?' AND e.course_id=?':''} GROUP BY a.student_id`,[ids,since,until,...(course?[course]:[])]),
    db.rows(`SELECT student_id,is_viewed,view_count FROM (SELECT student_id,is_viewed,view_count,ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY created_at DESC,id DESC) AS rank_no FROM parent_report_views WHERE student_id IN (?)${course?' AND course_id=?':''}) ranked WHERE rank_no=1`,[ids,...(course?[course]:[])]),
  ]);
  const lessonByStudent=new Map(lessons.map(row=>[Number(row.student_id),row]));
  const examByStudent=new Map(exams.map(row=>[Number(row.student_id),row]));
  const viewByStudent=new Map(views.map(row=>[Number(row.student_id),row]));
  const rows=students.map(student=>{
    const exam=examByStudent.get(Number(student.id)),view=viewByStudent.get(Number(student.id));
    return {...student,lessons:Number(lessonByStudent.get(Number(student.id))?.n||0),average:exam?.average==null?null:Number(exam.average),exams:Number(exam?.n||0),is_viewed:Boolean(view?.is_viewed),view_count:Number(view?.view_count||0),start:since.toISOString(),end:new Date(until.getTime()-1).toISOString()};
  });
  res.json(rows);
});
teacher.get('/students/:id/report',async(req,res) => res.json({...await reportFor(id(req.params.id),req.query.start as string,req.query.end as string,Number(req.query.course)||null,Number(req.query.offset)||0),views:await db.rows('SELECT id,recipient_role,week_start,week_end,is_viewed,view_count,first_viewed_at,last_viewed_at FROM parent_report_views WHERE student_id=? ORDER BY created_at DESC LIMIT 100',[id(req.params.id)])}));
teacher.post('/students/:id/report-link',async(req,res) => {
  const data=z.object({course_id:z.number().int().positive().nullable().default(null),start:z.iso.date(),end:z.iso.date(),recipient_role:z.enum(['parent','mother','student','general']).default('parent')}).parse(req.body);
  const studentId=id(req.params.id);await reportFor(studentId,data.start,data.end,data.course_id);
  const existing=await db.one('SELECT token FROM parent_report_views WHERE student_id=? AND course_id<=>? AND week_start=? AND week_end=? AND recipient_role=? LIMIT 1',[studentId,data.course_id,data.start,data.end,data.recipient_role]);
  if(existing){res.json({path:`/report/parent/${existing.token}`});return;}
  const token=randomBytes(32).toString('hex');
  await db.run('INSERT INTO parent_report_views(student_id,course_id,week_start,week_end,recipient_role,token) VALUES (?,?,?,?,?,?)',[studentId,data.course_id,data.start,data.end,data.recipient_role,token]);
  res.json({path:`/report/parent/${token}`});
});
