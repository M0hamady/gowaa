import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProject, visibleProjects, MAX_PROJECT_IMAGES, EGYPT_MAP_BOUNDS } from '../src/real-estate-map-core.mjs';

const valid = (overrides = {}) => ({id:'p-1',title:'مشروع تجريبي',lat:30.05,lng:31.2,images:['https://example.com/1.jpg'],status:'approved',finish:'سوبر لوكس',area:'القاهرة الجديدة',providerId:'provider-1',...overrides});

test('accepts a valid project inside Egypt with up to ten HTTPS images',()=>{
 const project=validateProject(valid({images:Array.from({length:MAX_PROJECT_IMAGES},(_,i)=>`https://example.com/${i}.jpg`)}));
 assert.equal(project.images.length,10);
 assert.equal(project.lat,30.05);
});

test('rejects an eleventh project image',()=>{
 assert.throws(()=>validateProject(valid({images:Array.from({length:11},(_,i)=>`https://example.com/${i}.jpg`)})),/10 صور/);
});

test('rejects coordinates outside Egypt',()=>{
 assert.throws(()=>validateProject(valid({lat:40,lng:31})),/داخل حدود مصر/);
 assert.ok(EGYPT_MAP_BOUNDS.north>31);
});

test('rejects non-HTTPS image URLs',()=>{
 assert.throws(()=>validateProject(valid({images:['http://example.com/photo.jpg']})),/HTTPS/);
});

test('public map filters only approved projects and respects selected facets',()=>{
 const projects=[valid(),valid({id:'p-2',status:'pending'}),valid({id:'p-3',finish:'اقتصادي'}),valid({id:'p-4',providerId:'other'})];
 assert.deepEqual(visibleProjects(projects),[projects[0],projects[2],projects[3]]);
 assert.deepEqual(visibleProjects(projects,{finish:'سوبر لوكس'}),[projects[0],projects[3]]);
 assert.deepEqual(visibleProjects(projects,{provider:'other'}),[projects[3]]);
});
