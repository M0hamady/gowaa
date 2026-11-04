import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,access,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
test('production directory output cannot shadow live service approval and working hours',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'jowwa-live-routes-'));
 try{
  for(const dir of ['public/data','public/place','src'])await mkdir(join(folder,dir),{recursive:true});
  await writeFile(join(folder,'public/data/directory.json'),'[]');await writeFile(join(folder,'public/data/map.json'),'{"pois":[]}');
  await writeFile(join(folder,'public/place/stale.html'),'old static page');await writeFile(join(folder,'public/place/keep.txt'),'keep');await writeFile(join(folder,'public/places.html'),'stale directory');
  await promisify(execFile)(process.execPath,[fileURLToPath(new URL('../scripts/directory-pages.mjs',import.meta.url)),'--production'],{cwd:folder});
  assert.deepEqual(await readdir(join(folder,'public/place')),['keep.txt']);await assert.rejects(access(join(folder,'public/places.html')));await access(join(folder,'public/data/places.json'));
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('jowwa-live-routes-'));await rm(folder,{recursive:true,force:true});}
});
