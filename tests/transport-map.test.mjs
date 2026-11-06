import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseTransportMapData,loadTransportMapData,filterTransportStations,clusterTransportStations,transportCoordinate,transportMapLinks,transportStationLink} from '../public/transport-map.js';

const raw=JSON.parse(await readFile(new URL('../public/data/transport-map.json',import.meta.url),'utf8'));
const rail=JSON.parse(await readFile(new URL('../public/data/rail-network.json',import.meta.url),'utf8'));
const catalog=parseTransportMapData(raw);
const fixture=(id,overrides={})=>({id,name:'محطة '+id,coordinate:[31,30],mode:'metro',lineIds:['metro-1'],aliases:[],sourceUrl:'https://www.openstreetmap.org/node/1',locationStatus:'osm_reference',scheduleStatus:'unconfirmed',...overrides});

test('all source records are renderable and every official rail station has a mapped point without losing shared Adly Mansour',()=>{
 assert.equal(catalog.discardedCount,0);assert.equal(catalog.stations.length,raw.stations.length);assert.ok(catalog.stations.length>1000);
 for(const station of rail.stations)assert.ok(catalog.stations.some(point=>point.railStationId===station.id),'unmapped rail station '+station.id);
 assert.equal(filterTransportStations(catalog.stations,{mode:'lrt'}).length,12);
 assert.ok(filterTransportStations(catalog.stations,{mode:'lrt'}).some(s=>s.railStationId==='adly-mansour'));
 assert.ok(filterTransportStations(catalog.stations,{mode:'metro'}).some(s=>s.railStationId==='adly-mansour'));
 assert.equal(new Set(catalog.stations.map(s=>s.id)).size,catalog.stations.length);
 const pickup=catalog.stations.find(s=>s.locationStatus==='published_pickup');assert.ok(pickup?.routeUrl?.startsWith('/bus/'));
});
test('Arabic and English aliases resolve stations while filters preserve bus/train distinction',()=>{
 const rows=parseTransportMapData({schemaVersion:1,stations:[fixture('ramses',{name:'الشهداء',nameEn:'El Shohadaa',aliases:['رَمسيس','محطة مصر']}),fixture('bus',{mode:'bus',name:'موقف رمسيس',lineIds:[]})]}).stations;
 assert.equal(filterTransportStations(rows,{query:'رمسيس',mode:'metro'})[0].id,'ramses');
 assert.equal(filterTransportStations(rows,{query:'SHOHADAA'})[0].id,'ramses');
 assert.equal(filterTransportStations(rows,{query:'مصر'}).length,1);
 assert.equal(filterTransportStations(rows,{query:'رمسيس',mode:'train'}).length,0);
 assert.equal(filterTransportStations(rows,{query:'رمسيس',mode:'bus'}).length,1);
 assert.deepEqual(filterTransportStations(rows,{ids:['bus']}).map(s=>s.id),['bus']);
});
test('invalid coordinates, duplicate identities, unsafe links and invented nearby links cannot become actionable map data',()=>{
 const rows=[fixture('valid',{sourceUrl:'javascript:alert(1)',routeUrl:'/bus/invented',nearbyRail:[{stationId:'other',name:'forged',distanceMeters:30,relation:'straight_line_only'},{stationId:'missing',distanceMeters:20,relation:'straight_line_only'},{stationId:'other',distanceMeters:2,relation:'guaranteed_walk'}]}),fixture('other',{name:'المحطة الصحيحة'}),fixture('bad-coordinate',{coordinate:[31,NaN]}),fixture('bad-mode',{mode:'flight'}),fixture('valid')];
 const parsed=parseTransportMapData({schemaVersion:1,stations:rows});assert.equal(parsed.stations.length,2);assert.equal(parsed.discardedCount,3);assert.equal(parsed.stations[0].sourceUrl,null);assert.deepEqual(parsed.stations[0].nearbyRail,[{stationId:'other',name:'المحطة الصحيحة',mode:'metro',distanceMeters:30,relation:'straight_line_only'}]);
 assert.equal(parsed.stations[0].routeUrl,null);assert.equal(transportCoordinate({coordinate:[31,30,10]}),null);assert.equal(transportCoordinate([181,30]),null);assert.equal(transportCoordinate(['31',30]),null);
 assert.throws(()=>parseTransportMapData({schemaVersion:2,stations:[]}));
});
test('nearby rail hints are at most three source-backed straight-line references within 1200m',()=>{
 for(const station of catalog.stations){assert.ok(station.nearbyRail.length<=3);for(const neighbor of station.nearbyRail){assert.ok(neighbor.distanceMeters>=0&&neighbor.distanceMeters<=1200);assert.equal(neighbor.relation,'straight_line_only');assert.ok(catalog.stations.some(s=>s.id===neighbor.stationId));}}
 const sample=catalog.stations.find(s=>s.nearbyRail.length);assert.ok(sample,'expected mapped proximity references');
});
test('catalog is fetched only on demand, concurrent consumers share one request, and success is reused',async()=>{
 let requests=0,release;const ready=new Promise(resolve=>{release=resolve;});
 const fetcher=async()=>{requests++;await ready;return {ok:true,json:async()=>({schemaVersion:1,stations:[fixture('one')]})};};
 assert.equal(requests,0);const first=loadTransportMapData({fetcher}),second=loadTransportMapData({fetcher});assert.equal(first,second);await Promise.resolve();assert.equal(requests,1);release();
 const result=await first;assert.equal(result.stations.length,1);assert.equal(await loadTransportMapData({fetcher}),result);assert.equal(requests,1);
});
test('failed or malformed data requests clear their shared cache and permit an explicit retry',async()=>{
 let count=0;const fetcher=async()=>({ok:true,json:async()=>++count===1?{stations:[]}:{schemaVersion:1,stations:[fixture('ok')]}});
 await assert.rejects(loadTransportMapData({fetcher}));assert.equal((await loadTransportMapData({fetcher})).stations[0].id,'ok');assert.equal(count,2);
});
test('viewport filtering avoids projecting offscreen stations and pixel clustering bounds marker count without losing visible records',()=>{
 const rows=Array.from({length:5000},(_,i)=>fixture('s-'+i,{coordinate:[i%100,Math.floor(i/100)]}));let projected=0;
 const visible=rows.filter(s=>s.coordinate[0]<40),clusters=clusterTransportStations(rows,c=>{projected++;return{x:c[0]*70,y:c[1]*70};},{contains:c=>c[0]<40,maxMarkers:100});
 assert.equal(projected,visible.length);assert.ok(clusters.length<=100);assert.equal(clusters.reduce((sum,g)=>sum+g.stations.length,0),visible.length);assert.ok(clusters.every(g=>g.coordinate.every(Number.isFinite)));
 assert.deepEqual(clusterTransportStations(rows,()=>({x:NaN,y:0})),[]);
});
test('directions use longitude/latitude correctly, omit unknown origins, and stable links contain station IDs only',()=>{
 const station={id:'rail-adly-mansour',coordinate:[31.42,30.14]},links=transportMapLinks(station);
 assert.equal(new URL(links.map).searchParams.get('query'),'30.14,31.42');assert.equal(new URL(links.directions).searchParams.has('origin'),false);
 const origin={coordinate:[31.62,29.93]},withOrigin=new URL(transportMapLinks(station,origin).directions);assert.equal(withOrigin.searchParams.get('origin'),'29.93,31.62');assert.equal(withOrigin.searchParams.get('destination'),'30.14,31.42');
 assert.equal(new URL(transportMapLinks(station,{coordinate:['private',30]}).directions).searchParams.has('origin'),false);
 assert.equal(transportStationLink(station.id),'/?transport=1&station=rail-adly-mansour');assert.equal(transportStationLink('bad&origin=private'),'/?transport=1');
 assert.ok(!transportStationLink(station.id).includes('31.62'));assert.equal(transportMapLinks({coordinate:null}).map,null);
});
