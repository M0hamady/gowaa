import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

let folder, memberFetch;
test.before(async () => {
  folder = await mkdtemp(join(tmpdir(), 'jowwa-member-fetch-'));
  const output = join(folder, 'member.mjs');
  // Build the actual request helper without a configured identity provider.
  await build({entryPoints:[new URL('../src/member-access.js',import.meta.url).pathname],outfile:output,bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[{
    name:'isolated-config',setup(b){b.onResolve({filter:/\/config\.js$/},()=>({path:'fixture-config',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export default {};',loader:'js'}));},
  }]});
  ({memberFetch} = await import(pathToFileURL(output).href));
});
test.after(async () => {if(folder)await rm(folder,{recursive:true,force:true});});

function abortable(signal) {
  return new Promise((_resolve,reject) => {
    if(signal.aborted)reject(signal.reason);
    else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
}

test('a caller cancellation signal does not remove the network deadline', async () => {
  const originalFetch=globalThis.fetch, originalTimer=globalThis.setTimeout;
  const external=new AbortController();let combined;
  globalThis.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===12000?15:ms,...args);
  globalThis.fetch=(_url,{signal})=>{combined=signal;return abortable(signal);};
  try{
    await assert.rejects(memberFetch('/fixture/hung',{signal:external.signal}),error=>error.name==='TimeoutError');
    assert.notEqual(combined,external.signal);
    assert.equal(external.signal.aborted,false,'timeout does not cancel unrelated work owned by the caller');
  }finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
});

test('a superseding request can still abort immediately', async () => {
  const originalFetch=globalThis.fetch, external=new AbortController();
  globalThis.fetch=(_url,{signal})=>abortable(signal);
  try{
    const pending=memberFetch('/fixture/superseded',{signal:external.signal});
    external.abort(new DOMException('Superseded','AbortError'));
    await assert.rejects(pending,error=>error.name==='AbortError');
  }finally{globalThis.fetch=originalFetch;}
});

test('timeout while reading a response body remains an error, not a successful quote', async () => {
  const originalFetch=globalThis.fetch, originalTimer=globalThis.setTimeout;
  globalThis.setTimeout=(fn,ms,...args)=>originalTimer(fn,ms===12000?15:ms,...args);
  globalThis.fetch=async(_url,{signal})=>({ok:true,status:200,json:()=>abortable(signal)});
  try{await assert.rejects(memberFetch('/fixture/hung-body',{signal:new AbortController().signal}),error=>error.name==='TimeoutError');}
  finally{globalThis.fetch=originalFetch;globalThis.setTimeout=originalTimer;}
});
