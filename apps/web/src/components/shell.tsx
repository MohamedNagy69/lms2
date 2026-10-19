'use client';
import Link from 'next/link';
import {usePathname,useRouter} from 'next/navigation';
import {useEffect,useState,type ReactNode} from 'react';
import {useAuth,post} from '@/lib/client';
import {BrandIcon} from './brand-icon';
const teacherGroups=[
  {label:'الرئيسية',links:[['/teacher','نظرة عامة','grid']]},
  {label:'المحتوى التعليمي',links:[['/teacher/courses','الكورسات','book'],['/teacher/lectures','المحاضرات','play'],['/teacher/lessons','الدروس','play'],['/teacher/attachments','المرفقات','file'],['/teacher/exams','الامتحانات','check'],['/teacher/questions','الأسئلة','file'],['/teacher/grades','الصفوف','book']]},
  {label:'الطلاب والمتابعة',links:[['/teacher/students','الطلاب','users'],['/teacher/enrollments','الاشتراكات','check'],['/teacher/codes','أكواد التفعيل','code'],['/teacher/results','النتائج','chart'],['/teacher/reports','التقارير الأسبوعية','chart']]},
  {label:'التواصل والإدارة',links:[['/teacher/announcements','الإعلانات','bell'],['/teacher/testimonials','آراء الطلاب','star'],['/teacher/inbox','الرسائل','mail'],['/teacher/notifications','الإشعارات','bell'],['/teacher/security','الأجهزة والأمان','shield']]},
];
const studentGroups=[
  {label:'تعلّم',links:[['/dashboard','لوحتي','grid'],['/courses','المقررات','book'],['/exams','الامتحانات','check']]},
  {label:'متابعة',links:[['/results','نتائجي','chart'],['/my-report','تقريري الأسبوعي','file'],['/camera-check','فحص الكاميرا','play'],['/profile','حسابي','user']]},
];
// The choice is stored in a cookie the server reads to render the right theme on the next visit.
function saveTheme(theme:'dark'|'light'){document.documentElement.dataset.theme=theme;document.cookie=`theme=${theme}; path=/; max-age=31536000; samesite=lax`;}
// Both icons are always rendered and CSS shows the right one, so server and client markup never differ.
function ThemeToggle(){
  // One-time move of a choice saved by the old localStorage version into the cookie.
  useEffect(()=>{try{const old=localStorage.getItem('theme');if((old==='dark'||old==='light')&&!document.cookie.includes('theme=')){saveTheme(old);}localStorage.removeItem('theme');}catch{}},[]);
  const toggle=()=>{
    const root=document.documentElement;
    const current=root.dataset.theme||(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
    saveTheme(current==='dark'?'light':'dark');
  };
  return <button type="button" className="theme-toggle" onClick={toggle} aria-label="التبديل بين الوضع الفاتح والداكن" title="الوضع الفاتح / الداكن">
    <svg className="icon-moon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="currentColor"/></svg>
    <svg className="icon-sun" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
  </button>;
}
// Public pages get the full footer with a call to action; dashboards get the same footer without it.
function SiteFooter({dashboard,signedIn,teacher}:{dashboard:boolean;signedIn:boolean;teacher:boolean}){
  const home=teacher?'/teacher':'/dashboard';
  return <footer className={`site-footer${dashboard?' is-compact':''}`}>
    <div className="container">
      {!dashboard&&<div className="footer-cta">
        <div><span className="eyebrow">جاهز تبدأ؟</span><h2>{signedIn?<>كمّل رحلتك… <em>درسك الجاي في انتظارك</em></>:<>كمّل رحلتك… <em>درسك الجاي في انتظارك</em></>}</h2><p>شرح منظّم، تدريب حقيقي، ومتابعة تخلّيك تشوف تقدّمك أول بأول.</p></div>
        <div className="actions">{signedIn?<Link className="button" href={home}>افتح لوحتك <BrandIcon kind="arrow"/></Link>:<Link className="button" href="/register">أنشئ حسابك مجانًا <BrandIcon kind="arrow"/></Link>}<Link className="button secondary" href="/courses">تصفّح المقررات</Link></div>
      </div>}
      <div className="footer-grid">
        <div className="footer-brand">
          <Link href="/" className="logo"><span className="logo-icon" aria-hidden="true">غ<span className="brand-monogram-spark">✦</span></span><span>منصة الغيطي<small>اللغة العربية بثقة</small></span></Link>
          <p>منصة متخصصة في اللغة العربية لطلاب IGCSE والمستوى المتقدم: دروس مسجّلة محمية، امتحانات بتصحيح فوري، وتقارير أسبوعية لولي الأمر.</p>
        </div>
        <nav aria-label="روابط المنصة"><h3>المنصة</h3><Link href="/">الرئيسية</Link><Link href="/courses">المقررات</Link><Link href="/#about">عن المدرس</Link><Link href="/#faq">الأسئلة الشائعة</Link></nav>
        <nav aria-label="روابط الحساب"><h3>حسابك</h3>{signedIn?<><Link href={home}>لوحة التحكم</Link><Link href="/profile">حسابي</Link></>:<><Link href="/login">تسجيل الدخول</Link><Link href="/register">إنشاء حساب</Link><Link href="/password-reset">نسيت كلمة المرور؟</Link></>}<Link href="/camera-check">فحص الكاميرا</Link></nav>
        <nav aria-label="روابط الدعم"><h3>الدعم</h3><Link href="/contact">تواصل معنا</Link><Link href="/#faq">مساعدة سريعة</Link></nav>
      </div>
      <div className="footer-bottom"><p>© {new Date().getFullYear()} منصة الغيطي. جميع الحقوق محفوظة.</p><p className="footer-motto">العربية… لغة الضاد <span aria-hidden="true">✦</span></p></div>
    </div>
  </footer>;
}
export function Shell({children}:{children:ReactNode}){
  const {user,refresh}=useAuth(),path=usePathname(),router=useRouter(),[menu,setMenu]=useState(false),[sectionsOpen,setSectionsOpen]=useState(false),[error,setError]=useState('');
  const teacher=Boolean(user?.is_teacher)&&(path.startsWith('/teacher')||path==='/admin');
  const dashboard=Boolean(user)&&(teacher||(!user?.is_teacher&&['/dashboard','/exams','/results','/my-report','/camera-check','/profile','/attempt'].some(p=>path.startsWith(p))));
  async function logout(){try{await post('/auth/logout');await refresh();router.push('/login');}catch(e){setError((e as Error).message);}}
  const active=(href:string)=>path===href||(href!=='/teacher'&&path.startsWith(href+'/'));
  return <div className={dashboard?'site-shell is-dashboard':'site-shell'}>
    <header className="topbar"><div className="container row between">
      <Link href="/" className="logo"><span className="logo-icon" aria-hidden="true">غ<span className="brand-monogram-spark">✦</span></span><span>منصة الغيطي<small>اللغة العربية بثقة</small></span></Link>
      <div className="header-tools"><ThemeToggle/><button className="mobile-menu secondary" aria-label={menu?'إغلاق القائمة':'فتح القائمة'} aria-controls="main-navigation" aria-expanded={menu} onClick={()=>setMenu(!menu)}>☰</button></div>
      <nav aria-label="القائمة الرئيسية" id="main-navigation" className={'topnav '+(menu?'open':'')} onClick={()=>setMenu(false)}>
        <Link href="/" aria-current={path==='/'?'page':undefined}>الرئيسية</Link><Link href="/courses" aria-current={path==='/courses'?'page':undefined}>المقررات</Link><Link href="/#about">عن المدرس</Link><Link href="/contact">تواصل معنا</Link>
        {user?<><Link className="button" href={user.is_teacher?'/teacher':'/dashboard'}>لوحة التحكم</Link><Link className="nav-account" href="/profile"><span className="mini-avatar">{user.first_name?.[0]||'م'}</span>{user.display_name}</Link><button className="text-button" onClick={logout}>خروج</button></>:<><Link href="/login">تسجيل الدخول</Link><Link className="button" href="/register">ابدأ رحلتك <BrandIcon kind="arrow"/></Link></>}
      </nav>
    </div></header>
    {error&&<div className="notice error" role="alert">{error}</div>}
    <div className={dashboard?'workspace container':'container'}>
      {dashboard&&<aside className="sidebar"><div className="sidebar-heading"><span className="eyebrow">منصة الغيطي</span><strong>{teacher?'لوحة المدرس':'رحلتك التعليمية'}</strong></div><button className="dashboard-section-toggle secondary" type="button" aria-controls="dashboard-navigation" aria-expanded={sectionsOpen} onClick={()=>setSectionsOpen(!sectionsOpen)}><BrandIcon kind="grid"/><span>{teacher?'أقسام لوحة المدرس':'أقسام لوحة الطالب'}</span><span aria-hidden="true">{sectionsOpen?'−':'+'}</span></button><nav id="dashboard-navigation" className={sectionsOpen?'open':''} aria-label={teacher?'أقسام لوحة المدرس':'أقسام لوحة الطالب'} tabIndex={0} onClick={()=>setSectionsOpen(false)}>{(teacher?teacherGroups:studentGroups).map(group=><div className="nav-group" key={group.label}><span className="nav-group-title">{group.label}</span>{group.links.map(([href,label,icon])=><Link key={href} className={active(href)?'active':''} aria-current={active(href)?'page':undefined} href={href}><BrandIcon kind={icon}/><span>{label}</span>{active(href)&&<i className="nav-dot" aria-hidden="true"/>}</Link>)}</div>)}</nav><Link href="/contact" className="sidebar-support"><BrandIcon kind="mail"/><span>محتاج مساعدة؟<small>تواصل مع الدعم</small></span><BrandIcon kind="arrow"/></Link></aside>}
      <main className={dashboard?'dashboard-main':'public-main'} id="main-content">{children}</main>
    </div>
    <SiteFooter dashboard={dashboard} signedIn={Boolean(user)} teacher={Boolean(user?.is_teacher)}/>
  </div>;
}
