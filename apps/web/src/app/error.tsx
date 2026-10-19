'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <div className="notice error"><h1>تعذر فتح الصفحة</h1><button onClick={reset}>حاول مرة أخرى</button></div>;}
