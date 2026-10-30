import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomBytes,pbkdf2Sync,createDecipheriv} from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const state=JSON.parse(await fs.readFile(path.join(root,'.local/mysql.json'),'utf8'));
const dbName=`mudarris_test_${randomBytes(5).toString('hex')}`,port=4400+Math.floor(Math.random()*500);
const admin=await mysql.createConnection({host:'127.0.0.1',port:state.port,user:'root',password:state.rootPassword});
// WEB_ORIGIN is pinned to the Origin the test client sends, so the run does not depend on the port in the local .env.
const env={...process.env,MYSQL_DATABASE:dbName,API_PORT:String(port),WEB_ORIGIN:'http://localhost:3000',NOTIFICATIONS_ENABLED:'0',UPLOAD_ROOT:`.local/test-uploads/${dbName}`};
let connection,server,log='',checks=0;
const pass=message=>{checks++;console.log(`PASS ${message}`);};
function run(args){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',c=>output+=c);p.stderr.on('data',c=>output+=c);p.on('error',reject);p.on('exit',code=>code===0?resolve(output):reject(new Error(output)));});}
function client(){const cookies=new Map();return {cookies,async request(url,method='GET',data,options={}){
  const headers={'Origin':'http://localhost:3000','X-Requested-With':'Mudarris',...options.headers};
  if(cookies.size)headers.Cookie=[...cookies].map(([k,v])=>`${k}=${v}`).join('; ');
  const form=data instanceof FormData;if(!form)headers['Content-Type']='application/json';
  const response=await fetch(`http://127.0.0.1:${port}/api${url}`,{method,headers,body:data===undefined?undefined:form?data:JSON.stringify(data),redirect:'manual'});
  for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
  const body=response.headers.get('content-type')?.includes('json')?await response.json():options.raw?Buffer.from(await response.arrayBuffer()):await response.text();
  return {status:response.status,body,headers:response.headers};
}};}
try{
  await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO 'mudarris_app'@'127.0.0.1'`);
  await run(['--import','tsx','apps/api/src/db/migrate.ts']);
  connection=await mysql.createConnection({host:'127.0.0.1',port:state.port,user:state.user,password:state.password,database:dbName});
  const password=randomBytes(18).toString('base64url');
  await connection.query("INSERT INTO users(username,password,first_name,role,bio) VALUES ('instructor',?,'Instructor','teacher','')",[await bcrypt.hash(password,10)]);
  const legacy=`pbkdf2_sha256$100000$legacySalt$${pbkdf2Sync(password,'legacySalt',100000,32,'sha256').toString('base64')}`;
  await connection.query("INSERT INTO users(username,password,first_name,phone,bio) VALUES ('legacy',?,'Legacy','01012345678','')",[legacy]);
  server=spawn(process.execPath,['apps/api/dist/server.js'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',c=>log+=c);server.stderr.on('data',c=>log+=c);
  let ready=false;for(let i=0;i<60;i++){try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert(ready,log);
  const health=await fetch(`http://127.0.0.1:${port}/api/health`);assert(health.headers.get('x-request-id'));assert.equal(health.headers.get('cache-control'),'private, no-store');
  const malformed=await fetch(`http://127.0.0.1:${port}/api/auth/login`,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:'{' });
  assert.equal(malformed.status,400);assert((await malformed.json()).request_id);pass('Request IDs and safe validation errors are returned without caching');
  const teacher=client(),a=client(),b=client(),anon=client();
  assert.equal((await teacher.request('/auth/login','POST',{username:'instructor',password})).status,200);
  assert.equal((await a.request('/auth/login','POST',{username:'legacy',password})).status,200);
  const [legacyRows]=await connection.query("SELECT password FROM users WHERE username='legacy'");assert(legacyRows[0].password.startsWith('$2'));pass('Django PBKDF2 login upgrades the password safely');
  const registered=await b.request('/auth/register','POST',{username:'student_b',password,first_name:'طالب',phone:'01098765432',role:'teacher',is_superuser:true});assert.equal(registered.status,201);assert.equal(registered.body.user.role,'student');assert.equal(registered.body.user.is_teacher,false);pass('Registration cannot elevate privileges');
  assert.equal((await b.request('/teacher/dashboard')).status,403);assert.equal((await anon.request('/teacher/dashboard')).status,401);pass('Teacher endpoints enforce authentication and roles');
  assert.equal((await teacher.request('/teacher/resources/grades','POST',{name:'Bad origin'},{headers:{Origin:'https://attacker.invalid'}})).status,403);pass('Cross-origin mutations are rejected');
  async function create(resource,data){const r=await teacher.request(`/teacher/resources/${resource}`,'POST',data);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.id;}
  const grade=await create('grades',{name:'الصف التجريبي'});
  const privateAnnouncement=await create('announcements',{title:'إعلان خاص بالصف',body:'للطلاب في هذا الصف فقط',grade_id:grade});
  assert(!(await anon.request('/home')).body.announcements.some(item=>item.id===privateAnnouncement));pass('Grade announcements are not exposed to anonymous visitors');
  const course=await create('courses',{title:'الكورس التجريبي',grade_id:grade,master_access_code:'DO-NOT-LEAK'});
  const courseRecord=(await teacher.request(`/teacher/resources/courses/${course}`)).body;
  const lecture=await create('lectures',{title:'المحاضرة',course_id:course});
  const lesson=await create('lessons',{title:'الدرس المحمي',lecture_id:lecture,youtube_id:'dQw4w9WgXcQ'});
  const preview=await create('lessons',{title:'المعاينة',lecture_id:lecture,is_preview:true,youtube_id:'dQw4w9WgXcQ'});
  assert.equal((await anon.request(`/lessons/${lesson}`)).status,403);assert.equal((await anon.request(`/lessons/${preview}`)).status,200);
  assert.equal((await teacher.request(`/teacher/resources/lessons/${preview}`,'PATCH',{youtube_id:'aircAruvnKk'})).status,200);
  assert.equal((await anon.request(`/lessons/${preview}`)).body.lesson.demo_video,true);pass('Seed demonstration videos are clearly identified to viewers');
  const publicCourse=(await anon.request(`/courses/${courseRecord.slug}`)).body;assert.equal(publicCourse.course.master_access_code,undefined);assert.equal(publicCourse.lectures[0].lessons[0].youtube_id,undefined);pass('Paid lessons and access codes remain private; previews work');
  const masterUser=client();const masterAccount=await masterUser.request('/auth/register','POST',{username:'master_student',password,first_name:'طالب',phone:'01098765431'});assert.equal(masterAccount.status,201);
  // Joining takes a code: there is no pending request without one, and no price makes a course open.
  assert.equal((await masterUser.request(`/courses/${courseRecord.slug}/enroll`,'POST',{})).status,400);
  assert.equal((await masterUser.request(`/courses/${courseRecord.slug}/enroll`,'POST',{code:'WRONG-CODE'})).status,400);
  const masterEnrollment=await masterUser.request(`/courses/${courseRecord.slug}/enroll`,'POST',{code:'DO-NOT-LEAK'});
  assert.equal(masterEnrollment.status,200);assert.equal(masterEnrollment.body.status,'active');
  assert.equal((await masterUser.request(`/lessons/${lesson}`)).status,200);pass('Private master access code activates the course without leaking it publicly');
  const code=(await teacher.request('/codes','POST',{count:1})); // Verify wrong namespace never grants access.
  assert.equal(code.status,404);
  const generated=await teacher.request('/teacher/codes','POST',{count:1,course_id:course});assert.equal(generated.status,201);
  const redemption=await Promise.all([a.request(`/courses/${courseRecord.slug}/enroll`,'POST',{code:generated.body.codes[0]}),b.request(`/courses/${courseRecord.slug}/enroll`,'POST',{code:generated.body.codes[0]})]);
  assert.deepEqual(redemption.map(r=>r.status).sort(),[200,400]);pass('One activation code cannot be redeemed twice concurrently');
  await teacher.request('/teacher/enrollments','POST',{student_id:2,course_id:course});await teacher.request('/teacher/enrollments','POST',{student_id:registered.body.user.id,course_id:course});
  assert.equal((await a.request(`/lessons/${lesson}/progress`,'POST',{is_completed:true})).status,200);pass('Enrolled students can record lesson progress');
  await connection.query('UPDATE lesson_progress SET completed_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 DAY) WHERE student_id=2 AND lesson_id=?',[lesson]);
  assert.equal((await a.request(`/lessons/${lesson}/progress`,'POST',{is_completed:false})).status,200);
  assert.equal((await a.request(`/lessons/${lesson}/progress`,'POST',{is_completed:true})).status,200);
  const [progressRows]=await connection.query('SELECT is_completed,TIMESTAMPDIFF(SECOND,completed_at,UTC_TIMESTAMP(3)) AS age_seconds FROM lesson_progress WHERE student_id=2 AND lesson_id=?',[lesson]);
  assert.equal(progressRows[0].is_completed,1);assert(progressRows[0].age_seconds>=0&&progressRows[0].age_seconds<60);pass('Recompleted lessons receive a fresh completion time');
  const documentForm=new FormData();documentForm.set('file',new Blob(['%PDF-1.7\nTest fixture']), 'fixture.pdf');
  const documentUpload=await teacher.request('/teacher/uploads/attachments','POST',documentForm);assert.equal(documentUpload.status,201);
  const attachment=await create('attachments',{lesson_id:lesson,title:'ملف محمي',file:documentUpload.body.path});
  assert.equal((await anon.request(`/attachments/${attachment}/download`)).status,403);assert.equal((await a.request(`/attachments/${attachment}/download`)).status,200);pass('Uploaded attachments require lesson access');
  const sharedAttachment=await create('attachments',{lesson_id:lesson,title:'نسخة من الملف',file:documentUpload.body.path});
  assert.equal((await teacher.request(`/teacher/resources/attachments/${attachment}`,'DELETE')).status,200);
  assert.equal((await a.request(`/attachments/${sharedAttachment}/download`)).status,200);pass('Deleting one attachment preserves files used by another lesson resource');
  // 20-byte fixture with an MP4 signature ("ftyp" at bytes 4-7) so it passes the upload's content check.
  const videoForm=new FormData();videoForm.set('file',new Blob(['0123ftyp89ABCDEFGHIJ']),'fixture.mp4');
  const videoUpload=await teacher.request('/teacher/uploads/videos','POST',videoForm);assert.equal(videoUpload.status,201);
  await teacher.request(`/teacher/resources/lessons/${lesson}`,'PATCH',{video_source:'file',video_file:videoUpload.body.path});
  const video=(await a.request(`/lessons/${lesson}`)).body;
  assert.equal(video.stream_url,undefined);assert.equal((await a.request(`/lessons/${lesson}/stream?token=${encodeURIComponent(video.protected_stream.token)}`)).status,404);
  const videoPath=`/lessons/${lesson}/chunk?token=${encodeURIComponent(video.protected_stream.token)}`;
  const videoHeaders={Referer:`http://localhost:3000/course/${encodeURIComponent(courseRecord.slug)}/lesson/${lesson}`};
  // Chunks are ciphertext under the per-stream key; decrypt them the way public/media-sw.js does.
  const decrypt=response=>{const start=Number(response.headers.get('x-chunk-start'));const iv=Buffer.alloc(16);Buffer.from(video.protected_stream.nonce,'hex').copy(iv,0);iv.writeBigUInt64BE(BigInt(start/16),8);
    const decipher=createDecipheriv('aes-256-ctr',Buffer.from(video.protected_stream.key,'hex'),iv);return Buffer.concat([decipher.update(response.body),decipher.final()]).toString();};
  const streamed=await a.request(videoPath,'GET',undefined,{raw:true,headers:{...videoHeaders,Range:'bytes=0-4'}});assert.equal(streamed.status,200);assert.equal(streamed.headers.get('content-type'),'application/octet-stream');
  assert.notEqual(streamed.body.toString(),'0123f');assert.equal(decrypt(streamed),'0123f');
  const openRange=await a.request(videoPath,'GET',undefined,{raw:true,headers:{...videoHeaders,Range:'bytes=16-'}});assert.equal(decrypt(openRange),'GHIJ');
  const invalidRange=await a.request(videoPath,'GET',undefined,{headers:{...videoHeaders,Range:'bytes=999-'}});assert.equal(invalidRange.status,416);pass('Video is served only as encrypted chunks (no plain stream); ranges decrypt correctly; invalid ranges return 416');
  const driveLesson=await create('lessons',{title:'درس درايف',lecture_id:lecture,video_source:'drive',drive_url:'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view'});
  const driveView=(await a.request(`/lessons/${driveLesson}`)).body.lesson;assert.equal(driveView.drive_url,'');assert.equal(typeof driveView.video_preparing,'boolean');
  assert.ok((await teacher.request(`/teacher/resources/lessons/${driveLesson}`)).body.drive_url.includes('1AbCdEfGhIjKlMnOpQrStUvWxYz012345'));pass('Drive links are never sent to students; Drive lessons wait for the protected copy');
  const lessonRow=async(title,file)=>(await connection.query("INSERT INTO lessons(lecture_id,title,description,video_source,video_file,youtube_id,drive_url,duration_minutes,`order`,is_preview,enable_watermark) VALUES (?,?,'','file',?,'','',0,50,0,1)",[lecture,title,file]))[0].insertId;
  const noVideo=await lessonRow('بدون فيديو',null);
  assert.equal((await teacher.request(`/teacher/resources/lessons/${noVideo}`,'PATCH',{title:'اسم جديد'})).status,200);
  assert.equal((await teacher.request(`/teacher/resources/lessons/${noVideo}`,'PATCH',{video_source:'file',video_file:'',drive_url:'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view'})).status,200);
  assert.equal((await teacher.request(`/teacher/resources/lessons/${noVideo}`)).body.video_source,'drive');
  const withVideo=await lessonRow('بفيديو','videos/kept.mp4');
  assert.equal((await teacher.request(`/teacher/resources/lessons/${withVideo}`,'PATCH',{video_file:''})).status,400);pass('Lessons without a video stay editable, a pasted link is used, and an existing file cannot be removed without a replacement');
  // A CDN in front of the app (Hostinger's hcdn) drops Range and can drop Referer: the range also travels as
  // ?start=&end=, and a missing Referer is accepted while a foreign one or a cross-site request is refused.
  const viaQuery=await a.request(`${videoPath}&start=16&end=`,'GET',undefined,{raw:true});assert.equal(viaQuery.status,200);assert.equal(decrypt(viaQuery),'GHIJ');
  assert.equal((await a.request(videoPath)).status,416);
  assert.equal((await a.request(videoPath,'GET',undefined,{headers:{'Sec-Fetch-Site':'cross-site',Range:'bytes=0-4'}})).status,403);
  // A download manager handed the chunk URL with the student's cookies: no worker header, or its own user agent.
  assert.equal((await a.request(`${videoPath}&start=0&end=15`,'GET',undefined,{headers:{'X-Requested-With':''}})).status,403);
  assert.equal((await a.request(`${videoPath}&start=0&end=15`,'GET',undefined,{headers:{'User-Agent':'Internet Download Manager'}})).status,403);
  assert.equal((await a.request(videoPath,'GET',undefined,{headers:{Referer:'https://attacker.invalid/'}})).status,403);
  assert.equal((await b.request(videoPath,'GET',undefined,{headers:videoHeaders})).status,403);pass('Video streaming requires the site origin and the signed student session');
  const exam=await create('exams',{title:'اختبار',course_id:course,duration_minutes:10,max_attempts:1,require_fullscreen:false});
  const q1=await create('questions',{exam_id:exam,text:'2+2',points:2,explanation:'الإجابة أربعة'});
  const correct=await create('choices',{question_id:q1,text:'4',is_correct:true});const wrong=await create('choices',{question_id:q1,text:'5'});
  const q2=await create('questions',{exam_id:exam,text:'اكتب كلمة القاهرة',question_type:'essay',explanation:'القاهرة',points:3});
  const starts=await Promise.all([a.request(`/exams/${exam}/start`,'POST',{}),a.request(`/exams/${exam}/start`,'POST',{})]);assert.equal(starts[0].status,200);assert.equal(starts[0].body.id,starts[1].body.id);const attemptId=starts[0].body.id;pass('Concurrent exam starts share one active attempt');
  const attempt=(await a.request(`/attempts/${attemptId}`)).body;assert(attempt.questions.every(q=>!('explanation'in q)&&q.choices.every(c=>!('is_correct'in c))));
  assert.equal((await b.request(`/attempts/${attemptId}`)).status,403);pass('Live answers are hidden and attempts are private');
  await a.request(`/attempts/${attemptId}/answers`,'PUT',{answers:{[q1]:String(correct),[q2]:'القَاهِرَة'}});
  await connection.query('UPDATE exam_attempts SET deadline_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND) WHERE id=?',[attemptId]);
  const finished=await a.request(`/attempts/${attemptId}/submit`,'POST',{answers:{[q1]:String(wrong),[q2]:'خطأ'}});assert.equal(finished.body.score,5);assert.equal(finished.body.percent,100);pass('Expired submissions use saved answers and Arabic essay grading works');
  assert.equal((await a.request(`/exams/${exam}/start`,'POST',{})).status,409);
  assert.equal((await a.request(`/attempts/${attemptId}/submit`,'POST',{answers:{}})).body.score,5);pass('Attempt limits and idempotent submission are enforced');
  assert.equal((await teacher.request(`/teacher/resources/questions/${q1}`,'PATCH',{text:'changed'})).status,409);pass('Questions with recorded attempts cannot be silently rewritten');
  const review=(await teacher.request(`/attempts/${attemptId}`)).body,essay=review.answers.find(r=>r.question_id===q2);
  await teacher.request(`/teacher/answers/${essay.id}/grade`,'PATCH',{score_awarded:1,teacher_feedback:'مراجعة'});
  assert.equal((await a.request(`/attempts/${attemptId}`)).body.attempt.score,3);pass('Manual grading recalculates totals');
  const before=(await teacher.request(`/teacher/resources/courses/${course}`)).body;
  assert.equal((await teacher.request(`/teacher/resources/courses/${course}`,'PATCH',{is_published:false})).status,200);
  const after=(await teacher.request(`/teacher/resources/courses/${course}`)).body;assert.equal(after.price,before.price);assert.equal(after.slug,before.slug);pass('Partial edits preserve omitted fields');
  await teacher.request(`/teacher/resources/courses/${course}`,'PATCH',{is_published:true});
  await connection.query('INSERT INTO exam_attempts(student_id,exam_id,score,max_score,percent,submitted_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))',[1,exam,100,100,100]);
  const dashboard=(await teacher.request('/teacher/dashboard')).body;
  assert.equal(Number(dashboard.stats.attempts),1);assert.equal(Math.round(Number(dashboard.stats.average)),60);
  assert(dashboard.latest_attempts.every(entry=>entry.student_id!==1));pass('Teacher dashboard excludes instructor practice attempts from student results');
  const profile=(await a.request('/auth/me')).body.user;await a.request('/auth/profile','PATCH',{city:'القاهرة'});assert.equal((await a.request('/auth/me')).body.user.phone,profile.phone);pass('Profile updates preserve phone and personal data');
  const report=await teacher.request('/teacher/students/2/report-link','POST',{start:'2026-01-01',end:'2027-01-01'});assert.equal(report.status,200);
  assert.equal((await anon.request(report.body.path)).status,200);pass('Secret parent report links work without exposing account credentials');
  const legacyToken='a'.repeat(30)+'_-';await connection.query("INSERT INTO parent_report_views(student_id,week_start,week_end,token) VALUES (2,'2026-01-01','2027-01-01',?)",[legacyToken]);
  assert.equal((await anon.request(`/report/parent/${legacyToken}`)).status,200);pass('Imported Django URL-safe report tokens remain usable');
  const oldCookie=a.cookies.get('session');await a.request('/auth/logout','POST',{});a.cookies.set('session',oldCookie);assert.equal((await a.request('/auth/me')).body.user,null);pass('Logout revokes a captured session token');
  const devices=[client(),client(),client()];for(const device of devices)assert.equal((await device.request('/auth/login','POST',{username:'legacy',password})).status,200);
  assert.equal((await devices[0].request('/auth/me')).body.user,null);assert((await devices[2].request('/auth/me')).body.user);pass('Only two student devices remain active');
  // A capture attempt bans the student at once, signs out every device and locks this browser until the teacher acts.
  // The two reports race: whichever arrives after the session is revoked is handled as a guest (device lock only).
  const reports=await Promise.all([devices[2].request('/security/record-violation','POST',{type:'screenshot'}),devices[2].request('/security/record-violation','POST',{type:'screen_selection'})]);
  assert(reports.every(result=>result.status===200&&['banned','locked'].includes(result.body.status)));assert(reports.some(result=>result.body.status==='banned'));
  const [strikes]=await connection.query('SELECT screenshot_strikes,is_security_banned,locked_until FROM users WHERE id=2');
  assert(strikes[0].screenshot_strikes>=1);assert.equal(strikes[0].is_security_banned,1);assert(strikes[0].locked_until);
  assert.equal((await devices[2].request('/auth/me')).body.user,null);assert.equal((await devices[1].request('/auth/me')).body.user,null);
  assert.equal((await devices[2].request('/auth/login','POST',{username:'legacy',password})).status,423);
  const lockedGuest=client();assert.equal((await lockedGuest.request('/security/record-violation','POST',{type:'screenshot'})).body.status,'locked');
  assert.equal((await lockedGuest.request('/auth/login','POST',{username:'legacy',password:'wrong-password'})).status,401);
  assert.equal((await lockedGuest.request('/auth/login','POST',{username:'instructor',password})).status,200);
  assert.equal((await lockedGuest.request('/auth/security-lock')).body.remaining_seconds,0);pass('A device lock never keeps the teacher out, and the teacher signing in ends it');
  assert.equal((await client().request('/auth/login','POST',{username:'legacy',password})).status,403);
  assert.equal((await teacher.request('/teacher/students/2/unban','POST',{})).status,200);
  assert.equal((await devices[2].request('/auth/security-lock')).body.remaining_seconds,0);
  assert.equal((await devices[2].request('/auth/login','POST',{username:'legacy',password})).status,200);
  assert.equal((await devices[2].request(`/lessons/${lesson}`)).status,200);pass('Capture attempts ban and sign out the student; the teacher unban restores access');
  const newPassword=randomBytes(18).toString('base64url');
  const updated=await devices[2].request('/auth/password','POST',{current_password:password,password:newPassword});assert.equal(updated.status,200,JSON.stringify(updated.body));
  assert((await devices[2].request('/auth/me')).body.user);
  assert.equal((await devices[1].request('/auth/me')).body.user,null);
  assert.equal((await anon.request('/auth/login','POST',{username:'legacy',password})).status,401);
  assert.equal((await anon.request('/auth/login','POST',{username:'legacy',password:newPassword})).status,200);pass('Changing password preserves the current session and revokes other devices atomically');
  console.log(`Integration checks passed: ${checks}`);
}catch(error){console.error(log);throw error;}finally{
  if(server){server.kill();await new Promise(r=>setTimeout(r,300));}
  await connection?.end();
  if(/^mudarris_test_[a-f0-9]{10}$/.test(dbName)){
    await admin.query(`REVOKE ALL PRIVILEGES ON \`${dbName}\`.* FROM 'mudarris_app'@'127.0.0.1'`);
    await admin.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
  }
  await admin.end();
}
