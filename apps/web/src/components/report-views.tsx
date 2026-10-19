'use client';
import {useData,date,type Row} from '@/lib/client';
import {DataTable,Status} from './ui';
export function ReportViews({studentId}:{studentId:string}){const query=useData(`/teacher/students/${studentId}/report`);return <section className="panel"><h2>متابعة اطلاع أولياء الأمور</h2><Status {...query} retry={query.reload}/>{query.data&&<DataTable headers={['المستلم','الفترة','المشاهدات','آخر مشاهدة']}>{query.data.views.map((v:Row)=><tr key={v.id}><td>{({parent:'الأب',mother:'الأم',student:'الطالب',general:'عام'} as Row)[v.recipient_role]}</td><td>{new Date(v.week_start).toLocaleDateString('ar-EG')} — {new Date(v.week_end).toLocaleDateString('ar-EG')}</td><td>{v.view_count}</td><td>{date(v.last_viewed_at)}</td></tr>)}</DataTable>}</section>;}
