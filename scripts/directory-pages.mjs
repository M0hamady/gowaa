import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {directoryPlaces} from '../public/directory-core.js';
import {renderPlace,renderDirectory} from '../src/place-render.mjs';
const curated=JSON.parse(await readFile('public/data/directory.json','utf8'));
const map=JSON.parse(await readFile('public/data/map.json','utf8'));
const places=directoryPlaces(curated,map);
await writeFile('src/directory-urls.mjs','export default '+JSON.stringify(places.map(p=>p.url))+';\n');
await writeFile('public/data/places.json',JSON.stringify(places));
const output=resolve('public/place');
await mkdir(output,{recursive:true});
if(process.env.VERCEL==='1'||process.argv.includes('--production')){
 // Static pages take precedence over live ownership/hours rewrites.
 // Remove only generated HTML files from this exact output directory.
 for(const name of await readdir(output)){
  const file=resolve(output,name);
  if(dirname(file)!==output||!name.endsWith('.html'))continue;
  await unlink(file);
 }
 await unlink(resolve('public/places.html')).catch(error=>{if(error.code!=='ENOENT')throw error;});
 console.log('Directory: '+places.length+' live service routes');
}else{
 const hours=JSON.parse(await readFile('public/data/business-hours.json','utf8'));
 const referenceHours=new Map((hours.records||[]).map(row=>[row.placeId,row]));
 for(const place of places){
  if(!/^[a-zA-Z0-9_-]+$/.test(place.id))throw Error('Invalid directory id');
  await writeFile(resolve(output,place.id+'.html'),renderPlace(place,places,{referenceHours:referenceHours.get(place.id)}));
 }
 await writeFile('public/places.html',renderDirectory(places,'',{referenceHours}));
 console.log('Directory: '+places.length+' local preview pages; production uses live routes');
}
