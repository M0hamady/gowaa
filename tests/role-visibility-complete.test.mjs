import test from 'node:test';
import assert from 'node:assert/strict';
import {BUSINESS_PROFILES,businessProfile,permissionsFor,visibleBusinessData,canBusinessRole} from '../src/operations/business-types.mjs';
import {seedState} from '../src/operations/fixtures.mjs';
import {project} from '../src/operations/engine.mjs';
import {navItems} from '../src/operations/views.mjs';

const expectedScreens={
 restaurant:{owner:['floor','cashier','kitchen','stock','recipes','reports'],manager:['floor','cashier','kitchen','stock','recipes','reports'],floor_manager:['floor'],floor_worker:[],cashier:['cashier'],kitchen_worker:['kitchen']},
 supermarket:{owner:['sales','stock','receiving','shelves','reports'],manager:['sales','stock','receiving','shelves','reports'],cashier:['sales'],shelf_worker:['shelves'],stockkeeper:['stock','receiving'],receiving_clerk:['receiving'],delivery_worker:[]},
 service:{owner:['catalog','sales','reports'],staff:['catalog','sales']}
};

test('every business role receives exactly its allowed screens and no hidden screen leaks',()=>{
 for(const [type,profile] of Object.entries(BUSINESS_PROFILES))for(const role of Object.keys(profile.roles)){
  const view=visibleBusinessData(type,role),keys=Object.keys(view.screens).sort(),expected=(expectedScreens[type][role]||[]).sort();
  assert.deepEqual(keys,expected,`${type}/${role} screens`);
  assert.deepEqual(view.permissions.sort(),permissionsFor(type,role).sort(),`${type}/${role} permissions`);
  for(const [screen,key] of Object.entries(view.screens))assert.equal(profile.screens[screen],key,`${type}/${role}/${screen}`);
 }
});

test('sensitive business actions stay isolated by role across all restaurant and supermarket workers',()=>{
 for(const role of Object.keys(BUSINESS_PROFILES.restaurant.roles)){
  assert.equal(canBusinessRole('restaurant',role,'manage_staff'),role==='owner');
  assert.equal(canBusinessRole('restaurant',role,'take_payment'),['owner','manager','cashier'].includes(role));
  assert.equal(canBusinessRole('restaurant',role,'manage_recipes'),['owner','manager'].includes(role));
  assert.equal(canBusinessRole('restaurant',role,'view_kitchen'),['owner','manager','kitchen_worker'].includes(role));
 }
 for(const role of Object.keys(BUSINESS_PROFILES.supermarket.roles)){
  assert.equal(canBusinessRole('supermarket',role,'manage_suppliers'),['owner','stockkeeper'].includes(role));
  assert.equal(canBusinessRole('supermarket',role,'take_payment'),['owner','manager','cashier'].includes(role));
  assert.equal(canBusinessRole('supermarket',role,'receive_stock'),['owner','manager','stockkeeper','receiving_clerk'].includes(role));
  assert.equal(canBusinessRole('supermarket',role,'shelf_restock'),role==='shelf_worker');
 }
});

test('global navigation is restricted for customer, owner, cashier, courier, driver and admin',()=>{
 const s=seedState(), cases=[
  ['customer',['shops','orders','missions','messages','account']],
  ['owner',['orders','catalog','team','offers','cash','finance','missions','shops','messages','account']],
  ['cashier',['orders','cash','finance','missions','shops','messages','account']],
  ['courier',['missions','finance','shops','messages','account']],
  ['driver',['missions','finance','shops','messages','account']],
  ['admin',['approvals','areas','catalog','orders','missions','economy','finance','audit','messages','account']]
 ];
 for(const [actor,expected] of cases){const app={model:project(s,actor),actor};assert.deepEqual(navItems(app).map(x=>x[0]),expected,`${actor} navigation`);}
});

test('projected operation data is actor-scoped for all fixture personas',()=>{
 const s=seedState();
 for(const actor of ['customer','owner','cashier','courier','driver','admin']){
  const view=project(s,actor);assert.equal(view.mode,'test');assert.ok(Array.isArray(view.orders));assert.ok(Array.isArray(view.tasks));assert.ok(Array.isArray(view.events));
  if(actor==='courier'||actor==='driver')assert.deepEqual(view.roles.slice(1),[actor]);
  if(actor==='customer')assert.equal(view.roles.length,1);
  if(actor==='admin')assert.equal(view.user.admin,true);
 }
});
