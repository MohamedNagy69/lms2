'use client';
import Link from 'next/link';
import type {ReactNode} from 'react';
import type {Row} from '@/lib/client';
import {BrandIcon} from './brand-icon';
export function Status({loading,error,retry}:{loading?:boolean;error?:string;retry?:()=>void}){
  if(loading)return <div className="loading" role="status"><span className="spinner"/>جاري التحميل…</div>;
  if(error)return <div className="notice error" role="alert">{error} {retry&&<button className="secondary" onClick={retry}>إعادة المحاولة</button>}</div>;
  return null;
}
export function Notice({error,notice}:{error?:string;notice?:string}){return <>{error&&<div className="notice error" role="alert">{error}</div>}{notice&&<div className="notice success" role="status">{notice}</div>}</>;}
export function Heading({title,subtitle,children}:{title:string;subtitle?:string;children?:ReactNode}){return <div className="page-heading"><div><span className="eyebrow">منصة التعلم</span><h1>{title}</h1>{subtitle&&<p className="muted">{subtitle}</p>}</div><div className="actions">{children}</div></div>;}
export function Empty({children='لا توجد بيانات لعرضها بعد'}:{children?:ReactNode}){return <div className="empty">{children}</div>;}
export function Stat({label,value}:{label:string;value:ReactNode}){return <div className="stat"><strong>{value}</strong><span>{label}</span></div>;}
export function CourseCard({course}:{course:Row}){const free=Boolean(course.is_free);return <article className="course-card"><Link href={`/course/${course.slug}`}><div className="course-cover"><img src={`/img/courses/course_${(Number(course.order||0)%5+5)%5+1}.jpg`} alt="" loading="lazy"/><span className="badge">{course.grade_name}</span>{free&&<span className="course-free">مجاني</span>}</div><div className="card-body"><h3>{course.title}</h3><p className="muted">{course.summary}</p><div className="row between course-meta"><span><BrandIcon kind="play"/>{course.lessons_count||0} درس</span></div><span className="course-cta">عرض المقرر <BrandIcon kind="arrow"/></span>{course.completed!==undefined&&<><progress value={course.completed} max={course.lessons_count||1}/><small>أكملت {course.completed} من {course.lessons_count} درس</small></>}</div></Link></article>;}
export function DataTable({headers,children}:{headers:ReactNode[];children:ReactNode}){return <div className="table-wrap" role="region" aria-label="جدول البيانات" tabIndex={0}><table><thead><tr>{headers.map((h,i)=><th key={typeof h==='string'?h:i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;}
