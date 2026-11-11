import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APP_TABS,activeAppTab,appTabHref} from '../public/mobile-app-shell.js';

const source=name=>readFileSync(new URL('../public/'+name,import.meta.url),'utf8');

test('mobile navigation has five unique safe real app destinations',()=>{
 assert.deepEqual(APP_TABS.map(x=>x.id),['home','routes','services','market','mine']);
 assert.equal(new Set(APP_TABS.map(x=>x.href)).size,5);
 for(const item of APP_TABS){
  assert.equal(appTabHref(item.id),item.href);
  assert.ok(item.label);
  assert.match(item.href,/^\/(?!\/)/);
  assert.ok(!item.href.startsWith('//'));
 }
 assert.equal(appTabHref('not-a-tab'),null);
});

test('home remains main start screen and map route tab is separate',()=>{
 assert.equal(activeAppTab({pathname:'/',homeMode:true}),'home');
 assert.equal(activeAppTab({pathname:'/index.html',homeMode:true}),'home');
 assert.equal(activeAppTab({pathname:'/',hash:'#trip',homeMode:false}),'routes');
 assert.equal(activeAppTab({pathname:'/',hash:'#bus',homeMode:false}),'routes');
 assert.equal(activeAppTab({pathname:'/',hash:'#places',homeMode:false}),'routes');
 assert.equal(activeAppTab({pathname:'/',homeMode:false}),'routes');
});

test('real marketplace sections correctly select services, products and merchant area',()=>{
 for(const view of ['services','printing','directory'])assert.equal(activeAppTab({pathname:'/market',search:'?view='+view}),'services',view);
 assert.equal(activeAppTab({pathname:'/market'}),'market');
 assert.equal(activeAppTab({pathname:'/market.html',search:'?view=mine'}),'mine');
 assert.equal(activeAppTab({pathname:'/market',search:'?view=services',activeView:'browse'}),'market');
 assert.equal(activeAppTab({pathname:'/places'}),'services');
 assert.equal(activeAppTab({pathname:'/buses'}),'routes');
 assert.equal(activeAppTab({pathname:'/order/123'}),null);
 assert.equal(activeAppTab({pathname:'/work'}),null);
 assert.equal(activeAppTab({pathname:'/track'}),null);
});

test('existing Jowwa homepage is preserved and main navigation uses existing app actions',()=>{
 const html=source('index.html'),market=source('market.html'),ui=source('ui-controls.js');
 for(const id of ['home-screen','home-title','home-ai','home-back','trip-tab','bus-tab','places-tab'])assert.ok(html.includes('id="'+id+'"'),id);
 for(const view of ['browse','services','mine'])assert.ok(market.includes('data-view="'+view+'"'),view);
 assert.match(ui,/mountMobileAppNavigation\(\)/);
 assert.match(ui,/mobile-app-shell\.css/);
 assert.doesNotMatch(html,/id="jowwa-app-dock"/,'navigation should be progressively mounted, not cloned into home');
 const app=source('app.js');
 assert.match(app,/const linkedTab=location\.hash\.slice\(1\)/);
 assert.match(app,/if\(\['trip','bus','places'\]\.includes\(linkedTab\)\)tab\(linkedTab\)/);
});

test('safe-area dock cannot cover a live route or modal and keeps touch targets usable',()=>{
 const css=source('mobile-app-shell.css'),js=source('mobile-app-shell.js');
 assert.match(css,/safe-area-inset-bottom/);
 assert.match(css,/body\.navigating \.jowwa-app-dock\{display:none!important\}/);
 assert.match(css,/dialog\[open\]/);
 assert.match(css,/min-height:56px/);
 assert.match(css,/@media\(max-width:760px\)/);
 assert.match(js,/getElementById\('home-back'\)/);
 assert.match(js,/getElementById\('trip-tab'\)/);
 assert.match(js,/\.market-tabs \[data-view/);
 assert.match(js,/win\.addEventListener\('popstate'/);
});
