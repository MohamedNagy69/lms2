import { db } from '../db/index.js';
import { ensure } from '../lib/errors.js';
import { randomBytes } from 'node:crypto';

function weekBounds(start?: string | Date, end?: string | Date, offset = 0) {
  if (start && end) {
    const since = new Date(start), until = new Date(end);
    since.setUTCHours(0, 0, 0, 0); until.setUTCHours(23, 59, 59, 999);
    return { since, until };
  }
  const today = new Date();
  const daysSinceSaturday = (today.getUTCDay() + 1) % 7;
  const since = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - daysSinceSaturday + offset * 7));
  const until = new Date(since); until.setUTCDate(until.getUTCDate() + 6); until.setUTCHours(23, 59, 59, 999);
  return { since, until };
}

function waPhone(value: unknown) {
  let phone = String(value || '').replace(/\D/g, '').replace(/^00/, '');
  if (/^01\d{9}$/.test(phone)) phone = `2${phone}`;
  return phone;
}

function reportMessage(student: any, course: any, data: any, path: string, role: 'father'|'mother'|'student') {
  const greeting = role === 'father' ? 'ولي أمر الطالب' : role === 'mother' ? 'ولية أمر الطالب' : 'الطالب';
  return `منصة الأستاذ 🎓\n${greeting}: ${student.first_name || ''} ${student.last_name || ''}\nالكورس: ${course?.title || 'المحتوى العام'}\nالفترة: ${data.start.toISOString().slice(0,10)} إلى ${data.end.toISOString().slice(0,10)}\nإنجاز الكورس: ${data.course_data.progress_percent}% (${data.course_data.total_watched}/${data.course_data.total_lessons})\nدروس هذا الأسبوع: ${data.course_data.watched_this_week_count}\nمتوسط الاختبارات: ${Math.round(data.average)}%\nرابط التقرير الخاص: ${path}`;
}

