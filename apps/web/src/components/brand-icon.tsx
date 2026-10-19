export function BrandIcon({kind='book'}:{kind?:string}) {
  const paths:Record<string,string>={
    book:'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3V4Zm9 2v15',
    grid:'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8m8 .13a4 4 0 0 1 0 7.75',
    chart:'M4 3v18h17M8 16v-4m5 4V7m5 9v-6',
    play:'M9 7l8 5-8 5V7ZM3 3h18v18H3Z',
    file:'M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h5',
    check:'m8 12 3 3 5-6M5 3h14v18H5Z',
    mail:'M3 5h18v14H3Zm0 0 9 8 9-8',
    shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-4 9 3 3 5-6',
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-9 13h6',
    code:'m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16',
    user:'M20 21v-2a7 7 0 0 0-14 0v2M13 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z',
    arrow:'M19 12H5m6-6-6 6 6 6'
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]||paths.book}/></svg>;
}
