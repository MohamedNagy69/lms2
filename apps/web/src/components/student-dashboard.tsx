'use client';

import Link from 'next/link';
import {useAuth,useData,date,type Row} from '@/lib/client';
import {BrandIcon} from './brand-icon';
import {CourseCard,Empty,Heading,Status} from './ui';

export function Dashboard(){
  const query=useData('/dashboard'),{user}=useAuth();
  if(!query.data)return <Status {...query} retry={query.reload}/>;
  const {courses,results,announcements,pending,exams,stats}=query.data;
  const metrics=[
    ['كورساتك',stats.courses,'المقررات المشترك بها','book'],
    ['دروس مكتملة',stats.lessons_done,'تقدمك حتى الآن','check'],
    ['امتحانات منجزة',stats.exams_done,'محاولات تم تسليمها','file'],
    ['متوسط النتائج',`${Math.round(Number(stats.avg||0))}%`,'تابع تطور مستواك','chart'],
  ];
  return <div className="student-overview">
    <Heading title={`أهلًا، ${user?.first_name||user?.username||'بك'}`} subtitle="مساحتك للتعلّم والمتابعة"><Link className="button" href="/courses">استكشف المقررات <BrandIcon kind="arrow"/></Link></Heading>
    <div className="overview-welcome"><div><span className="eyebrow">كل خطوة بتفرق</span><h2>كمّل طريقك. <em>هدفك أقرب.</em></h2><p>اختار درسًا، راجع فهمك، وشوف أثر مجهودك في النتائج.</p></div><Link className="button secondary" href="/my-report">تقرير تقدّمك <BrandIcon kind="arrow"/></Link><span className="welcome-orbit" aria-hidden="true"/></div>
    <div className="overview-metrics">{metrics.map(([label,value,meta,icon])=><article className="metric-card" key={label}><div className="row between"><span>{label}</span><BrandIcon kind={icon}/></div><strong>{value}</strong><small>{meta}</small></article>)}</div>

    {pending.length>0&&<section className="panel"><div className="dashboard-panel-head"><div><span className="eyebrow">طلبات الاشتراك</span><h2>في انتظار التفعيل</h2></div><span className="badge">{pending.length} طلب</span></div>{pending.map((item:Row)=><div className="lesson-row" key={item.id}><span>{item.title}</span><span className="badge">قيد المراجعة</span></div>)}</section>}

    <div className="student-dashboard-grid"><section className="panel student-dashboard-list"><div className="dashboard-panel-head"><div><span className="eyebrow">متابعة التعلّم</span><h2>كورساتك الحالية</h2></div><Link href="/courses">كل المقررات ←</Link></div>{courses.length?<div className="grid">{courses.map((course:Row)=><CourseCard key={course.id} course={course}/>)}</div>:<Empty><p>لم تشترك في كورس بعد.</p><Link className="button" href="/courses">اختر أول مقرر</Link></Empty>}</section>
      <section className="panel"><div className="dashboard-panel-head"><div><span className="eyebrow">خطوتك التالية</span><h2>امتحانات وتدريب</h2></div><Link href="/exams">عرض الكل ←</Link></div>{exams.length?exams.slice(0,4).map((exam:Row)=><div className="lesson-row" key={exam.id}><div><strong>{exam.title}</strong><small className="muted">{exam.course_title} · {exam.duration_minutes} دقيقة</small></div><Link className="eyebrow" href={`/exam/${exam.id}/start`}>ابدأ ←</Link></div>):<div className="calm-empty"><BrandIcon kind="check"/><div><strong>مساحتك جاهزة</strong><p>ستظهر الامتحانات المتاحة هنا.</p></div></div>}</section></div>

    <div className="student-dashboard-actions"><section className="panel"><div className="dashboard-panel-head"><div><span className="eyebrow">سجل التقدّم</span><h2>آخر النتائج</h2></div><Link href="/results">السجل كامل ←</Link></div>{results.length?results.map((result:Row)=><div className="lesson-row" key={result.id}><div><strong>{result.title}</strong><small className="muted">{date(result.submitted_at)}</small></div><Link className="badge" href={`/attempt/${result.id}/result`}>{Math.round(Number(result.percent||0))}% ←</Link></div>):<Empty>ستظهر نتائجك بعد أول امتحان.</Empty>}</section>
      <section className="panel"><div className="dashboard-panel-head"><div><span className="eyebrow">من المنصة</span><h2>الإعلانات</h2></div></div>{announcements.length?announcements.map((item:Row)=><article className="lesson-row" key={item.id}><div><strong>{item.title}</strong><p className="muted prose">{item.body}</p><small className="muted">{date(item.created_at)}</small></div></article>):<Empty>لا توجد إعلانات جديدة.</Empty>}</section></div>
  </div>;
}
