import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareMarketRouting} from '../scripts/prepare-market-routing.mjs';

test('production market asset cannot shadow printing routes and preserves the ordinary shell byte for byte',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'jowwa-market-routing-'));
 try{
  const shell=await readFile(new URL('../public/market.html',import.meta.url));
  await writeFile(join(directory,'market.html'),shell);
  await writeFile(join(directory,'index.html'),'unchanged homepage');
  await writeFile(join(directory,'place.html'),'unchanged service');
  await prepareMarketRouting(pathToFileURL(directory+'/'));
  await assert.rejects(access(join(directory,'market.html')),{code:'ENOENT'});
  assert.deepEqual(await readFile(join(directory,'market-shell.html')),shell);
  assert.equal(await readFile(join(directory,'index.html'),'utf8'),'unchanged homepage');
  assert.equal(await readFile(join(directory,'place.html'),'utf8'),'unchanged service');
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  assert.equal(config.rewrites.find(route=>route.source==='/market'&&!route.has)?.destination,'/market-shell');
  assert.equal(config.rewrites.find(route=>route.source==='/market/category/:category')?.destination,'/market-shell');
  assert.equal(config.redirects.find(route=>route.source==='/market.html')?.destination,'/market');
  const build=await readFile(new URL('../scripts/build-live.mjs',import.meta.url),'utf8');
  assert.ok(build.indexOf("await import('./build.mjs')")<build.indexOf('await prepareMarketRouting()'),'generate template before moving the production asset');
 }finally{await rm(directory,{recursive:true,force:true});}
});
