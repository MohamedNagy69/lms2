import {Suspense} from 'react';
import {Platform} from '@/components/platform';
export default function Page(){return <Suspense fallback={<p>جاري التحميل…</p>}><Platform/></Suspense>;}
