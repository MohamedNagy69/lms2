'use client';

import Link from 'next/link';
import {useData,type Row} from '@/lib/client';
import {BrandIcon} from './brand-icon';
import {CourseCard,Empty,Status} from './ui';

export function Home(){
  const query=useData('/home');
  if(!query.data)return <Status {...query} retry={query.reload}/>;
  const {site,courses,stats,testimonials}=query.data;
  return <>
    <section className="landing-hero">
      <div className="landing-copy">
        <span className="badge"><span className="status-dot"/> {site.subject}</span>
        <h1>طريقك الي التفوق<br/><em>يبدأ بخطوة.</em></h1>
        <p className="landing-description">هدفنا... تفوقك في اللغة العربية. شرح تفهمه، تدريب يثبّت المعلومة، ومتابعة تجعلك تري تقدّمك أمام عينيك.</p>
        <div className="actions"><Link className="button" href="/courses">ابدأ بالمقررات <BrandIcon kind="arrow"/></Link><Link className="button secondary" href="/register">أنشئ حسابك</Link></div>
        {stats.students>0&&<div className="hero-proof"><div className="proof-avatars" aria-hidden="true">{['م','س','ف','ع'].map(letter=><span key={letter}>{letter}</span>)}</div><p><strong>+{stats.students} طالب</strong> بيذاكروا على المنصة دلوقتي</p></div>}
        <ul className="landing-trust" aria-label="مميزات المنصة">{['شرح واضح','تدريب فعلي','متابعة مستمرة'].map(item=><li key={item}><BrandIcon kind="check"/>{item}</li>)}</ul>
      </div>
      <div className="mentor-visual"><span className="orbit orbit-one" aria-hidden="true"/><span className="orbit orbit-two" aria-hidden="true"/><div className="mentor-photo"><img src="/img/dr_nagi-navy.png" alt={site.teacher_name} fetchPriority="high"/><div className="mentor-caption"><small>معك في كل خطوة</small><strong>{site.teacher_name}</strong><span>{site.subject}</span></div></div><div className="floating-note note-top"><span className="note-icon"><BrandIcon kind="book"/></span><div><strong>افهم. طبّق. اتفوّق.</strong><small>تعلم له نتيجة</small></div></div><div className="floating-note note-bottom"><BrandIcon kind="play"/><div><strong>{stats.lessons} درس</strong><small>خطوة أقرب لهدفك</small></div></div><span className="mentor-spark" aria-hidden="true">✦</span></div>
    </section>

    <section className="brand-promise" aria-label="هدف المنصة"><div><span className="eyebrow">طموحك هو البداية</span><h2>تعلم بثقة <em>وتقدم كل يوم</em></h2><p>كل درس له هدف واضح، وكل تدريب يقربك من المستوى الذي تطمح له.</p></div><div className="promise-stats">{([['book',stats.courses,'مقرر دراسي'],['play',stats.lessons,'درس مسجّل'],['users',stats.students,'طالب']] as const).map(([icon,value,label])=><span key={label}><BrandIcon kind={icon}/><strong>{value}</strong>{label}</span>)}</div></section>

    <section className="section journey-section" aria-label="طريقة التعلم"><div className="section-head"><div><span className="eyebrow">رحلتك في المنصة</span><h2>من الفهم إلى التفوّق</h2></div><p className="muted">خطوات بسيطة، ونتيجة تقدر تتابعها.</p></div><div className="learning-features">{[['book','افهم من الأساس','شرح منظّم يوصلك من الفكرة للتطبيق.'],['check','اختبر فهمك','تدريبات وامتحانات مع مراجعة الإجابات.'],['chart','تابع تقدّمك','نتائج وتقارير توضّح خطوتك التالية.']].map(([icon,title,body],index)=><article key={title}><span className="feature-icon"><BrandIcon kind={icon}/></span><div><small>الخطوة {['الأولى','الثانية','الثالثة'][index]}</small><h3>{title}</h3><p>{body}</p></div></article>)}</div></section>

    <section className="section courses-section"><div className="section-head"><div><span className="eyebrow">ابدأ من هنا</span><h2>المقررات الدراسية</h2><p className="muted">اختر المقرر المناسب لمنهجك، وابدأ بالدروس المجانية لو حابب تجرّب الأول.</p></div><Link className="section-link" href="/courses">عرض كل المقررات <BrandIcon kind="arrow"/></Link></div>{courses.length?<div className="grid home-courses">{courses.slice(0,6).map((course:Row)=><CourseCard course={course} key={course.id}/>)}</div>:<Empty>سيتم الإعلان عن المقررات قريبًا</Empty>}</section>

    {testimonials.length>0&&<section className="section testimonials-section"><div className="section-head"><div><span className="eyebrow">من تجربة الطلاب</span><h2>آراء طلابنا</h2><p className="muted">نتايج حقيقية لطلاب ذاكروا على المنصة.</p></div></div><div className="testimonials-grid">{testimonials.map((item:Row)=><article className="testimonial-card" key={item.id}>
      <span className="testimonial-stars" role="img" aria-label={`التقييم ${item.rating} من 5`}>{'★'.repeat(item.rating)}<span aria-hidden="true">{'★'.repeat(Math.max(0,5-item.rating))}</span></span>
      <p>{item.text}</p>
      <footer><span className="testimonial-avatar" aria-hidden="true">{String(item.student_name||'ط').trim().charAt(0)}</span><div><strong>{item.student_name}</strong><small>{item.grade_name}</small></div></footer>
    </article>)}</div></section>}

    <section className="section about" id="about">
      <div className="about-photo"><img src="/img/dr_nagi-navy.png" alt={site.teacher_name} loading="lazy"/></div>
      <div className="about-copy"><span className="eyebrow">تعرّف على مدرسك</span><h2>{site.teacher_name}</h2><p>مدرسة اللغة العربية IGCSE — خبرة كبيرة في التعليم الدولي لأكثر من سبعة و عشرين عاما وصاحب مؤلفات كثيرة في هذا المجال</p>
        <ul className="about-points">
          <li><BrandIcon kind="book"/><span><strong>شرح منظم</strong></span></li>
          <li><BrandIcon kind="check"/><span><strong>مراجعات و امتحانات دورية</strong></span></li>
          <li><BrandIcon kind="chart"/><span><strong>متابعة مستمرة و تقارير اسبوعية</strong></span></li>
        </ul>
        <div className="actions"><Link className="button" href="/courses">ابدأ مع {site.teacher_name} <BrandIcon kind="arrow"/></Link><Link className="button secondary" href="/contact">تواصل معنا</Link></div>
      </div>
    </section>

    <section className="section faq-section" id="faq">
      <div className="faq-intro"><span className="eyebrow">محتاج تعرف أكثر؟</span><h2>أسئلة شائعة</h2><p className="muted">إجابات سريعة لأكتر الأسئلة اللي بتوصلنا. لو سؤالك مش هنا، كلّمنا.</p><Link className="button secondary" href="/contact">اسأل سؤالك <BrandIcon kind="arrow"/></Link></div>
      <div className="faq-list">
        <details><summary>كيف أشترك في الكورس؟</summary><p>أنشئ حسابك، واختار الكورس، وبعدين استخدم كود التفعيل أو ابعت طلب اشتراك. الكورسات المجانية بتتفتح فورًا.</p></details>
        <details><summary>اين اجد الامتحانات؟</summary><p>من صفحة «نتائجي» تقدر تراجع درجاتك وإجاباتك وشرح التصحيح.</p></details>
        <details><summary>ينفع أذاكر من أكتر من جهاز؟</summary><p>حسابك بيشتغل على جهازين بحد أقصى في نفس الوقت. لو دخلت من جهاز تالت، أقدم جهاز بيتسجّل خروجه تلقائيًا.</p></details>
        <details><summary>ليه الفيديو بيقف لو خرجت من الصفحة؟</summary><p>لحماية المحتوى، أي محاولة تصوير أو تسجيل للشاشة أو الخروج من نافذة الدرس أثناء المشاهدة بتوقف الحساب، ومايرجعش غير بعد مراجعة المدرس.</p></details>
      </div>
    </section>
  </>;
}
