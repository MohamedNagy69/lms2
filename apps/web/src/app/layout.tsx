import type {Metadata} from 'next';
import {cookies} from 'next/headers';
import Script from 'next/script';
import {AuthProvider} from '@/lib/client';
import {Shell} from '@/components/shell';
import {CaptureLockGate} from '@/components/capture-lock';
import './globals.css';
import './brand.css';
export const metadata:Metadata={title:{default:'منصة الغيطي | تعلّم العربي بثقة',template:'%s | منصة الغيطي'},description:'شرح وتدريب وامتحانات ومتابعة في اللغة العربية مع د. ناجي الغيطي'};

// The saved theme lives in a cookie, so the server renders <html data-theme> directly: no inline script, no flash of the
// wrong theme. Without a saved choice the attribute is left off and the CSS follows the OS preference.
// suppressHydrationWarning on <html>/<body> only ignores attribute differences that browser extensions add to those two
// elements; /hydration-guard.js strips the attributes some security extensions stamp on every other element.
export default async function RootLayout({children}:{children:React.ReactNode}){
  const saved=(await cookies()).get('theme')?.value;
  const theme=saved==='dark'||saved==='light'?saved:undefined;
  return <html lang="ar" dir="rtl" data-scroll-behavior="smooth" data-theme={theme} suppressHydrationWarning>
    <head><meta name="color-scheme" content="light dark"/></head>
    <body suppressHydrationWarning>
      <Script src="/hydration-guard.js" strategy="beforeInteractive"/>
      <a className="skip-link" href="#main-content">انتقل للمحتوى</a>
      <AuthProvider><Shell>{children}</Shell><CaptureLockGate/></AuthProvider>
    </body>
  </html>;
}
