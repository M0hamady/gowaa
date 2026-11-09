import {build} from 'esbuild';
import {writeFile,readFile} from 'node:fs/promises';
const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL||'';
const key=process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'';
// Only the public anon/publishable key is ever shipped to the browser.
if(key.startsWith('sb_secret_'))throw Error('Secret key cannot be published');
if(key.startsWith('eyJ')&&JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role!=='anon')throw Error('Expected public anon key');
await writeFile('public/config.js',`export default ${JSON.stringify({url,key,publicSignup:false,phoneAuth:process.env.JOWWA_PHONE_AUTH==='true'})};\n`);
await writeFile('src/market-template.mjs','export default '+JSON.stringify(await readFile('public/market.html','utf8'))+';\n');
for(const name of ['market','round-sync','order-pages','place-basket'])await build({entryPoints:['src/'+name+'.js'],outfile:'public/'+name+'.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
// Keep the public customer flow separate from the administrator editor. Shared
// auth code lives in one ESM chunk, so lazy editing does not create another client.
await build({entryPoints:['src/customer.js'],outdir:'public',chunkNames:'assets/customer/[name]-[hash]',bundle:true,splitting:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
 await build({entryPoints:['src/real-estate-portfolio.js'],outfile:'public/real-estate-portfolio.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
 await build({entryPoints:['src/real-estate-project.js'],outfile:'public/real-estate-project.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
// Live operations workspace (/work) and customer tracking (/track).
await build({entryPoints:['src/operations/live-ui.mjs'],outfile:'public/work.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
await build({entryPoints:['src/operations/track-ui.mjs'],outfile:'public/track.js',bundle:true,format:'esm',minify:true,target:'es2022',legalComments:'eof'});
await import('./directory-pages.mjs');
console.log('Jowwa built; account backend '+(url&&key?'configured':'not configured'));
