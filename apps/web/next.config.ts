import type {NextConfig} from 'next';
const isDev=process.env.NODE_ENV!=='production';
const useHttps=(process.env.WEB_ORIGIN||'').startsWith('https://');
const csp=`
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev?" 'unsafe-eval'":''} https://cdn.jsdelivr.net https://www.youtube.com;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://i.ytimg.com;
  font-src 'self' data:;
  media-src 'self' blob:;
  connect-src 'self';
  frame-src https://www.youtube-nocookie.com https://www.youtube.com https://drive.google.com;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  worker-src 'self' blob:;
  ${useHttps?"upgrade-insecure-requests;":''}
`.replace(/\s{2,}/g,' ').trim();
const nextConfig:NextConfig={
  poweredByHeader:false,
  // /api is proxied to the API through the rewrite below. Next buffers proxied request bodies and cuts them at 10MB by
  // default, which broke video uploads ("تعذر الاتصال بالخادم"). Match the API's upload limit (1GB, also nginx's
  // client_max_body_size). Behind nginx, /api goes straight to the API and never passes through this proxy.
  experimental:{proxyClientMaxBodySize:'1gb'},
  async headers(){return [{source:'/media-sw.js',headers:[
    {key:'Content-Type',value:'application/javascript; charset=utf-8'},
    {key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},
  ]},{source:'/:path*',headers:[
    {key:'Content-Security-Policy',value:csp},
    {key:'X-Frame-Options',value:'DENY'},
    {key:'X-Content-Type-Options',value:'nosniff'},
    {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
    {key:'Permissions-Policy',value:'camera=(self), microphone=(), geolocation=(), display-capture=()'},
    {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
    ...(useHttps?[{key:'Strict-Transport-Security',value:'max-age=63072000; includeSubDomains; preload'}]:[]),
  ]}];},
  async rewrites(){return [{source:'/api/:path*',destination:`${process.env.API_INTERNAL_URL||'http://127.0.0.1:4000'}/api/:path*`}];},
};
export default nextConfig;