export async function reportFor(studentId: number, start?: string | Date, end?: string | Date, courseId?: number | null, offset = 0) {
  const { since, until } = weekBounds(start, end, offset);
  ensure(since <= until, 400, 'الفترة غير صحيحة');
  const student = await db.one('SELECT id,first_name,last_name,username,phone,parent_phone,mother_phone,grade_id FROM users WHERE id=?', [studentId]);
  ensure(student, 404, 'الطالب غير موجود');

  const selectedCourse = (courseId ? await db.one('SELECT id,title,slug FROM courses WHERE id=?', [courseId]) : undefined)
    || await db.one('SELECT c.id,c.title,c.slug FROM enrollments en JOIN courses c ON c.id=en.course_id WHERE en.student_id=? AND en.status=\'active\' ORDER BY en.created_at DESC LIMIT 1', [studentId])
    || await db.one('SELECT id,title,slug FROM courses WHERE is_published=1 ORDER BY `order`,id DESC LIMIT 1');
  const course = selectedCourse;
  const lectures = course ? await db.rows('SELECT id,title,`order` FROM lectures WHERE course_id=? ORDER BY `order`,id', [course.id]) : [];
  const lessons = course ? await db.rows('SELECT l.id,l.lecture_id,l.title,l.duration_minutes,l.`order`,p.is_completed,p.completed_at FROM lessons l LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.student_id=? JOIN lectures t ON t.id=l.lecture_id WHERE t.course_id=? ORDER BY t.`order`,t.id,l.`order`,l.id', [studentId, course.id]) : [];
  const totalLessons = lessons.length;
  const watched = lessons.filter(l => Boolean(l.is_completed));
  const watchedThisWeek = watched.filter(l => l.completed_at && new Date(l.completed_at) >= since && new Date(l.completed_at) <= until);
  const courseData = {
    course, total_lessons: totalLessons, total_watched: watched.length, remaining_lessons: Math.max(0, totalLessons - watched.length),
    watched_this_week_count: watchedThisWeek.length, progress_percent: totalLessons ? Math.round(watched.length * 1000 / totalLessons) / 10 : 0,
    lectures: lectures.map(lecture => { const rows = lessons.filter(l => l.lecture_id === lecture.id); return { lecture, total_lessons: rows.length, watched_lessons: rows.filter(l => l.is_completed).length,
      lessons: rows.map(l => ({ lesson: {id:l.id,title:l.title,duration_minutes:l.duration_minutes,order:l.order}, is_completed:Boolean(l.is_completed), completed_at:l.completed_at,
        watched_this_week:Boolean(l.completed_at && new Date(l.completed_at) >= since && new Date(l.completed_at) <= until) })) }; }),
  };

  const results = await db.rows(`SELECT a.*,e.title,e.pass_percent,c.title AS course_title FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id
    WHERE a.student_id=? AND a.submitted_at IS NOT NULL AND a.submitted_at BETWEEN ? AND ? ${course ? 'AND c.id=?' : ''} ORDER BY a.submitted_at DESC`, course ? [studentId, since, until, course.id] : [studentId, since, until]);
  const answerRows = results.length ? await db.rows(`SELECT aa.*,q.text,q.points,q.question_type,q.explanation,ch.text AS choice_text,correct.text AS correct_text
    FROM attempt_answers aa JOIN questions q ON q.id=aa.question_id LEFT JOIN choices ch ON ch.id=aa.choice_id LEFT JOIN choices correct ON correct.question_id=q.id AND correct.is_correct=1
    WHERE aa.attempt_id IN (?) ORDER BY aa.attempt_id,q.\`order\`,q.id`, [results.map(result=>result.id)]) : [];
  const answersByAttempt = new Map<number, typeof answerRows>();
  for (const answer of answerRows) {
    const items = answersByAttempt.get(answer.attempt_id) || [];
    items.push(answer); answersByAttempt.set(answer.attempt_id, items);
  }
  const exams: any[] = results.map(result => ({ ...result, exam_title: result.title,
    is_passed: Number(result.percent) >= Number(result.pass_percent), answers: answersByAttempt.get(result.id) || [] }));
  const average = exams.length ? exams.reduce((sum, row) => sum + Number(row.percent || 0), 0) / exams.length : 0;
  let parent = await db.one('SELECT token,is_viewed,view_count,first_viewed_at,last_viewed_at FROM parent_report_views WHERE student_id=? AND course_id<=>? AND week_start=? AND week_end=? AND recipient_role=\'parent\' LIMIT 1', [studentId, course?.id || null, since.toISOString().slice(0,10), until.toISOString().slice(0,10)]);
  if (!parent) {
    const token = randomBytes(32).toString('hex');
    await db.run('INSERT INTO parent_report_views(student_id,course_id,week_start,week_end,recipient_role,token) VALUES (?,?,?,?,\'parent\',?)', [studentId, course?.id || null, since.toISOString().slice(0,10), until.toISOString().slice(0,10), token]);
    parent = { token, is_viewed: 0, view_count: 0, first_viewed_at: null, last_viewed_at: null };
  }
  const parentPath = `/report/parent/${parent.token}`;
  const data = { student, selected_course:course, start:since, end:until, week_offset:offset, course_data:courseData, progress:watchedThisWeek, results:exams, exams_data:exams, exams_count:exams.length, average, avg_exam_percent:average,
    parent_report:parent, parent_report_url:parentPath } as any;
  data.father_whatsapp_url = waPhone(student.parent_phone) && parentPath ? `https://wa.me/${waPhone(student.parent_phone)}?text=${encodeURIComponent(reportMessage(student,course,data,parentPath,'father'))}` : '';
  data.mother_whatsapp_url = waPhone(student.mother_phone) && parentPath ? `https://wa.me/${waPhone(student.mother_phone)}?text=${encodeURIComponent(reportMessage(student,course,data,parentPath,'mother'))}` : '';
  data.student_whatsapp_url = waPhone(student.phone) && parentPath ? `https://wa.me/${waPhone(student.phone)}?text=${encodeURIComponent(reportMessage(student,course,data,parentPath,'student'))}` : '';
  return data;
}
