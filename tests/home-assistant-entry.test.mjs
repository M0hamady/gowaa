import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('home has one assistant entry and keeps optional quick categories collapsed',()=>{
 const html=read('public/index.html'),app=read('public/app.js');
 assert.match(html,/id="home-ai"/);
 assert.doesNotMatch(html,/home-search-form|id="home-search"|قولنا بالبلدي/);
 assert.match(html,/<details class="home-shortcuts">/);
 assert.match(html,/class="home-shortcuts-title"/);
 assert.match(html,/id="home-journey-stage"/);
 assert.equal((html.match(/data-home-action=/g)||[]).length,10);
 assert.match(html,/>البنوك والصرافات</);
 assert.doesNotMatch(html,/<details class="home-shortcuts"[^>]*open/);
 assert.match(app,/assistant\.ask\(query\)/);
 assert.match(app,/const actionQueries=/);
 assert.doesNotMatch(app,/mountWelcomeJourney|welcomeActions/);
});

test('home quick actions reuse the assistant instead of creating another input',()=>{
 const html=read('public/index.html'),app=read('public/app.js');
 assert.equal((html.match(/<input\b/g)||[]).filter(x=>x).length,0);
 assert.match(app,/assistant\?\.ask/);
 assert.match(app,/root\.querySelector\('\.home-shortcuts'\)\.open=false/);
});
