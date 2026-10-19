import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const envFile=path.join(root,'..','.env');
const text=await fs.readFile(envFile,'utf8').catch(()=> '');
for(const line of text.split(/\r?\n/)){const match=line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^"|"$/g,'');}
const errors=[],warnings=[];
const required=['MYSQL_HOST','MYSQL_PORT','MYSQL_USER','MYSQL_DATABASE','JWT_SECRET','VIDEO_ENCRYPTION_KEY','WEB_ORIGIN'];
for(const key of required)if(!process.env[key]||process.env[key].includes('change-me')||process.env[key].includes('replace-with'))errors.push(`${key} غير مضبوط`);
if((process.env.NODE_ENV||'').toLowerCase()==='production'&&!String(process.env.WEB_ORIGIN||'').startsWith('https://'))errors.push('WEB_ORIGIN يجب أن يبدأ بـ https:// في الإنتاج');
if(String(process.env.JWT_SECRET||'').length<32)errors.push('JWT_SECRET يجب أن يكون 32 حرفًا على الأقل');
if(!/^[a-f0-9]{64}$/i.test(process.env.VIDEO_ENCRYPTION_KEY||''))errors.push('VIDEO_ENCRYPTION_KEY يجب أن يكون 64 حرفًا بالنظام الست عشري');
if(process.env.NOTIFICATIONS_ENABLED==='1'){
  if(!process.env.SMTP_HOST&&!process.env.TELEGRAM_BOT_TOKEN&&!process.env.ULTRAMSG_INSTANCE_ID)warnings.push('الإشعارات مفعلة لكن لا يوجد مزود مضبوط');
  if(process.env.SMTP_HOST&&!process.env.SMTP_FROM)warnings.push('SMTP_FROM غير مضبوط؛ سيتم استخدام SMTP_USER');
}
if(!process.env.UPLOAD_ROOT)warnings.push('UPLOAD_ROOT غير مضبوط؛ سيتم استخدام مجلد uploads المحلي');
if(errors.length){console.error('إعدادات الإنتاج غير مكتملة:');for(const error of errors)console.error(`- ${error}`);process.exitCode=1;}
else {console.log('إعدادات الإنتاج الأساسية سليمة.');for(const warning of warnings)console.warn(`تحذير: ${warning}`);}
