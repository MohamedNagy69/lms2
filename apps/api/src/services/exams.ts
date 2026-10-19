import { db, transaction, type Database, type Row } from '../db/index.js';
import { canAccess } from '../lib/catalog.js';
import { ensure } from '../lib/errors.js';
import { isTeacher } from '../lib/auth.js';
import { checkEssay } from './grading.js';
import { queueResults } from './notifications.js';
export async function examQuestions(examId: number, conn: Database = db): Promise<Array<Row & {choices: Row[]}>> {
  const questions = await conn.rows('SELECT * FROM questions WHERE exam_id=? ORDER BY `order`,id', [examId]);
  const choices = await conn.rows('SELECT c.* FROM choices c JOIN questions q ON q.id=c.question_id WHERE q.exam_id=? ORDER BY c.`order`,c.id', [examId]);
  const byQuestion=new Map<number,Row[]>();
  for(const choice of choices){
    const group=byQuestion.get(choice.question_id)||[];
    group.push(choice);byQuestion.set(choice.question_id,group);
  }
  return questions.map(q => ({ ...q, choices: byQuestion.get(q.id)||[] }));
}
export async function attemptFor(attemptId: number, user: Row, conn: Database = db, lock = false) {
  const attempt = await conn.one(`SELECT a.*,e.title,e.course_id,e.duration_minutes,e.pass_percent,e.max_infractions,e.require_webcam,e.require_fullscreen,e.prevent_copy_paste,e.shuffle_questions,e.ai_multi_person_detection,e.ai_absence_and_camera_block,e.prevent_multiple_screens,e.auto_send_result FROM exam_attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?${lock ? ' FOR UPDATE' : ''}`, [attemptId]);
  ensure(attempt, 404, 'المحاولة غير موجودة');
  ensure(isTeacher(user) || attempt.student_id === user.id, 403, 'ليس لديك صلاحية');
  attempt.deadline = attempt.deadline_at || new Date(new Date(attempt.started_at).getTime() + attempt.duration_minutes * 60000);
  return attempt;
}
export async function startExam(examId: number, user: Row) {
  return transaction(async tx => {
    await tx.one('SELECT id FROM users WHERE id=? FOR UPDATE', [user.id]);
    const exam = await tx.one('SELECT * FROM exams WHERE id=? AND is_published=1', [examId]);
    ensure(exam, 404, 'الامتحان غير موجود');
    const course = (await tx.one('SELECT * FROM courses WHERE id=?', [exam.course_id]))!;
    ensure(await canAccess(user, course, tx), 403, 'اشترك في الكورس أولًا');
    const running = await tx.one('SELECT * FROM exam_attempts WHERE student_id=? AND exam_id=? AND submitted_at IS NULL ORDER BY id DESC LIMIT 1', [user.id, examId]);
    if (running) return running.id;
    const count = (await tx.one('SELECT COUNT(*) AS n FROM exam_attempts WHERE student_id=? AND exam_id=? AND submitted_at IS NOT NULL', [user.id, examId]))!.n;
    ensure((exam.allow_retake || count === 0) && (!exam.max_attempts || count < exam.max_attempts), 409, 'استنفدت المحاولات المسموح بها');
    const points = await tx.one('SELECT COUNT(*) AS n,COALESCE(SUM(points),0) AS total FROM questions WHERE exam_id=?', [examId]);
    ensure(points?.n, 409, 'لا توجد أسئلة في الامتحان');
    const invalid=await tx.one("SELECT q.id FROM questions q LEFT JOIN choices c ON c.question_id=q.id WHERE q.exam_id=? AND q.question_type='mcq' GROUP BY q.id HAVING COUNT(c.id)<2 OR SUM(c.is_correct)<>1 LIMIT 1",[examId]);
    ensure(!invalid,409,'الامتحان يحتاج مراجعة الاختيارات والإجابات الصحيحة من المدرس');
    const result = await tx.run('INSERT INTO exam_attempts(student_id,exam_id,max_score,deadline_at,draft_answers) VALUES (?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),?)', [user.id, examId, points.total, exam.duration_minutes, '{}']);
    return result.insertId;
  });
}
export async function finishAttempt(attemptId: number, user: Row, incoming?: Record<string, string>) {
  const result=await transaction(async tx => {
    const attempt = await attemptFor(attemptId, user, tx, true);
    if (attempt.submitted_at) return attempt;
    const beforeDeadline = Date.now() <= new Date(attempt.deadline).getTime();
    const saved = typeof attempt.draft_answers === 'string' ? JSON.parse(attempt.draft_answers) : attempt.draft_answers || {};
    const answers = incoming && beforeDeadline ? incoming : saved;
    const questions = await examQuestions(attempt.exam_id, tx);
    let score = 0, total = 0;
    for (const question of questions) {
      total += question.points;
      const raw = String(answers[question.id] || '').slice(0, 20000);
      const choice = question.question_type === 'mcq' ? question.choices.find((c: Row) => String(c.id) === raw) : undefined;
      const correct = question.question_type === 'essay' ? checkEssay(raw, question.explanation) : Boolean(choice?.is_correct);
      const awarded = correct ? question.points : 0; score += awarded;
      await tx.run('INSERT INTO attempt_answers(attempt_id,question_id,choice_id,text_answer,is_correct,score_awarded,teacher_feedback) VALUES (?,?,?,?,?,?,?)', [attemptId, question.id, choice?.id || null, question.question_type === 'essay' ? raw : '', correct, awarded, question.question_type === 'essay' && correct ? 'مطابقة لنموذج الإجابة' : '']);
    }
    const percent = total ? Math.round(score * 1000 / total) / 10 : 0;
    await tx.run('UPDATE exam_attempts SET submitted_at=UTC_TIMESTAMP(3),score=?,max_score=?,percent=?,draft_answers=NULL WHERE id=?', [score, total, percent, attemptId]);
    return { ...attempt, score, max_score: total, percent, submitted_at: new Date() };
  });
  if(result.auto_send_result)try{await queueResults(attemptId);}catch(error){console.error('Could not queue result notification:',(error as {code?:string}).code||'error');}
  return result;
}
