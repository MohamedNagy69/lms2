'use client';
import {createContext,useCallback,useContext,useEffect,useState,type ReactNode} from 'react';
import {useRouter} from 'next/navigation';
export type Row=Record<string,any>;
export class ApiError extends Error{constructor(message:string,public status:number){super(message);}}
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const form=options.body instanceof FormData;
  const response=await fetch(`/api${path}`,{...options,credentials:'include',headers:{...(form?{}:{'Content-Type':'application/json'}),'X-Requested-With':'Mudarris',...options.headers}});
  const body=await response.json().catch(()=>({error:'تعذر الاتصال بالخادم'}));
  if(!response.ok)throw new ApiError(body.details?.length?`${body.error}: ${body.details.map((d:any)=>d.field).join('، ')}`:body.error||'حدث خطأ',response.status);
  return body;
}
export const post=(path:string,body:unknown={})=>api(path,{method:'POST',body:JSON.stringify(body)});
export function useData<T=any>(path:string|null){
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[version,setVersion]=useState(0);
  const reload=useCallback(()=>setVersion(v=>v+1),[]);
  useEffect(()=>{if(!path){setLoading(false);return;}let current=true;setLoading(true);setError('');setData(null);
    api<T>(path).then(value=>{if(current)setData(value);}).catch(err=>{if(current)setError(err.message);}).finally(()=>{if(current)setLoading(false);});
    return()=>{current=false;};
  },[path,version]);
  return{data,error,loading,reload};
}
export function useAction(){const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
  async function run<T>(fn:()=>Promise<T>,message='تم الحفظ بنجاح'):Promise<T|undefined>{setBusy(true);setError('');setNotice('');try{const result=await fn();setNotice(message);return result;}catch(err){setError(err instanceof Error?err.message:'حدث خطأ');}finally{setBusy(false);}}
  return{busy,notice,error,run,setNotice};
}
const AuthContext=createContext<{user:Row|null;loading:boolean;refresh:()=>Promise<void>}>({user:null,loading:true,refresh:async()=>{}});
export function AuthProvider({children}:{children:ReactNode}){
  const [user,setUser]=useState<Row|null>(null),[loading,setLoading]=useState(true);
  const refresh=useCallback(async()=>{try{const data=await api('/auth/me');setUser(data.user);}catch{setUser(null);}finally{setLoading(false);}},[]);
  useEffect(()=>{void refresh();},[refresh]);
  return <AuthContext.Provider value={{user,loading,refresh}}>{children}</AuthContext.Provider>;
}
export const useAuth=()=>useContext(AuthContext);
export function Protected({children,teacher=false}:{children:ReactNode;teacher?:boolean}){
  const {user,loading}=useAuth(),router=useRouter();
  useEffect(()=>{if(!loading&&!user)router.replace('/login');},[loading,user,router]);
  if(loading||!user)return <p role="status">جاري تحميل الحساب…</p>;
  if(teacher&&!user.is_teacher)return <div className="notice error">ليس لديك صلاحية لفتح لوحة المدرس.</div>;
  return <>{children}</>;
}
export const date=(value:string)=>value?new Date(value).toLocaleString('ar-EG',{dateStyle:'medium',timeStyle:'short'}):'—';
export const name=(user:Row)=>user.display_name||`${user.first_name||''} ${user.last_name||''}`.trim()||user.username;
