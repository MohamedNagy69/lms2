'use client';

import {useEffect,useRef,useState} from 'react';
import {post} from '@/lib/client';

// Confirmation for deleting one or many items. It asks the server what the delete will take with it (lectures,
// lessons, attachments, exams…) and shows that list before anything is removed. Student results and enrollments come
// back as blockers: the delete button stays off until the teacher ticks the extra confirmation to wipe them too.

const countLabels:[string,string,string][]=[
  ['grades','صف دراسي','صفوف دراسية'],['courses','كورس','كورسات'],['lectures','محاضرة','محاضرات'],['lessons','درس','دروس'],
  ['attachments','مرفق','مرفقات'],['exams','امتحان/كويز','امتحانات وكويزات'],['questions','سؤال','أسئلة'],['choices','اختيار','اختيارات'],
  ['exam_attempts','نتيجة امتحان لطالب','نتائج امتحانات طلاب'],['enrollments','اشتراك طالب','اشتراكات طلاب'],['access_codes','كود اشتراك','أكواد اشتراك'],['lesson_progress','سجل تقدّم طالب','سجلات تقدّم طلاب'],['announcements','إعلان','إعلانات'],['testimonials','رأي طالب','آراء طلاب'],
];
const plural=(n:number,one:string,many:string)=>`${n} ${n===1?one:many}`;

// Several groups (e.g. whole lectures plus single lessons from other lectures) are previewed and deleted together.
export type DeleteTarget={groups:{resource:string;ids:number[]}[];title:string};
type Preview={counts:Record<string,number>;blockers:string[]};

export function DeleteDialog({target,onClose,onDeleted}:{target:DeleteTarget;onClose:()=>void;onDeleted:(message:string)=>void}){
  const [preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[wipeStudents,setWipeStudents]=useState(false),cancel=useRef<HTMLButtonElement>(null);
  const groups=target.groups.filter(g=>g.ids.length),total=groups.reduce((n,g)=>n+g.ids.length,0),key=JSON.stringify(groups);
  useEffect(()=>{let alive=true;setPreview(null);setError('');setWipeStudents(false);
    Promise.all(groups.map(g=>post('/teacher/delete-preview',g) as Promise<Preview>)).then(all=>{if(!alive)return;const counts:Record<string,number>={};for(const p of all)for(const [k,n] of Object.entries(p.counts))counts[k]=(counts[k]||0)+n;setPreview({counts,blockers:all.flatMap(p=>p.blockers)});},e=>{if(alive)setError(e instanceof Error?e.message:'تعذر تجهيز الحذف');});
    return ()=>{alive=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  const close=useRef(onClose);
  useEffect(()=>{close.current=busy?()=>undefined:onClose;});
  useEffect(()=>{cancel.current?.focus();const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')close.current();};window.addEventListener('keydown',onKey);return ()=>window.removeEventListener('keydown',onKey);},[]);

  const lines=preview?countLabels.filter(([k])=>preview.counts[k]).map(([k,one,many])=>({key:k,text:plural(preview.counts[k]!,one,many)})):[];
  const unassigned=preview?.counts.students_unassigned||0;
  const studentData=Boolean(preview?.blockers.length),blocked=studentData&&!wipeStudents;
  const confirm=async()=>{setBusy(true);setError('');
    try{for(const g of groups)await post('/teacher/bulk-delete',{...g,force:studentData&&wipeStudents});onDeleted(total>1?`تم حذف ${total} عناصر وكل المحتوى التابع لها`:'تم الحذف مع كل المحتوى التابع');}
    catch(e){setError(e instanceof Error?e.message:'تعذر الحذف');setBusy(false);}};

  return <div className="delete-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}>
    <div className="delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-body">
      <h2 id="delete-dialog-title">حذف {target.title}؟</h2>
      <div id="delete-dialog-body">
        {!preview&&!error&&<p className="muted">بنحسب المحتوى اللي هيتحذف…</p>}
        {preview&&<>
          <p>الحذف نهائي ومش هينفع ترجّعه. هيتحذف:</p>
          <ul className="delete-dialog-list">{lines.map(line=><li key={line.key}>{line.text}</li>)}</ul>
          {unassigned>0&&<p className="muted">{plural(unassigned,'طالب','طلاب')} هيفضلوا في المنصة بس من غير صف دراسي.</p>}
          <p className="muted">الفيديوهات والملفات المرفوعة التابعة هتتمسح من السيرفر كمان.</p>
        </>}
        {studentData&&<div className="notice error delete-dialog-students" role="alert"><strong>تنبيه: فيه بيانات طلاب هتتمسح معاه:</strong><ul className="delete-dialog-list">{preview!.blockers.map(b=><li key={b}>{b}</li>)}</ul>
          <label className="check"><input type="checkbox" checked={wipeStudents} onChange={e=>setWipeStudents(e.target.checked)} disabled={busy}/>أيوه، امسح نتائج الطلاب واشتراكاتهم كمان. فاهم إنها مش هترجع.</label></div>}
        {error&&<div className="notice error" role="alert">{error}</div>}
      </div>
      <div className="actions">
        <button type="button" className="danger" disabled={!preview||blocked||busy} onClick={()=>void confirm()}>{busy?'جارٍ الحذف…':'احذف نهائيًا'}</button>
        <button type="button" className="secondary" ref={cancel} disabled={busy} onClick={onClose}>إلغاء</button>
      </div>
    </div>
  </div>;
}
