'use client';
import {useData,type Row} from '@/lib/client';
import {useSearchParams} from 'next/navigation';

export function ReportAnswers({studentId,token}:{studentId?:string;token?:string}){
  const search=useSearchParams();
  const path=token?`/report/parent/${token}`:studentId?`/teacher/students/${studentId}/report`:'/my-report';
  const queryString=search.toString()||'offset=0';
  const query=useData(`${path}${token?'':`?${queryString}`}`);
  if(query.loading||query.error)return null;
  const results=query.data?.results||[];
  if(!results.length||!results.some((result:Row)=>result.answers?.length))return null;
  return <section className="panel"><h3>تفاصيل إجابات الامتحانات</h3>{results.map((result:Row)=><details key={result.id}><summary>{result.title||result.exam_title} · {result.percent}% {result.is_passed?'✅':'❌'}</summary><div className="prose">{result.answers.map((answer:Row)=><p key={answer.id}><b>{answer.text}</b><br/>إجابة الطالب: {answer.choice_text||answer.text_answer||'لم تتم الإجابة'}{answer.correct_text&&<><br/>الإجابة الصحيحة: {answer.correct_text}</>}{answer.teacher_feedback&&<><br/>ملاحظات المدرس: {answer.teacher_feedback}</>}</p>)}</div></details>)}</section>;
}
