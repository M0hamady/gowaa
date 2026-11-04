import {execute,project} from './engine.mjs';
import {OpsError,key} from './core.mjs';
/** No default credentials and no fallback to existing/live Supabase variables. */
export function createSqlTestStore(client,workspaceId='test-workspace'){
 key(workspaceId);
 return {
  async read(){const marker=await client.query("select purpose from jowwa_ops_test.environment where singleton=true");if(marker.rows?.[0]?.purpose!=='isolated_test_only')throw new OpsError('ENVIRONMENT','قاعدة البيانات مش معلمة كبيئة اختبار.',503);const result=await client.query('select state from jowwa_ops_test.workspaces where id=$1',[workspaceId]);if(!result.rows?.[0])throw new OpsError('ENVIRONMENT','مساحة الاختبار مش مهيأة.',503);return result.rows[0].state;},
  async commit(expected,state){await client.query('select jowwa_ops_test.commit_state($1,$2,$3::jsonb)',[workspaceId,expected,JSON.stringify(state)]);}
 };
}
/** authenticate must validate a token with the separately configured TEST identity provider.
 * A fixture role switch is intentionally not accepted here. Never mount this in production.
 */
export function createOperationsHandler({store,authenticate,environment,origin,clock=()=>Date.now()}={}){
 return async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('X-Content-Type-Options','nosniff');
  const reply=(code,value)=>{res.statusCode=code;res.end(JSON.stringify(value));};
  if(environment!=='isolated_test'||process.env.VERCEL_ENV==='production'||!store||typeof authenticate!=='function')return reply(503,{error:'نظام التشغيل ده متاح في بيئة الاختبار المعزولة فقط.',code:'TEST_ONLY'});
  if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return reply(405,{error:'طلب غير مدعوم.'});}
  if(req.method==='POST'&&(!origin||req.headers?.origin!==origin))return reply(403,{error:'مصدر الطلب غير مسموح.'});
  try{
   const principal=await authenticate(req);if(!principal?.verified||typeof principal.id!=='string')return reply(401,{error:'حساب اختبار متحقق مطلوب.'});
   const state=await store.read();if(!state.users[principal.id]?.verified)return reply(403,{error:'حسابك غير مدعو لمساحة الاختبار دي.'});
   if(req.method==='GET')return reply(200,{view:project(state,principal.id,{now:clock()}),isolatedTest:true});
   if(Number(req.headers?.['content-length'])>30000)return reply(413,{error:'الطلب أكبر من المسموح.'});
   let command;try{command=typeof req.body==='string'?JSON.parse(req.body):req.body;}catch{return reply(400,{error:'راجع بيانات العملية.'});}
   const result=execute(state,principal.id,command,{now:clock()});if(!result.replayed)await store.commit(state.revision,result.state);
   return reply(200,{result:result.result,replayed:result.replayed,view:project(result.state,principal.id,{now:clock()}),isolatedTest:true});
  }catch(e){if(e.code==='40001')return reply(409,{error:'في تحديث متزامن؛ حدّث الصفحة قبل التأكيد.',code:'STALE'});if(e instanceof OpsError)return reply(e.status,{error:e.message,code:e.code});return reply(503,{error:'تعذر التأكد من الحفظ. أعد نفس رقم العملية بدون إنشاء عملية جديدة.',code:'RETRY_SAME_COMMAND'});}
 };
}
