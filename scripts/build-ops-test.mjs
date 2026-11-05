import {build} from 'esbuild';
import {readFile,writeFile,readdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export function assertPreviewOnly(env=process.env){
 if(env.VERCEL_ENV==='production'||env.VERCEL_TARGET_ENV==='production'||env.JOWWA_PRODUCTION==='true')throw Error('TEST BRANCH ONLY: production builds are forbidden until a separate reviewed rollout.');
 if(env.VERCEL_GIT_COMMIT_REF&&!env.VERCEL_GIT_COMMIT_REF.startsWith('feat/operations-test'))throw Error('This build belongs only to the isolated operations-test branch.');
}
export async function buildTest(){
 assertPreviewOnly();
 // Do not let inherited Vercel preview variables connect test pages to a live project.
 for(const k of ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','JOWWA_PHONE_AUTH'])delete process.env[k];
 const originalHome=await readFile('public/index.html','utf8');
 await import('./build.mjs');
 // Fully offline rendering: no font CDN requests from this isolated test artifact.
 for(const cssPath of ['public/market.css','public/style.css']){const css=await readFile(cssPath,'utf8');await writeFile(cssPath,css.split('\n').filter(line=>!line.includes('fonts.googleapis.com')).join('\n'));}
 await build({entryPoints:['src/operations/ui.mjs'],outfile:'public/operations-ui.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
 // The test workbench lives outside public/ so the live build can never serve it.
 const page=await readFile('src/operations/page.html','utf8');
 await copyFile('src/operations/operations.css','public/operations.css');
 await writeFile('public/operations.html',page);
 await writeFile('public/explore.html',originalHome.replace('<body','<body data-operations-preview="true"').replace('</body>','<aside style="position:fixed;bottom:8px;left:8px;right:8px;z-index:99999;background:#fff2d9;padding:10px;text-align:center">واجهة مرجعية في نسخة اختبار؛ حسابات اللايف والطلبات الحقيقية مقفولة. <a href="/work">افتح مساحة اختبار التشغيل</a></aside></body>'));
 await Promise.all(['public/index.html','public/work.html','public/market.html'].map(path=>writeFile(path,page)));
 await writeFile('public/config.js','export default '+JSON.stringify({url:'',key:'',publicSignup:false,phoneAuth:false,operationsTest:true})+';\n');
 await writeFile('public/robots.txt','User-agent: *\nDisallow: /\n');
 await writeFile('public/test-api-disabled.json',JSON.stringify({isolatedTest:true,error:'كل واجهات حسابات ورسائل وبيانات اللايف مقفولة في نسخة الاختبار. البيانات التجريبية محلية في المتصفح.'}));
 await writeFile('public/sw.js',"self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));\n");
 // This changes only the build checkout, never Git's main branch or the live deployment.
 // Keeping imported legacy handlers alive behind a UI-only flag is NOT sufficient isolation.
 const disabled="export default function handler(req,res){res.statusCode=503;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Jowwa-Environment','isolated-test');res.end(JSON.stringify({code:'TEST_ISOLATION',error:'Live integrations are disabled on this test deployment.'}));}\n";
 for(const name of await readdir('api'))if(name.endsWith('.mjs'))await writeFile('api/'+name,disabled);
 await writeFile('public/operations-build.json',JSON.stringify({mode:'isolated-local-test',liveBackend:false,realSms:false,realPayments:false,identityUploads:false,commit:process.env.VERCEL_GIT_COMMIT_SHA||null}));
 console.log('Isolated test build ready: local fixture state; all legacy APIs disabled; production build prohibited.');
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await buildTest();
