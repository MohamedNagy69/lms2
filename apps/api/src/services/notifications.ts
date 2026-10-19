import nodemailer from 'nodemailer';
import {db,transaction} from '../db/index.js';
import {config} from '../config.js';

function escapeHtml(value: unknown){
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]||character));
}

function cleanPhone(value: unknown){
  let phone=String(value||'').replace(/\D/g,'').replace(/^00/,'');
  if(/^01\d{9}$/.test(phone))phone='2'+phone;
  return phone;
}

export async function queueResults(attemptId:number,requeue=false){
  const attempt=await db.one('SELECT a.*,e.title,e.pass_percent,e.auto_send_result,c.title AS course_title,u.first_name,u.last_name,u.username,u.email,u.father_email,u.mother_email,u.telegram_chat_id,u.father_telegram_chat_id,u.mother_telegram_chat_id,u.phone,u.parent_phone,u.mother_phone FROM exam_attempts a JOIN exams e ON e.id=a.exam_id JOIN courses c ON c.id=e.course_id JOIN users u ON u.id=a.student_id WHERE a.id=?',[attemptId]);
  if(!attempt?.submitted_at)return;
  const studentName=(`${attempt.first_name||''} ${attempt.last_name||''}`).trim()||attempt.username;
  const passed=Number(attempt.percent)>=Number(attempt.pass_percent);
  const evaluation=Number(attempt.percent)>=90?'ممتاز بنجاح فائق وتفوق 🌟':Number(attempt.percent)>=75?'جيد جداً بنجاح مميز 👏':passed?'اجتياز بنجاح جيد ✅':'يحتاج لمزيد من المتابعة والتركيز ⚠️';
  const resultUrl=`${config.origin.replace(/\/$/,'')}/attempt/${attempt.id}/result`;
  const submitted=attempt.submitted_at instanceof Date?attempt.submitted_at.toLocaleString('ar-EG'):String(attempt.submitted_at);
  const body=`🎓 ${config.site.site_name} — تقرير نتيجة امتحان\n👨‍🏫 ${config.site.teacher_name} — ${config.site.subject}\n\nالسلام عليكم ورحمة الله وبركاته 🌹\n\n📋 بيانات الطالب والاختبار:\n▫️ اسم الطالب: ${studentName}\n▫️ المادة: ${attempt.course_title}\n▫️ عنوان الاختبار: ${attempt.title}\n▫️ تاريخ الإجراء: ${submitted}\n\n📊 بطاقة النتيجة والتقييم:\n▫️ الدرجة: ${attempt.score} من ${attempt.max_score}\n▫️ النسبة: ${attempt.percent}%\n▫️ الحالة: ${passed?'ناجح ومجتاز للاختبار بنجاح ✅':'لم يحقق نسبة الاجتياز المطلوبة ❌'}\n▫️ التقدير: ${evaluation}\n▫️ نسبة النجاح المطلوبة: ${attempt.pass_percent}%\n\n🛡️ إنذارات جلسة الامتحان: ${attempt.infractions_count}\n🔍 ورقة الإجابة والتصحيح بالتفصيل:\n${resultUrl}\n\nللاستفسار: ${config.site.phone||config.site.whatsapp||'تواصل مع إدارة المنصة'}`;
  const htmlBody=`<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Arial,sans-serif;line-height:1.8;color:#172033"><div style="max-width:620px;margin:auto;border:1px solid #e5e7eb;border-radius:14px;padding:24px"><h2 style="margin-top:0;color:#0f766e">🎓 ${escapeHtml(config.site.site_name)}</h2><p>${escapeHtml(config.site.teacher_name)} — ${escapeHtml(config.site.subject)}</p><hr><p>السلام عليكم ورحمة الله وبركاته 🌹</p><h3>بيانات الطالب والاختبار</h3><p><b>اسم الطالب:</b> ${escapeHtml(studentName)}<br><b>المادة:</b> ${escapeHtml(attempt.course_title)}<br><b>عنوان الاختبار:</b> ${escapeHtml(attempt.title)}<br><b>تاريخ الإجراء:</b> ${escapeHtml(submitted)}</p><h3>بطاقة النتيجة والتقييم</h3><p><b>الدرجة:</b> ${escapeHtml(attempt.score)} من ${escapeHtml(attempt.max_score)}<br><b>النسبة:</b> ${escapeHtml(attempt.percent)}%<br><b>الحالة:</b> ${passed?'ناجح ومجتاز للاختبار بنجاح ✅':'لم يحقق نسبة الاجتياز المطلوبة ❌'}<br><b>التقدير:</b> ${escapeHtml(evaluation)}<br><b>نسبة النجاح المطلوبة:</b> ${escapeHtml(attempt.pass_percent)}%</p><p><b>إنذارات جلسة الامتحان:</b> ${escapeHtml(attempt.infractions_count)}</p><p><a href="${escapeHtml(resultUrl)}" style="display:inline-block;background:#0f766e;color:white;padding:10px 16px;border-radius:8px;text-decoration:none">فتح ورقة الإجابة والتصحيح</a></p><p>${escapeHtml(config.site.phone||config.site.whatsapp)}</p></div></body></html>`;
  const targets:[string,string][]=[];
  if(process.env.SMTP_HOST)for(const email of [attempt.email,attempt.father_email,attempt.mother_email])if(email)targets.push(['email',email]);
  if(process.env.TELEGRAM_BOT_TOKEN)for(const chat of [attempt.telegram_chat_id,attempt.father_telegram_chat_id,attempt.mother_telegram_chat_id,process.env.TEACHER_TELEGRAM_CHAT_ID])if(chat)targets.push(['telegram',chat]);
  if(process.env.ULTRAMSG_INSTANCE_ID&&process.env.ULTRAMSG_TOKEN)for(const phone of [attempt.phone,attempt.parent_phone,attempt.mother_phone]){const p=cleanPhone(phone);if(p)targets.push(['whatsapp',p]);}
  for(const [channel,recipient] of targets)await db.run(`INSERT INTO notification_jobs(attempt_id,channel,recipient,body,html_body) VALUES (?,?,?,?,?)
    ON DUPLICATE KEY UPDATE body=VALUES(body),html_body=VALUES(html_body)${requeue?",status=IF(status='sending',status,'pending'),tries=IF(status='sending',tries,0),sent_at=IF(status='sending',sent_at,NULL),last_error=IF(status='sending',last_error,'')":''}`,[attemptId,channel,recipient,body,htmlBody]);
}
async function deliver(job:Record<string,any>){
  if(job.channel==='email'){
    const transport=nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:process.env.SMTP_SECURE==='1',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:10000,socketTimeout:15000});
    await transport.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to:job.recipient,subject:`نتيجة امتحان — ${config.site.site_name}`,text:job.body,html:job.html_body||undefined});transport.close();return;
  }
  if(job.channel==='telegram'){
    const response=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:job.recipient,text:job.body}),signal:AbortSignal.timeout(15000)});
    const result=await response.json() as {ok?:boolean};if(!response.ok||!result.ok)throw new Error('Telegram rejected the message');return;
  }
  const instance=process.env.ULTRAMSG_INSTANCE_ID||'';
  if(!/^[a-zA-Z0-9_-]+$/.test(instance))throw new Error('Invalid WhatsApp instance');
  const response=await fetch(`https://api.ultramsg.com/${instance}/messages/chat`,{method:'POST',body:new URLSearchParams({token:process.env.ULTRAMSG_TOKEN||'',to:job.recipient,body:job.body}),signal:AbortSignal.timeout(15000)});
  const result=await response.json() as {sent?:string|boolean};if(!response.ok||!(result.sent==='true'||result.sent===true))throw new Error('WhatsApp rejected the message');
}
let processing=false;
export function startNotificationWorker(){
  if(process.env.NOTIFICATIONS_ENABLED!=='1')return;
  const timer=setInterval(async()=>{
    if(processing)return;processing=true;
    try{
      await db.run("UPDATE notification_jobs SET status='pending' WHERE status='sending' AND updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 5 MINUTE)");
      const job=await transaction(async tx=>{
        const row=await tx.one("SELECT * FROM notification_jobs WHERE status IN ('pending','failed') AND tries<3 AND (tries=0 OR updated_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE)) ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED");
        if(row)await tx.run("UPDATE notification_jobs SET status='sending',tries=tries+1 WHERE id=?",[row.id]);return row;
      });
      if(job){try{await deliver(job);await db.run("UPDATE notification_jobs SET status='sent',sent_at=UTC_TIMESTAMP(3),last_error='' WHERE id=?",[job.id]);}catch{await db.run("UPDATE notification_jobs SET status='failed',last_error='Delivery failed; check provider configuration' WHERE id=?",[job.id]);}}
    }catch(error){console.error('Notification worker failed:',(error as {code?:string}).code||'error');}finally{processing=false;}
  },10000);timer.unref();
}
