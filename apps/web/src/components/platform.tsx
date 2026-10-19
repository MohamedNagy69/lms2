'use client';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {Protected} from '@/lib/client';
import {Catalog,Course,AccountForm,Contact} from './public-pages';
import {Home} from './home-page';
import {Lesson,Exams,Results,Report} from './student-pages';
import {Dashboard} from './student-dashboard';
import {ExamStart,Attempt} from './exam-pages';
import {Camera} from './camera';
import {Notifications} from './notifications';
import {ReportViews} from './report-views';
import {ReportAnswers} from './report-answers';
import {TeacherDashboard,ResourceList,ResourceEditor,ResourceManage,Students,StudentDetail,Enrollments,Codes,Inbox,TeacherResults,Reports,Security} from './teacher-pages';
const resourceNames=['grades','courses','lectures','lessons','attachments','exams','questions','choices','announcements','testimonials'];
export function Platform(){
  const pathname=usePathname();const segments=pathname.split('/').filter(Boolean).map(s=>decodeURIComponent(s));const [root,a,b,c,d,e]=segments;
  if(!root)return <Home/>;
  if(root==='courses')return <Catalog/>;
  if(root==='contact')return <Contact/>;
  if(root==='login'||root==='register')return <AccountForm mode={root}/>;
  if(root==='password-reset')return <AccountForm mode="reset"/>;
  if(root==='profile')return <Protected><AccountForm mode={a==='password'?'password':'profile'}/></Protected>;
  if(root==='course'&&a){if(b==='lesson'&&c)return <Lesson lessonId={c}/>;return <Course slug={a} enrolling={b==='enroll'}/>;}
  if(root==='dashboard')return <Protected><Dashboard/></Protected>;
  if(root==='exams')return <Protected><Exams/></Protected>;
  if(root==='exam'&&a)return <Protected><ExamStart examId={a}/></Protected>;
  if(root==='attempt'&&a)return <Protected><Attempt attemptId={a}/></Protected>;
  if(root==='results')return <Protected><Results/></Protected>;
  if(root==='my-report')return <Protected><Report/><ReportAnswers/></Protected>;
  if(root==='report'&&a==='parent'&&b)return <><Report token={b}/><ReportAnswers token={b}/></>;
  // The legacy camera check was intentionally public so a student can verify
  // browser permissions before signing in or starting an exam.
  if(root==='camera-check')return <><h1>فحص الكاميرا</h1><Camera/></>;
  if(root==='teacher'||root==='admin'){
    let content;
    if(!a)content=<TeacherDashboard/>;
    else if(a==='students')content=b?(c==='report'?<><Report studentId={b}/><ReportAnswers studentId={b}/><ReportViews studentId={b}/></>:<StudentDetail studentId={b}/>):<Students/>;
    else if(a==='enrollments')content=<Enrollments/>;
    else if(a==='codes')content=<Codes/>;
    else if(a==='inbox')content=<Inbox/>;
    else if(a==='results')content=<TeacherResults/>;
    else if(a==='reports')content=<Reports/>;
    else if(a==='security')content=<Security/>;
    else if(a==='notifications')content=<Notifications/>;
    else if(resourceNames.includes(a)){
      // Keep the original nested Django authoring URLs usable as well.
      if(b&&c&&resourceNames.includes(c)){content=d==='new'?<ResourceEditor resource={c}/>:<ResourceEditor resource={c} itemId={d}/>;}
      else content=b==='new'?<ResourceEditor resource={a}/>:b&&c==='edit'?<ResourceEditor resource={a} itemId={b}/>:b?<ResourceManage resource={a} itemId={b}/>:<ResourceList resource={a}/>;
    }
    return <Protected teacher>{content||<NotFound/>}</Protected>;
  }
  return <NotFound/>;
}
function NotFound(){return <div className="empty"><h1>الصفحة غير موجودة</h1><Link className="button" href="/">العودة للرئيسية</Link></div>;}
