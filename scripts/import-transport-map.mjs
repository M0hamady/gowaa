import {readFile,writeFile} from 'node:fs/promises';
import {normalizeEgyptian} from '../public/egyptian-language.js';
import {haversine} from '../public/routing.js';

// Read-only export from the OSM Overpass API. No coordinates are interpolated.
// Usage: node scripts/import-transport-map.mjs /path/to/egypt-transport-osm.json
const raw=JSON.parse(await readFile(process.argv[2],'utf8'));
if(!Array.isArray(raw.elements)||raw.remark)throw Error('Incomplete Overpass export');
const rail=JSON.parse(await readFile('public/data/rail-network.json','utf8'));
const hubs=JSON.parse(await readFile('public/data/transport-hubs.json','utf8'));
const transit=JSON.parse(await readFile('public/data/transit.json','utf8'));
const clean=value=>String(value||'').replace(/[\u0000-\u001f\u007f<>\u200e\u200f]/g,' ').trim().slice(0,180);
const normalized=value=>normalizeEgyptian(clean(value)).replace(/\b(station|metro|cairo|subway)\b/g,' ').replace(/محطه(?: القطار الكهربائي الخفيف)?|مترو/g,' ').replace(/[^\p{L}\p{N}]/gu,'');
const names=tags=>[tags['name:ar'],tags.name,tags['name:en'],tags.alt_name,tags.old_name,tags.int_name].filter(Boolean).flatMap(value=>String(value).split(';')).map(clean);
const validCoordinate=point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)&&point[0]>=24&&point[0]<=37&&point[1]>=21.5&&point[1]<=32;
const coordinate=element=>[element.lon??element.center?.lon,element.lat??element.center?.lat];
const inactive=tags=>Object.entries(tags).some(([key,value])=>/^(construction|disused|abandoned|proposed|demolished|razed)(:railway)?$/.test(key)&&!['no','false','0'].includes(String(value)));
const mode=tags=>tags.amenity==='bus_station'?'bus':tags.station==='subway'||tags.subway==='yes'?'metro':tags.station==='light_rail'||tags.light_rail==='yes'?'lrt':'train';
const excluded=element=>{const t=element.tags||{};return inactive(t)||t.station==='monorail'||t.monorail==='yes'||t.tram==='yes'||t.station==='tram'||!validCoordinate(coordinate(element));};
const elements=raw.elements.filter(element=>!excluded(element));
// Explicit matching decisions after reviewing source names, mode and coordinates.
// Rod El-Farag Corridor is distinct from Rod El-Farag on Line 2. Robaiki LRT
// is distinct from the older ENR station with the same Arabic name.
const selected={
 'dar-el-salam':5194246947,'saint-teresa':316634831,'rod-el-farag':316634715,
 'kolleyet-el-banat':5007646022,'rod-el-farag-corridor':11328539169,
 'bulaq-el-dakrour':11923472313,'cairo-university':9162042095,'lrt-robaiki':9885200016
};
const railMatches=new Map(),canonicalElements=new Map();
for(const station of rail.stations){
 const terms=new Set([station.name,station.nameEn,...station.aliases].filter(Boolean).map(normalized));
 const wanted=station.lines.some(line=>line.startsWith('metro-'))?'metro':'lrt';
 let matches=elements.filter(element=>{
  const t=element.tags||{};
  if(wanted==='metro'&&mode(t)!=='metro'||wanted==='lrt'&&['metro','bus'].includes(mode(t)))return false;
  return names(t).some(name=>terms.has(normalized(name)));
 });
 const preferred=selected[station.id];
 if(preferred){const exact=elements.find(element=>element.type==='node'&&element.id===preferred);if(!exact)throw Error('Missing reviewed source '+station.id);matches=[exact,...matches.filter(element=>element!==exact)];}
 if(!matches.length)throw Error('No verified coordinate match for '+station.id);
 if(station.id==='rod-el-farag-corridor'){const duplicate=elements.find(element=>element.type==='node'&&element.id===11495591793);if(duplicate)matches.push(duplicate);}
 const chosen=matches[0],nearMatches=matches.filter(element=>haversine(coordinate(element),coordinate(chosen))<220);
 for(const element of nearMatches)canonicalElements.set(element.type+'/'+element.id,station);
 railMatches.set(station.id,chosen);
}
const records=[],deduplicated=[];
for(const element of elements){
 const tags=element.tags||{},canonical=canonicalElements.get(element.type+'/'+element.id);
 if(canonical&&railMatches.get(canonical.id)!==element){deduplicated.push(element.type+'/'+element.id);continue;}
 const stationMode=canonical?(canonical.lines.some(line=>line.startsWith('metro-'))?'metro':'lrt'):mode(tags);
 const title=canonical?.name||clean(tags['name:ar']||tags.name||tags['name:en'])||({bus:'موقف — الاسم غير متاح',train:'محطة قطار — الاسم غير متاح',metro:'محطة مترو — الاسم غير متاح',lrt:'محطة LRT — الاسم غير متاح'}[stationMode]);
 const point=coordinate(element),aliases=[...new Set([...(canonical?.aliases||[]),...names(tags)].filter(name=>name!==title))];
 const duplicate=records.find(row=>row.mode===stationMode&&row.name===title&&!title.includes('غير متاح')&&haversine(row.coordinate,point)<180);
 if(duplicate){deduplicated.push(element.type+'/'+element.id);continue;}
 records.push({id:canonical?'rail-'+canonical.id:'osm-'+element.type+'-'+element.id,name:title,...(tags['name:en']?{nameEn:clean(tags['name:en'])}:{}),aliases,mode:stationMode,coordinate:point,lineIds:canonical?.lines||[],sourceId:'osm-eg-20261106',sourceUrl:'https://www.openstreetmap.org/'+element.type+'/'+element.id,locationStatus:'osm_reference',scheduleStatus:canonical?'published_reference':'unconfirmed',...(canonical?{railStationId:canonical.id}:{}),...(tags.railway==='halt'?{stationType:'halt'}:{})});
}
// The node and building outline refer to the same Turgoman terminal.
const turgoman=records.find(row=>row.id==='osm-node-3232969796');
if(turgoman){
 turgoman.id='terminal-turgoman';turgoman.aliases=[...new Set([...turgoman.aliases,'الترجمان','محطة الترجمان','ميناء القاهرة البري','بوابة القاهرة','Cairo Gateway','Turgoman'])];
 const duplicate=records.findIndex(row=>row.id==='osm-way-28800674');if(duplicate>=0){records.splice(duplicate,1);deduplicated.push('way/28800674');}
}
for(const hub of hubs.hubs){
 const point=hub.location?[hub.location.lng,hub.location.lat]:null;
 if(!validCoordinate(point))continue;
 records.push({id:'hub-'+hub.id,name:hub.name,aliases:hub.aliases||[],mode:'bus',coordinate:point,lineIds:[],sourceId:'jowwa-owner-hubs',sourceUrl:hub.mapUrl,locationStatus:'user_shared_pin',scheduleStatus:'operating_window',hubId:hub.id,operatingWindow:hub.operatingWindow});
}
for(const route of transit.routes){
 if(!validCoordinate(route.pickup?.coordinate))continue;
 records.push({id:'bus-pickup-'+route.id,name:route.pickup.name,aliases:[route.name],mode:'bus',coordinate:route.pickup.coordinate,lineIds:[route.id],sourceId:'jowwa-local-transit',sourceUrl:route.links?.pickup,locationStatus:'published_pickup',scheduleStatus:route.status==='published'?'published_reference':'unconfirmed',routeUrl:'/bus/'+route.id});
}
for(const row of records){
 if(!['bus','train'].includes(row.mode))continue;
 const near=records.filter(station=>['metro','lrt'].includes(station.mode)).map(station=>({stationId:station.id,name:station.name,mode:station.mode,distanceMeters:Math.round(haversine(row.coordinate,station.coordinate)),relation:'straight_line_only'})).filter(station=>station.distanceMeters<=1200).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,3);
 if(near.length)row.nearbyRail=near;
}
const output={schemaVersion:1,reviewedAt:'2026-11-06',osmBaseTimestamp:raw.osm3s?.timestamp_osm_base,coverageNote:'محطات ومواقف مسجّلة على الخريطة في مصر، مع مطابقة محطات المترو والـLRT للمصادر المنشورة. البيانات ليست حصرًا ميدانيًا كاملًا أو إثبات تشغيل كل موقف. المسافة القريبة خط مستقيم، وليست مسار مشي أو تبديلًا مضمونًا.',sources:[{id:'osm-eg-20261106',title:'OpenStreetMap contributors — محطات ومواقف مصر',url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',licenseUrl:'https://opendatacommons.org/licenses/odbl/1-0/',query:'area["ISO3166-1"="EG"][admin_level=2]; nwr railway=station|halt and amenity=bus_station',dataUrl:'/data/transport-map.json'},{id:'jowwa-owner-hubs',title:'مواقع ومعلومات المواقف المقدمة من إدارة جوه',url:'/?transport=1'},{id:'jowwa-local-transit',title:'نقاط ركوب منشورة في دليل مواصلات جوه',url:'/buses'}],statistics:{rawRecords:raw.elements.length,excludedRecords:raw.elements.length-elements.length,deduplicatedRecords:deduplicated.length,matchedRailStations:railMatches.size,counts:Object.fromEntries(['train','metro','lrt','bus'].map(mode=>[mode,records.filter(row=>row.mode===mode).length]))},stations:records.sort((a,b)=>a.mode.localeCompare(b.mode)||a.name.localeCompare(b.name,'ar'))};
await writeFile('public/data/transport-map.json',JSON.stringify(output)+'\n');
for(const station of rail.stations){const match=railMatches.get(station.id);station.coordinate=coordinate(match);station.mapStationId='rail-'+station.id;station.mapUrl='/?transport=1&station='+station.mapStationId;station.coordinateSourceUrl='https://www.openstreetmap.org/'+match.type+'/'+match.id;station.locationStatus='osm_reference';}
rail.limitations=rail.limitations.map(note=>note.startsWith('لا توجد إحداثيات')?'إحداثيات المحطات من OpenStreetMap للموقع المرجعي، وليست مداخل مؤكدة أو مسارات مشي. لا أوقات وصول أو مدد مشي مصطنعة.':note);
await writeFile('public/data/rail-network.json',JSON.stringify(rail,null,2)+'\n');
console.log(JSON.stringify(output.statistics));
