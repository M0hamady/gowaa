import {readFile,writeFile,mkdir,readdir,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {directoryPlaces} from '../public/directory-core.js';
import {mergeDirectoryUpdates} from '../public/directory-updates.js';
import {renderPlace,renderDirectory} from '../src/place-render.mjs';
import {kayanMeatsCatalog} from '../public/kayan-meats.js';
// Merge catalog idempotently so local, previews and production see the same products.
const catalogPath='public/data/market-directory.json';
const catalogText=await readFile(catalogPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
// Directory-only fixtures have no product catalog. Production does.
if(catalogText!==null){
 const catalog=JSON.parse(catalogText);
 const sourceRows=Array.isArray(catalog)?catalog:catalog.items;
 if(!Array.isArray(sourceRows))throw Error('Expected market catalog items');
 // Refresh source-owned fields on every build, not only on first insertion.
 // Otherwise an existing live catalog keeps old poster images after the shop sends new photos.
 const byId=new Map(sourceRows.map((row,index)=>[row.id,index]));
 for(const product of kayanMeatsCatalog){
  const index=byId.get(product.id);
  if(index===undefined){byId.set(product.id,sourceRows.length);sourceRows.push(product);}
  else sourceRows[index]={...sourceRows[index],...product};
 }
 await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
}
const curated=mergeDirectoryUpdates(JSON.parse(await readFile('public/data/directory.json','utf8')));
const map=JSON.parse(await readFile('public/data/map.json','utf8'));
const places=directoryPlaces(curated,map);
// Keep home, market, AI and server-rendered pages on the same idempotently merged data.
await writeFile('public/data/directory.json',JSON.stringify(curated,null,2)+'\n');
await writeFile('src/directory-urls.mjs','export default '+JSON.stringify(places.map(p=>p.url))+';\n');
await writeFile('public/data/places.json',JSON.stringify(places));
const output=resolve('public/place');
await mkdir(output,{recursive:true});
if(process.env.VERCEL==='1'||process.argv.includes('--production')){
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
  await writeFile(resolve(output,place.id+'.html'),renderPlace(place,places,{referenceHours:referenceHours.get(place.id)}).replace('</head>','<script type="module" src="/place-basket.js"></script></head>'));
 }
 await writeFile('public/places.html',renderDirectory(places,'',{referenceHours}));
 console.log('Directory: '+places.length+' local preview pages; production uses live routes');
}
