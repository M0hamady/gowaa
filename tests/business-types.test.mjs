import test from 'node:test';
import assert from 'node:assert/strict';
import {BUSINESS_PROFILES,businessProfile,normalizeBusinessType,permissionsFor,canBusinessRole,visibleBusinessData} from '../src/operations/business-types.mjs';

test('restaurant and supermarket have separate role sets',()=>{
 assert.deepEqual(Object.keys(BUSINESS_PROFILES.restaurant.roles),['owner','manager','floor_manager','floor_worker','cashier','kitchen_worker']);
 assert.deepEqual(Object.keys(BUSINESS_PROFILES.supermarket.roles),['owner','manager','cashier','shelf_worker','stockkeeper','receiving_clerk','delivery_worker']);
 assert.notDeepEqual(permissionsFor('restaurant','kitchen_worker'),permissionsFor('supermarket','shelf_worker'));
});

test('business type normalization does not collapse restaurant and supermarket',()=>{
 assert.equal(normalizeBusinessType('مطاعم'),'restaurant');
 assert.equal(normalizeBusinessType('بقالة'),'supermarket');
 assert.equal(normalizeBusinessType('supermarket'),'supermarket');
 assert.equal(businessProfile('مطاعم').label,'مطعم / محل أكل');
});

test('restaurant permissions protect the kitchen and recipes',()=>{
 assert.equal(canBusinessRole('restaurant','kitchen_worker','view_kitchen'),true);
 assert.equal(canBusinessRole('restaurant','kitchen_worker','take_payment'),false);
 assert.equal(canBusinessRole('restaurant','manager','manage_recipes'),true);
 assert.equal(canBusinessRole('restaurant','floor_worker','view_reports'),false);
});

test('supermarket permissions protect receiving and shelf work',()=>{
 assert.equal(canBusinessRole('supermarket','receiving_clerk','receive_stock'),true);
 assert.equal(canBusinessRole('supermarket','receiving_clerk','take_payment'),false);
 assert.equal(canBusinessRole('supermarket','shelf_worker','shelf_restock'),true);
 assert.equal(canBusinessRole('supermarket','cashier','manage_suppliers'),false);
});

test('home service provider gets a simple catalog flow',()=>{
 assert.equal(canBusinessRole('service','owner','manage_categories'),true);
 assert.equal(canBusinessRole('service','owner','manage_products'),true);
 assert.equal(canBusinessRole('service','owner','manage_tables'),false);
 assert.equal(visibleBusinessData('service','owner').screens.catalog,'catalog');
});

test('visible screens are role-scoped',()=>{
 const kitchen=visibleBusinessData('restaurant','kitchen_worker');
 assert.equal(kitchen.screens.kitchen,'kds');
 assert.equal(kitchen.screens.recipes,undefined);
 const stock=visibleBusinessData('supermarket','stockkeeper');
 assert.equal(stock.screens.stock,'warehouse');
 assert.equal(stock.screens.receiving,'receiving');
 assert.equal(stock.screens.sales,undefined);
});
