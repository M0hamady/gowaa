import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState} from '../src/operations/fixtures.mjs';
import {execute,project} from '../src/operations/engine.mjs';
import {hasShopPermission,shopPermissionSet} from '../src/operations/core.mjs';

const NOW=Date.parse('2026-11-05T06:30:00Z');
function world(){let s=seedState(NOW),n=0;return{get s(){return s},run(actor,type,body={}){const out=execute(s,actor,{id:'staff-'+(++n),type,body,expectedRevision:s.revision},{now:NOW});s=out.state;return out.result;},reject(actor,type,body,code){const before=structuredClone(s);assert.throws(()=>this.run(actor,type,body),e=>e.code===code);assert.deepEqual(s,before);}};}

test('owner creates a shop manager with isolated test PIN and granular permissions',()=>{
 const w=world();const r=w.run('owner','staff.create',{shopId:'shop-a',name:'مدير جديد',internalCode:'MGR-22',pin:'2244',role:'shop_manager',grantedPermissions:['manage_staff'],deniedPermissions:['manage_settings'],status:'active',reason:'اختبار إنشاء مدير'});
 const m=w.s.team[r.id];assert.equal(m.role,'shop_manager');assert.equal(m.status,'active');assert.match(m.pinFingerprint,/^testpin-/);assert.equal(w.s.users[r.userId].internal,true);assert.equal(hasShopPermission(w.s,r.userId,'shop-a','view_orders'),true);assert.equal(hasShopPermission(w.s,r.userId,'shop-a','manage_settings'),false);assert.equal(w.s.auditLog.at(-1).kind,'staff_created');
});

test('shop manager cannot create another manager without explicit manage_managers permission',()=>{
 const w=world();w.reject('manager','staff.create',{shopId:'shop-a',name:'مدير ثان',internalCode:'MGR-02',pin:'1234',role:'shop_manager',status:'active',grantedPermissions:[],deniedPermissions:[],reason:'محاولة إنشاء مدير'},'FORBIDDEN');
 const member=w.s.team['manager-member'];w.run('owner','staff.update',{id:member.id,version:member.version,role:member.role,grantedPermissions:['manage_staff','manage_managers'],deniedPermissions:['manage_settings'],reason:'تفويض إنشاء مديرين'});
 const r=w.run('manager','staff.create',{shopId:'shop-a',name:'مدير مفوض',internalCode:'MGR-03',pin:'3456',role:'shop_manager',status:'active',grantedPermissions:[],deniedPermissions:[],reason:'اختبار تفويض مدير'});assert.equal(w.s.team[r.id].role,'shop_manager');
});

test('manager can create cashier kitchen waiter and floor manager but cannot grant sensitive owner permissions',()=>{
 const w=world();for(const [role,code] of [['cashier','C-11'],['kitchen','K-11'],['waiter','W-11'],['floor_manager','F-11']]){const r=w.run('manager','staff.create',{shopId:'shop-a',name:'موظف '+role,internalCode:code,pin:'4567',role,status:'active',grantedPermissions:[],deniedPermissions:[],reason:'إضافة موظف للتشغيل'});assert.equal(w.s.team[r.id].role,role);}
 w.reject('manager','staff.create',{shopId:'shop-a',name:'موظف حساس',internalCode:'X-11',pin:'4567',role:'cashier',status:'active',grantedPermissions:['manage_settings'],deniedPermissions:[],reason:'اختبار منع صلاحية حساسة'},'FORBIDDEN');
});

test('role presets expose only the expected minimum operational permissions',()=>{
 const s=seedState(NOW);
 assert.equal(hasShopPermission(s,'cashier','shop-a','take_payment'),true);assert.equal(hasShopPermission(s,'cashier','shop-a','manage_recipes'),false);
 assert.equal(hasShopPermission(s,'kitchen','shop-a','view_kitchen'),true);assert.equal(hasShopPermission(s,'kitchen','shop-a','take_payment'),false);assert.equal(hasShopPermission(s,'kitchen','shop-a','manage_products'),false);
 assert.equal(hasShopPermission(s,'waiter','shop-a','edit_open_order'),true);assert.equal(hasShopPermission(s,'waiter','shop-a','view_reports'),false);
 assert.equal(hasShopPermission(s,'floorManager','shop-a','manage_tables'),true);assert.equal(hasShopPermission(s,'floorManager','shop-a','manage_staff'),false);
});

test('custom permissions augment one employee without changing the role preset',()=>{
 const w=world(),m=w.s.team['waiter-member'];w.run('owner','staff.update',{id:m.id,version:m.version,role:'waiter',grantedPermissions:['approve_discount'],deniedPermissions:[],reason:'السماح للعامل بخصم محدود في الاختبار'});
 assert.equal(w.s.team[m.id].role,'waiter');assert.equal(hasShopPermission(w.s,'waiter','shop-a','approve_discount'),true);assert.equal(hasShopPermission(w.s,'waiter','shop-a','view_reports'),false);
 assert.equal(w.s.auditLog.at(-1).kind,'staff_permissions_changed');
});

test('suspending an employee removes access immediately but preserves history and old records',()=>{
 const w=world();assert.equal(hasShopPermission(w.s,'cashier','shop-a','take_payment'),true);const m=w.s.team['cashier-member'];w.run('owner','staff.status',{id:m.id,version:m.version,status:'suspended',reason:'إيقاف فوري للاختبار'});assert.equal(hasShopPermission(w.s,'cashier','shop-a','take_payment'),false);assert.equal(project(w.s,'cashier').employeeRoles.length,0);assert.ok(w.s.team[m.id]);assert.equal(w.s.auditLog.at(-1).before.status,'active');
});

test('staff projection does not leak all employee accounts to ordinary workers',()=>{
 const s=seedState(NOW),k=project(s,'kitchen'),owner=project(s,'owner'),manager=project(s,'manager');
 assert.equal(k.team.filter(x=>x.userId!=='kitchen').length,0);
 assert.ok(owner.team.length>=5);assert.ok(manager.team.length>=5);
 assert.equal(k.auditLog.length,0);assert.ok(owner.auditLog.length===0);
});

test('last activity updates only when an active employee performs a command',()=>{
 const w=world(),before=w.s.team['cashier-member'].lastActiveAt;w.run('cashier','shift.open',{shopId:'shop-a',opening:0});assert.notEqual(w.s.team['cashier-member'].lastActiveAt,before);
});

test('suspended employee loses old assigned order visibility while the historical order remains for management',()=>{
 const w=world(),id=w.run('waiter','restaurant.order.open',{shopId:'shop-a',mode:'dine_in',tableId:'table-4',requestId:'suspend-history'}).id;w.run('waiter','restaurant.order.add_item',{id,version:w.s.restaurantOrders[id].version,productId:'meal',quantity:1});const m=w.s.team['waiter-member'];w.run('owner','staff.status',{id:m.id,version:m.version,status:'suspended',reason:'إيقاف بعد فتح طلب'});assert.equal(project(w.s,'waiter').restaurantOrders.length,0);assert.ok(project(w.s,'manager').restaurantOrders.some(x=>x.id===id));assert.ok(w.s.restaurantOrders[id]);
});
