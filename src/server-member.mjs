import {createClient} from '@supabase/supabase-js';
import {MEMBER_COOKIE,safeReturnPath,verifiedMember} from '../public/member-core.js';
import {esc} from '../public/market-core.js';
export function requestToken(req){
 const bearer=String(req.headers?.authorization||'').match(/^Bearer ([^\s]{20,8192})$/)?.[1];if(bearer)return bearer;
 const raw=String(req.headers?.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(MEMBER_COOKIE+'='));
 if(!raw)return '';try{const token=decodeURIComponent(raw.slice(MEMBER_COOKIE.length+1));return /^[A-Za-z0-9._-]{20,8192}$/.test(token)?token:'';}catch{return '';}
}
export function noStore(res){res.setHeader('Cache-Control','private, no-store');res.setHeader('Vary','Cookie, Authorization');res.setHeader('X-Content-Type-Options','nosniff');}
export async function authenticatedMember(req,{clientFactory=createClient,env=process.env,admin=false}={}){
 const token=requestToken(req);if(!token)return {ok:false,status:401};
 const url=env.NEXT_PUBLIC_SUPABASE_URL||env.SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_ANON_KEY||env.SUPABASE_ANON_KEY;
 if(!url||!key)return {ok:false,status:503};
 try{const db=clientFactory(url,key,{global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await db.auth.getUser(token);if(error||!verifiedMember(data?.user))return {ok:false,status:401};
 let isAdmin=false;if(admin){const check=await db.rpc('jowwa_is_admin');if(check.error)return {ok:false,status:503};isAdmin=check.data===true;if(!isAdmin)return {ok:false,status:403};}
 return {ok:true,db,user:data.user,token,admin:isAdmin};
 }catch{return {ok:false,status:503};}
}
export function memberPage(next='/'){
 const target=safeReturnPath(next);
 return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>كمّل مع جوه</title><link rel="stylesheet" href="/market.css"><link rel="stylesheet" href="/customer.css"><script type="module" src="/customer.js"></script></head><body data-member-page data-member-next="'+esc(target)+'"><main class="member-welcome"><a href="/"><img src="/icon.svg" alt="جوه" width="64" height="64"></a><h1>اختيارك محفوظ</h1><p>سجّل أو ادخل لحسابك، وهنكمّل من نفس المكان.</p><button class="primary" data-member-login>دخول / تسجيل</button><a href="/" class="secondary">رجوع للرئيسية</a><noscript>فعّل JavaScript لإكمال التسجيل.</noscript></main></body></html>';
}
export async function requireMemberPage(req,res,next,options={}){
 noStore(res);const member=await authenticatedMember(req,options);if(member.ok){req.member=member;return true;}
 res.statusCode=member.status;res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('X-Robots-Tag','noindex, nofollow');res.end(memberPage(next));return false;
}
function sameOrigin(req){const origin=req.headers?.origin;if(!origin)return true;try{return new URL(origin).host===req.headers.host;}catch{return false;}}
export function createMemberHandler(options={}){return async(req,res)=>{
 noStore(res);res.setHeader('Content-Type','application/json; charset=utf-8');
 const reply=(status,body)=>{res.statusCode=status;res.end(JSON.stringify(body));};
 if(!['GET','POST','DELETE'].includes(req.method)){res.setHeader('Allow','GET, POST, DELETE');return reply(405,{error:'طلب غير مدعوم.'});}
 if(req.method!=='GET'&&!sameOrigin(req))return reply(403,{error:'طلب غير مسموح.'});
 const secure=req.headers.host?.startsWith('localhost')||req.headers.host?.startsWith('127.0.0.1')?'':'; Secure';
 if(req.method==='DELETE'){res.setHeader('Set-Cookie',MEMBER_COOKIE+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'+secure);return reply(200,{member:false});}
 if(req.method==='POST'&&!String(req.headers.authorization||'').startsWith('Bearer '))return reply(401,{member:false});
 const auth=await authenticatedMember(req,options);if(!auth.ok)return reply(auth.status,{member:false,error:auth.status===503?'تعذر التحقق من الدخول. حاول تاني.':'سجّل دخولك عشان تكمل.'});
 if(req.method==='POST')res.setHeader('Set-Cookie',MEMBER_COOKIE+'='+encodeURIComponent(auth.token)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800'+secure);
 const check=await auth.db.rpc('jowwa_is_admin');
 return reply(200,{member:true,admin:!check.error&&check.data===true,user:{id:auth.user.id,name:String(auth.user.user_metadata?.display_name||'').slice(0,60)}});
};}
export default createMemberHandler();
