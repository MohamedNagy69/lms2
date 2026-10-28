'use client';

import Link from 'next/link';
import {useRef,useState,type FormEvent} from 'react';
import {api,post,useAction,useData,type Row} from '@/lib/client';
import {BrandIcon} from './brand-icon';
import {Notice,Status} from './ui';
import {DeleteDialog,type DeleteTarget} from './delete-dialog';

// Course builder: every lecture with its lessons on one page. Lectures are added by name, lessons by name plus a
// video link (YouTube or Drive is detected automatically) or an uploaded file, and order is managed with arrows.

type Source={video_source:'youtube'|'drive';youtube_id?:string;drive_url?:string};
// Recognises what a teacher pastes: a YouTube or Drive link, or the full <iframe> embed code either site offers.
// The value is sent as pasted; the server extracts and stores the clean link (see apps/api/src/lib/video-links.ts).
function detectSource(link:string):Source|null{
  const value=link.trim();
  if(!value)return null;
  const source=value.match(/src\s*=\s*["']([^"']+)["']/i)?.[1]||value;
  if(/(?:youtube(?:-nocookie)?\.com|youtu\.be)\//i.test(source)||/^[\w-]{11}$/.test(source))return {video_source:'youtube',youtube_id:value};
  if(/(?:drive|docs)\.google\.com\//i.test(source))return {video_source:'drive',drive_url:value};
  return null;
}
const isEmbedCode=(value:string)=>/<iframe/i.test(value);
const sourceLabel:Record<string,string>={youtube:'يوتيوب',drive:'جوجل درايف',file:'فيديو مرفوع'};

export function CourseBuilder({courseId}:{courseId:string}){
  const outline=useData<{course:Row;lectures:Row[]}>(`/teacher/courses/${courseId}/outline`),action=useAction();
  const [newLecture,setNewLecture]=useState(''),[newLectureHint,setNewLectureHint]=useState(false),[open,setOpen]=useState<Record<number,boolean>>({}),newLectureInput=useRef<HTMLInputElement>(null);
  const [selected,setSelected]=useState<{lectures:number[];lessons:number[]}>({lectures:[],lessons:[]}),[deleting,setDeleting]=useState<DeleteTarget|null>(null);
  if(!outline.data)return <Status {...outline} retry={outline.reload}/>;
  const {lectures}=outline.data,lessonCount=lectures.reduce((n,l)=>n+l.lessons.length,0);
  const run=(task:()=>Promise<unknown>,done:string)=>void action.run(task,done).then(r=>{if(r)outline.reload();});
  const isOpen=(lectureId:number)=>open[lectureId]??true;

  // The button stays active: pressed with an empty name, it points the teacher at the field instead of doing nothing.
  const addLecture=(event:FormEvent)=>{event.preventDefault();const title=newLecture.trim();
    if(!title){setNewLectureHint(true);newLectureInput.current?.focus();return;}
    setNewLectureHint(false);
    run(()=>post('/teacher/resources/lectures',{course_id:Number(courseId),title,order:lectures.length+1}),'تمت إضافة المحاضرة');setNewLecture('');};
  const move=(resource:'lectures'|'lessons',parentId:number,items:Row[],index:number,step:number)=>{
    const ids=items.map(item=>item.id),target=index+step;if(target<0||target>=ids.length)return;
    [ids[index],ids[target]]=[ids[target],ids[index]];
    run(()=>post('/teacher/reorder',{resource,parent_id:parentId,ids}),'تم تحديث الترتيب');
  };
  // Delete goes through the confirmation dialog, which lists everything that goes with the item (lessons, attachments,
  // quizzes…). Lessons inside a selected lecture are dropped from the selection since the lecture takes them anyway.
  const remove=(resource:'lectures'|'lessons',item:Row)=>setDeleting({groups:[{resource,ids:[item.id]}],title:`${resource==='lectures'?'محاضرة':'درس'} «${item.title}»`});
  const toggle=(resource:'lectures'|'lessons',itemId:number)=>setSelected(s=>({...s,[resource]:s[resource].includes(itemId)?s[resource].filter(x=>x!==itemId):[...s[resource],itemId]}));
  const coveredLessons=new Set(lectures.filter(l=>selected.lectures.includes(l.id)).flatMap(l=>l.lessons.map((x:Row)=>x.id)));
  const selectedLessons=selected.lessons.filter(x=>!coveredLessons.has(x)),selectedCount=selected.lectures.length+selectedLessons.length;
  const selectionText=[selected.lectures.length&&`${selected.lectures.length} محاضرة`,selectedLessons.length&&`${selectedLessons.length} درس`].filter(Boolean).join(' و');
  const allSelected=lectures.length>0&&selected.lectures.length===lectures.length;
  const removeSelected=()=>setDeleting({groups:[{resource:'lectures',ids:selected.lectures},{resource:'lessons',ids:selectedLessons}],title:selectionText});
  const rename=(resource:'lectures'|'lessons',item:Row,title:string)=>{const next=title.trim();if(!next||next===item.title)return;
    run(()=>api(`/teacher/resources/${resource}/${item.id}`,{method:'PATCH',body:JSON.stringify({title:next})}),'تم حفظ الاسم');};

  return <section className="builder" aria-label="محتوى الكورس">
    <div className="builder-head">
      <div><span className="eyebrow">محتوى الكورس</span><h2>المحاضرات والدروس</h2><p className="muted">{lectures.length} محاضرة · {lessonCount} درس. اضغط على أي اسم عشان تعدّله.</p></div>
      {lectures.length>1&&<button type="button" className="secondary" onClick={()=>setOpen(Object.fromEntries(lectures.map(l=>[l.id,!lectures.every(x=>isOpen(x.id))])))}>{lectures.every(l=>isOpen(l.id))?'طيّ الكل':'فتح الكل'}</button>}
    </div>
    {lectures.length>0&&<div className={`builder-selection${selectedCount?' has-selection':''}`}>
      <label className="check"><input type="checkbox" checked={allSelected} ref={el=>{if(el)el.indeterminate=!allSelected&&selectedCount>0;}} onChange={()=>setSelected(allSelected?{lectures:[],lessons:[]}:{lectures:lectures.map(l=>l.id),lessons:[]})}/>تحديد الكل</label>
      <span className="muted">{selectedCount?`محدد: ${selectionText}`:'علّم على المحاضرات أو الدروس اللي عاوز تحذفها مرة واحدة.'}</span>
      {selectedCount>0&&<><button type="button" className="danger" disabled={action.busy} onClick={removeSelected}>حذف المحدد ({selectedCount})</button><button type="button" className="text-button" onClick={()=>setSelected({lectures:[],lessons:[]})}>إلغاء التحديد</button></>}
    </div>}
    <Notice {...action}/>
    {!lectures.length&&<div className="builder-empty"><BrandIcon kind="book"/><div><strong>ابدأ بأول محاضرة</strong><p>اكتب اسم المحاضرة تحت واضغط Enter، وبعدها ضيف الدروس جواها.</p></div></div>}
    <ol className="builder-lectures">{lectures.map((lecture,index)=><li key={lecture.id} className={`builder-lecture${isOpen(lecture.id)?' is-open':''}`}>
      <header>
        <input type="checkbox" className="builder-check" checked={selected.lectures.includes(lecture.id)} onChange={()=>toggle('lectures',lecture.id)} aria-label={`تحديد محاضرة ${lecture.title}`}/>
        <button type="button" className="builder-toggle" onClick={()=>setOpen(o=>({...o,[lecture.id]:!isOpen(lecture.id)}))} aria-expanded={isOpen(lecture.id)} aria-label={isOpen(lecture.id)?'طيّ المحاضرة':'فتح المحاضرة'}><span className="builder-index">{index+1}</span></button>
        <InlineTitle value={lecture.title} label="اسم المحاضرة" onSave={title=>rename('lectures',lecture,title)} disabled={action.busy}/>
        <span className="builder-count">{lecture.lessons.length} درس</span>
        <div className="builder-tools">
          <button type="button" className="icon-button" disabled={action.busy||index===0} onClick={()=>move('lectures',Number(courseId),lectures,index,-1)} aria-label="نقل المحاضرة لفوق">↑</button>
          <button type="button" className="icon-button" disabled={action.busy||index===lectures.length-1} onClick={()=>move('lectures',Number(courseId),lectures,index,1)} aria-label="نقل المحاضرة لتحت">↓</button>
          <button type="button" className="icon-button danger" disabled={action.busy} onClick={()=>remove('lectures',lecture)} aria-label="حذف المحاضرة">✕</button>
        </div>
      </header>
      {isOpen(lecture.id)&&<div className="builder-body">
        {lecture.lessons.length>0&&<ol className="builder-lessons">{lecture.lessons.map((lesson:Row,lessonIndex:number)=><li key={lesson.id} className={selected.lectures.includes(lecture.id)||selected.lessons.includes(lesson.id)?'is-selected':undefined}>
          <input type="checkbox" className="builder-check" checked={selected.lectures.includes(lecture.id)||selected.lessons.includes(lesson.id)} disabled={selected.lectures.includes(lecture.id)} onChange={()=>toggle('lessons',lesson.id)} aria-label={`تحديد درس ${lesson.title}`}/>
          <span className={`builder-source source-${lesson.video_source}`} title={sourceLabel[lesson.video_source]}><BrandIcon kind="play"/></span>
          <InlineTitle value={lesson.title} label="اسم الدرس" onSave={title=>rename('lessons',lesson,title)} disabled={action.busy}/>
          <span className="builder-tags">
            <span className="builder-tag">{sourceLabel[lesson.video_source]}</span>
            {!lesson.has_video&&<span className="builder-tag is-warn">بدون فيديو</span>}
            {lesson.video_source==='drive'&&lesson.video_import_status!=='failed'&&<span className="builder-tag" title="بيتنزّل من درايف ويتشفّر على السيرفر عشان برامج التحميل متقدرش تلقطه">جارٍ التحويل لنسخة محمية</span>}
            {lesson.video_source==='drive'&&lesson.video_import_status==='failed'&&<><span className="builder-tag is-warn" title={lesson.video_import_error||undefined}>فشل التحويل — الطلاب مش هيشوفوه</span>{lesson.video_import_error&&<small className="builder-import-error">{lesson.video_import_error}</small>}</>}
            {Boolean(lesson.is_preview)&&<span className="builder-tag is-free">معاينة مجانية</span>}
            {lesson.attachments_count>0&&<span className="builder-tag">{lesson.attachments_count} مرفق</span>}
          </span>
          <div className="builder-tools">
            <button type="button" className="icon-button" disabled={action.busy||lessonIndex===0} onClick={()=>move('lessons',lecture.id,lecture.lessons,lessonIndex,-1)} aria-label="نقل الدرس لفوق">↑</button>
            <button type="button" className="icon-button" disabled={action.busy||lessonIndex===lecture.lessons.length-1} onClick={()=>move('lessons',lecture.id,lecture.lessons,lessonIndex,1)} aria-label="نقل الدرس لتحت">↓</button>
            <Link className="icon-button" href={`/teacher/lessons/${lesson.id}/edit`} aria-label="تعديل كل بيانات الدرس" title="تعديل كل البيانات">✎</Link>
            <Link className="icon-button" href={`/teacher/lessons/${lesson.id}`} aria-label="المرفقات والكويزات" title="المرفقات والكويزات"><BrandIcon kind="file"/></Link>
            <button type="button" className="icon-button danger" disabled={action.busy} onClick={()=>remove('lessons',lesson)} aria-label="حذف الدرس">✕</button>
          </div>
        </li>)}</ol>}
        <LessonQuickAdd lectureId={lecture.id} nextOrder={lecture.lessons.length+1} busy={action.busy} run={run}/>
      </div>}
    </li>)}</ol>
    <form className={`builder-new-lecture${newLectureHint?' needs-name':''}`} onSubmit={addLecture} onClick={event=>{if(event.target===event.currentTarget)newLectureInput.current?.focus();}}>
      <label htmlFor="builder-new-lecture-name" className="builder-new-lecture-label"><span className="builder-index is-new" aria-hidden="true">+</span>محاضرة جديدة</label>
      <input id="builder-new-lecture-name" ref={newLectureInput} value={newLecture} onChange={e=>{setNewLecture(e.target.value);if(e.target.value.trim())setNewLectureHint(false);}} placeholder="اكتب اسم المحاضرة هنا، مثال: المحاضرة الثانية: الفعل وأنواعه" maxLength={150} disabled={action.busy} aria-describedby={newLectureHint?'builder-new-lecture-hint':undefined}/>
      <button disabled={action.busy}>إضافة محاضرة</button>
      {newLectureHint&&<small id="builder-new-lecture-hint" className="builder-new-lecture-hint" role="alert">اكتب اسم المحاضرة الأول في الخانة، وبعدين اضغط «إضافة محاضرة» أو Enter.</small>}
    </form>
    {deleting&&<DeleteDialog target={deleting} onClose={()=>setDeleting(null)} onDeleted={message=>{setDeleting(null);setSelected({lectures:[],lessons:[]});action.setNotice(message);outline.reload();}}/>}
  </section>;
}

// Click-to-edit title: saves on Enter or when the field loses focus, Escape cancels.
function InlineTitle({value,label,onSave,disabled}:{value:string;label:string;onSave:(title:string)=>void;disabled?:boolean}){
  const [draft,setDraft]=useState<string|null>(null);
  if(draft===null)return <button type="button" className="builder-title" onClick={()=>setDraft(value)} disabled={disabled} title="اضغط للتعديل">{value}</button>;
  const finish=()=>{onSave(draft);setDraft(null);};
  return <input className="builder-title-input" autoFocus aria-label={label} value={draft} maxLength={150} onChange={e=>setDraft(e.target.value)} onBlur={finish} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();finish();}if(e.key==='Escape')setDraft(null);}}/>;
}

