import {parseArgs} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs/promises';
import {db,pool,transaction} from '../db/index.js';
const mapping:Record<string,string>={grade:'grades',user:'users',course:'courses',lecture:'lectures',lesson:'lessons',attachment:'attachments',enrollment:'enrollments',accesscode:'access_codes',lessonprogress:'lesson_progress',exam:'exams',question:'questions',choice:'choices',examattempt:'exam_attempts',attemptanswer:'attempt_answers',announcement:'announcements',testimonial:'testimonials',contactmessage:'contact_messages',studentdevice:'student_devices',parentreportview:'parent_report_views'};
const relations:Record<string,string>={grade_id:'grade',course_id:'course',lecture_id:'lecture',lesson_id:'lesson',student_id:'user',used_by_id:'user',exam_id:'exam',question_id:'question',choice_id:'choice',attempt_id:'examattempt'};
const {values}=parseArgs({options:{sqlite:{type:'string'},json:{type:'string'}}});
if(Boolean(values.sqlite)===Boolean(values.json))throw new Error('Specify exactly one of --sqlite path or --json Django-fixture.json');
let source:DatabaseSync|undefined;
try{
  const data:Record<string,Record<string,any>[]>={};
  if(values.sqlite){
    source=new DatabaseSync(values.sqlite,{readOnly:true});
    const tables=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    for(const model of Object.keys(mapping))data[model]=tables.has(`academy_${model}`)?source.prepare(`SELECT * FROM academy_${model}`).all():[];
  }else{
    const fixture=JSON.parse(await fs.readFile(values.json!,'utf8'));
    if(!Array.isArray(fixture))throw new Error('Expected a Django dumpdata JSON array');
    for(const item of fixture){
      const model=String(item.model).replace(/^academy\./,'');if(!mapping[model])continue;
      const row:Record<string,any>={id:item.pk,...item.fields};
      for(const key of Object.keys(row))if(relations[`${key}_id`]){row[`${key}_id`]=row[key];delete row[key];}
      (data[model]||=[]).push(row);
    }
  }
  // Use a new database only: never merge, truncate, or silently overwrite existing records.
  for(const table of Object.values(mapping))if((await db.one(`SELECT COUNT(*) AS n FROM \`${table}\``))!.n)throw new Error(`Destination table ${table} is not empty. Import into a new database.`);
  const ids:Record<string,Map<string,number>>={};
  for(const model of Object.keys(mapping)){
    const rows=data[model]||[];
    const numeric=rows.every(row=>Number.isSafeInteger(Number(row.id))&&Number(row.id)>0);
    ids[model]=new Map(rows.map((row,i)=>[String(row.id),numeric?Number(row.id):i+1]));
  }
  const counts:Record<string,number>={};
  await transaction(async tx=>{
    for(const [model,table] of Object.entries(mapping)){
      const columns=await tx.rows(`SHOW COLUMNS FROM \`${table}\``);const allowed=new Map(columns.map(c=>[c.Field,c.Type]));
      for(const record of data[model]||[]){
        const row:Record<string,unknown>={id:ids[model]!.get(String(record.id))};
        for(const [key,raw] of Object.entries(record)){
          if(key==='id'||!allowed.has(key))continue;
          let value:any=raw;
          if(relations[key] && raw!==null && raw!==''){
            value=ids[relations[key]!]!.get(String(raw));
            if(!value)throw new Error(`Missing relation ${model}.${key} for source record ${record.id}`);
          }
          if(allowed.get(key)?.startsWith('datetime')&&value){let text=String(value).replace(' ','T');if(!/(?:Z|[+-]\d\d:\d\d)$/i.test(text))text+='Z';const date=new Date(text);if(!Number.isNaN(date.getTime()))value=date;}
          row[key]=value;
        }
        if(model==='user')row.active_session_key='';
        if(model==='studentdevice'){row.is_active=0;row.session_key='';}
        await tx.run(`INSERT INTO \`${table}\` SET ?`,[row]);
      }
      counts[table]=(data[model]||[]).length;
    }
  });
  console.log('Import committed. Source was opened read-only. Row counts:',counts);
  console.log('Copy the media directory into apps/api/uploads. Existing sessions were invalidated.');
}finally{source?.close();await pool.end();}
