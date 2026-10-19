import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
const root=fileURLToPath(new URL('../',import.meta.url));dotenv.config({path:path.join(root,'.env')});
const mapping={grade:'grades',user:'users',course:'courses',lecture:'lectures',lesson:'lessons',attachment:'attachments',enrollment:'enrollments',accesscode:'access_codes',lessonprogress:'lesson_progress',exam:'exams',question:'questions',choice:'choices',examattempt:'exam_attempts',attemptanswer:'attempt_answers',announcement:'announcements',testimonial:'testimonials',contactmessage:'contact_messages',studentdevice:'student_devices',parentreportview:'parent_report_views'};
const source=new DatabaseSync(path.join(root,'.local/source-snapshot.sqlite3'),{readOnly:true});
const conn=await mysql.createConnection({host:process.env.MYSQL_HOST,port:Number(process.env.MYSQL_PORT),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE,timezone:'+00:00'});
const counts={},mismatches=[];let checked=0,mediaCount=0;
function normalized(value,type){if(value===null)return null;if(type.startsWith('datetime')||type==='date'){let text=value instanceof Date?value.toISOString():String(value).replace(' ','T');if(!/(?:Z|[+-]\d\d:\d\d)$/i.test(text))text+='Z';return new Date(text).toISOString();}return String(value);}
try{
  for(const [model,table] of Object.entries(mapping)){
    const old=source.prepare(`SELECT * FROM academy_${model}`).all();const [current]=await conn.query(`SELECT * FROM \`${table}\``);const [columns]=await conn.query(`SHOW COLUMNS FROM \`${table}\``);const types=new Map(columns.map(c=>[c.Field,c.Type]));const byId=new Map(current.map(r=>[String(r.id),r]));
    counts[table]={source:old.length,target:current.length};if(old.length!==current.length)mismatches.push(`${table}: row counts differ`);
    for(const row of old){const target=byId.get(String(row.id));if(!target){mismatches.push(`${table}: missing id ${row.id}`);continue;}for(const [key,value] of Object.entries(row)){
      if(model==='user'&&key==='active_session_key'||model==='studentdevice'&&['session_key','is_active'].includes(key))continue;
      if(!types.has(key)){mismatches.push(`${table}: unmapped field ${key}`);continue;}
      checked++;if(normalized(value,types.get(key))!==normalized(target[key],types.get(key)))mismatches.push(`${table}.${key}: mismatch at id ${row.id}`);
    }}
  }
  async function walk(directory,prefix=''){for(const entry of await fs.readdir(directory,{withFileTypes:true})){const relative=path.join(prefix,entry.name);if(entry.isDirectory())await walk(path.join(directory,entry.name),relative);else if(entry.isFile()){
    const original=await fs.readFile(path.join(directory,entry.name));let migrated;try{migrated=await fs.readFile(path.join(root,'apps/api/uploads',relative));}catch{mismatches.push(`media: missing ${relative}`);continue;}
    if(createHash('sha256').update(original).digest('hex')!==createHash('sha256').update(migrated).digest('hex'))mismatches.push(`media: mismatch ${relative}`);mediaCount++;
  }}}
  await walk(path.resolve(root,'../mudarris-platform/pro/media'));
  const result={checked_at:new Date(),counts,fields_checked:checked,media_files_checked:mediaCount,mismatches};
  await fs.writeFile(path.join(root,'.local/import-verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({tables:Object.keys(counts).length,rows:Object.values(counts).reduce((n,c)=>n+c.target,0),fields_checked:checked,media_files_checked:mediaCount,mismatches},null,2));
  if(mismatches.length)process.exitCode=1;
}finally{source.close();await conn.end();}