// Adds one lesson (name + link or uploaded video) or many at once (one "name | link" per line).
function LessonQuickAdd({lectureId,nextOrder,busy,run}:{lectureId:number;nextOrder:number;busy:boolean;run:(task:()=>Promise<unknown>,done:string)=>void}){
  const [mode,setMode]=useState<'closed'|'single'|'bulk'>('closed'),[title,setTitle]=useState(''),[link,setLink]=useState(''),[file,setFile]=useState(''),[preview,setPreview]=useState(false),[bulk,setBulk]=useState(''),[error,setError]=useState(''),[uploading,setUploading]=useState(false);
  const source=detectSource(link);
  const reset=()=>{setTitle('');setLink('');setFile('');setPreview(false);setBulk('');setError('');};

  const upload=async(selected:File|undefined)=>{if(!selected)return;setUploading(true);setError('');
    try{const body=new FormData();body.set('file',selected);const result=await api<{path:string}>('/teacher/uploads/videos',{method:'POST',body});setFile(result.path);setLink('');if(!title)setTitle(selected.name.replace(/\.[^.]+$/,''));}
    catch(e){setError(e instanceof Error?e.message:'تعذر رفع الفيديو');}finally{setUploading(false);}};

  const addSingle=(event:FormEvent)=>{event.preventDefault();setError('');
    if(!title.trim()){setError('اكتب اسم الدرس');return;}
    const video=file?{video_source:'file',video_file:file}:source;
    if(!video){setError(link.trim()?'الرابط ده مش يوتيوب ولا جوجل درايف':'حط رابط الفيديو أو ارفع ملف');return;}
    run(()=>post('/teacher/resources/lessons',{lecture_id:lectureId,title:title.trim(),order:nextOrder,is_preview:preview,...video}),'تمت إضافة الدرس');reset();setMode('closed');};

  const lines=bulk.split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{const [name,...rest]=line.split('|');return {title:(name||'').trim(),link:rest.join('|').trim()};});
  const invalid=lines.findIndex(line=>!line.title||!detectSource(line.link));
  const addBulk=(event:FormEvent)=>{event.preventDefault();setError('');
    if(!lines.length){setError('اكتب درس واحد على الأقل');return;}
    if(invalid>=0){setError(`السطر ${invalid+1}: لازم يبقى «اسم الدرس | رابط يوتيوب أو درايف»`);return;}
    // Returns the count so the builder sees a result and reloads the outline.
    run(async()=>{for(const [index,line] of lines.entries())await post('/teacher/resources/lessons',{lecture_id:lectureId,title:line.title,order:nextOrder+index,...detectSource(line.link)});return lines.length;},`تمت إضافة ${lines.length} درس`);
    reset();setMode('closed');};

  if(mode==='closed')return <div className="builder-add-lesson"><button type="button" className="secondary" onClick={()=>setMode('single')} disabled={busy}>+ إضافة درس</button><button type="button" className="text-button" onClick={()=>setMode('bulk')} disabled={busy}>إضافة كذا درس مرة واحدة</button></div>;
  return <div className="builder-lesson-form">
    <div className="builder-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={mode==='single'} className={mode==='single'?'is-active':''} onClick={()=>setMode('single')}>درس واحد</button>
      <button type="button" role="tab" aria-selected={mode==='bulk'} className={mode==='bulk'?'is-active':''} onClick={()=>setMode('bulk')}>كذا درس</button>
      <button type="button" className="text-button builder-cancel" onClick={()=>{reset();setMode('closed');}}>إلغاء</button>
    </div>
    {error&&<div className="notice error" role="alert">{error}</div>}
    {mode==='single'?<form className="builder-single" onSubmit={addSingle}>
      <label>اسم الدرس<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={150} autoFocus placeholder="مثال: الفاعل ونائب الفاعل"/></label>
      <label>رابط الفيديو أو كود التضمين<input dir="ltr" value={link} onChange={e=>{setLink(e.target.value);setFile('');}} placeholder="https://youtu.be/… أو https://drive.google.com/… أو <iframe …>" maxLength={2000} disabled={Boolean(file)}/>
        <small className={`builder-detect${source?' is-ok':link.trim()?' is-bad':''}`}>{file?'هيتستخدم الفيديو المرفوع':source?`✓ ${sourceLabel[source.video_source]}${isEmbedCode(link)?' (كود تضمين)':''}`:link.trim()?'الرابط ده مش يوتيوب ولا جوجل درايف':'الصق رابط يوتيوب أو جوجل درايف أو كود التضمين، أو ارفع فيديو'}</small></label>
      <div className="builder-upload">
        <label className="button secondary">{uploading?'جارٍ رفع الفيديو وتشفيره…':file?'✓ تم رفع الفيديو — تغيير':'أو ارفع فيديو من جهازك'}<input type="file" accept="video/*,.mkv,.mov,.m4v,.avi" hidden disabled={uploading||busy} onChange={e=>void upload(e.target.files?.[0])}/></label>
        <label className="check"><input type="checkbox" checked={preview} onChange={e=>setPreview(e.target.checked)}/>معاينة مجانية للزوار</label>
      </div>
      <button disabled={busy||uploading}>إضافة الدرس</button>
    </form>:<form className="builder-bulk" onSubmit={addBulk}>
      <label>كل درس في سطر: اسم الدرس | رابط الفيديو
        <textarea dir="auto" value={bulk} onChange={e=>setBulk(e.target.value)} rows={6} autoFocus placeholder={'المبتدأ والخبر | https://youtu.be/xxxxxxxxxxx\nكان وأخواتها | https://drive.google.com/file/d/…/view'}/></label>
      <small className="muted">{lines.length?`${lines.length} درس جاهز للإضافة${invalid>=0?` — راجع السطر ${invalid+1}`:''}`:'الدروس هتتضاف بنفس ترتيب السطور.'}</small>
      <button disabled={busy||!lines.length}>إضافة الدروس</button>
    </form>}
  </div>;
}
