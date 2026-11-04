const {chromium}=require('playwright');const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
 const out='public/qa/merchant-guide';fs.mkdirSync(out,{recursive:true});for(const f of fs.readdirSync(out))fs.unlinkSync(out+'/'+f);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:390,height:844},locale:'ar-EG'});const page=await context.newPage();page.setDefaultTimeout(9000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const shots=[];let seq=0;
 async function ss(slug,title,section,note=''){seq++;const file=String(seq).padStart(2,'0')+'-'+slug+'.png';await page.screenshot({path:out+'/'+file,fullPage:false});shots.push({file,title,section,note});console.log('SHOT',file,title);}
 async function persona(id){await page.selectOption('#ops-persona',id);await page.waitForTimeout(160);}
 async function tab(id){await page.locator('[data-tab="'+id+'"]').click();await page.waitForTimeout(100);}
 async function op(action,id){const q=id?'[data-op="'+action+'"][data-id="'+id+'"]':'[data-op="'+action+'"]';await page.locator(q).first().click();await page.waitForTimeout(100);}
 const form=()=>page.locator('#ops-form'),step=()=>form().locator('.question-page:not([hidden])');
 async function field(name,value){const el=form().locator('[name="'+name+'"]');const tag=await el.evaluate(e=>e.tagName),type=await el.getAttribute('type');if(tag==='SELECT'){await el.evaluate((e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))},value);}else if(type==='checkbox'){await el.evaluate((e,v)=>{e.checked=!!v;e.dispatchEvent(new Event('change',{bubbles:true}))},value);}else await el.fill(String(value));}
 async function choice(text){const b=step().locator('.question-choice').filter({hasText:text}).first();await b.click();await page.waitForTimeout(60);}
 async function toggle(){await step().locator('.question-toggle').click();await page.waitForTimeout(50);}
 async function next(){await form().locator('[data-next]:visible').click();await page.waitForTimeout(70);}
 async function submit(){await form().locator('button[type=submit]:visible').click();await page.waitForTimeout(300);}
 async function close(){const x=page.locator('[data-op=close]');if(await x.count())await x.click();}
 async function assertHeading(text){await page.getByRole('heading',{name:text}).first().waitFor();}
 async function activateOwnerShop(){await tab('account');const card=page.locator('.op-card').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).last();await card.locator('[data-op=shop-edit]').click();while(await form().locator('[data-next]:visible').count()){await next();}await submit();await page.waitForTimeout(120);}
 await page.goto('http://127.0.0.1:4177/work');await page.waitForSelector('#ops-main');

 // 1. Professional registration.
 await persona('applicant');await tab('account');await ss('register-start','1. Ø­Ø³Ø§Ø¨ Ø¬Ø¯ÙØ¯ - Ø¨Ø¯Ø§ÙØ© Ø·ÙØ¨ Ø¯ÙØ± ØµØ§Ø­Ø¨ ÙØ­Ù','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù','Ø§ÙØ¹ÙÙÙ ÙØ¸Ù ÙØ¬Ø§ÙÙÙØ§Ø Ø§ÙØ¯ÙØ± Ø§ÙÙÙÙÙ ÙØ­ØªØ§Ø¬ Ø·ÙØ¨ ÙÙØ±Ø§Ø¬Ø¹Ø©.');
 await op('apply-role');await ss('register-role','2. Ø§Ø®ØªÙØ§Ø± Ø§ÙØ¯ÙØ± Ø§ÙÙÙÙÙ: ØµØ§Ø­Ø¨ ÙØ­Ù','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù','Ø§Ø®ØªÙØ§Ø± ÙØ§Ø¶Ø­ Ø¨Ø¨Ø·Ø§ÙØ§Øª ÙØ£ÙÙÙÙØ§Øª.');
 await choice('ØµØ§Ø­Ø¨ ÙØ­Ù');await next();await field('fullName','Ø£Ø­ÙØ¯ ØµØ§Ø­Ø¨ ÙØªØ¬Ø± Ø§ÙØªØ¬Ø±Ø¨Ø©');await ss('register-name','3. Ø¥Ø¯Ø®Ø§Ù Ø§ÙØ§Ø³Ù Ø§ÙÙØ§ÙÙ','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù');await next();
 await field('area','Ø§ÙÙØ§Ø³ÙÙÙ');await next();await field('address','Ø¹ÙÙØ§Ù ØªØ¬Ø±ÙØ¨Ù - Ø§ÙÙØ§Ø³ÙÙÙ');await next();await field('businessName','ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù');await ss('register-business','4. Ø§Ø³Ù Ø§ÙÙØ´Ø§Ø· Ø§ÙÙØ·ÙÙØ¨ Ø§Ø¹ØªÙØ§Ø¯Ù','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù');await next();
 await field('vehicle','ÙØ§ ÙÙØ¬Ø¯');await next();await field('serviceDescription','Ø¨ÙØ¹ ÙÙØªØ¬Ø§Øª ÙÙÙÙØ© ÙØªÙØµÙÙ Ø¯Ø§Ø®Ù ÙÙØ§Ù - Ø¨ÙØ§ÙØ§Øª Ø§Ø®ØªØ¨Ø§Ø±');await ss('register-service','5. ÙØµÙ Ø§ÙÙØ´Ø§Ø· ÙØ§ÙØ®Ø¯ÙØ©','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù');await next();
 await ss('register-identity','6. Ø®Ø·ÙØ© ÙØ³ØªÙØ¯ Ø§ÙÙÙÙØ© Ø§ÙØªØ¬Ø±ÙØ¨Ù','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù','ÙÙ Ø¨ÙØ¦Ø© Ø§ÙØªØ³Øª ÙØ§ ÙØªÙ Ø±ÙØ¹ Ø¨Ø·Ø§ÙØ© Ø­ÙÙÙÙØ©.');await toggle();await next();
 const details=step().locator('details');if(await details.count())await details.locator('summary').click();await ss('register-terms','7. Ø§ÙÙÙØ§ÙÙØ© Ø¹ÙÙ Ø§ØªÙØ§Ù ÙØ³ÙØ§Ø³Ø§Øª Ø§ÙØªØ¬Ø±Ø¨Ø©','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù');await toggle();await next();await toggle();await next(); // data accuracy
 await next(); // marketing optional false
 await ss('register-review','8. ÙØ±Ø§Ø¬Ø¹Ø© Ø¨ÙØ§ÙØ§Øª Ø·ÙØ¨ ØµØ§Ø­Ø¨ Ø§ÙÙØ­Ù ÙØ¨Ù Ø§ÙØ¥Ø±Ø³Ø§Ù','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù');await submit();
 await ss('register-submitted','9. ØªÙ Ø¥Ø±Ø³Ø§Ù Ø§ÙØ·ÙØ¨ ÙÙØ¥Ø¯Ø§Ø±Ø©','ØªØ³Ø¬ÙÙ Ø§ÙÙØ­Ù','Ø§ÙØ¯ÙØ± ÙØ§ ÙØªÙØ¹Ù ØªÙÙØ§Ø¦ÙÙØ§.');

 // 2. Admin approval.
 await persona('admin');await tab('approvals');await ss('admin-review-list','10. Ø§ÙØ¥Ø¯Ø§Ø±Ø© ØªØ±Ù Ø·ÙØ¨ Ø§ÙØ¯ÙØ± Ø§ÙÙÙÙÙ','ÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙØ¥Ø¯Ø§Ø±Ø©');
 const applicantCard=page.locator('.op-card').filter({hasText:'Ø­Ø³Ø§Ø¨ Ø¬Ø¯ÙØ¯'}).first();await applicantCard.locator('[data-op=application-review]').click();
 await ss('admin-decision','11. ÙØ±Ø§Ø± Ø§ÙØ¥Ø¯Ø§Ø±Ø© Ø¹ÙÙ Ø·ÙØ¨ ØµØ§Ø­Ø¨ Ø§ÙÙØ­Ù','ÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙØ¥Ø¯Ø§Ø±Ø©');await choice('Ø§Ø¹ØªÙØ§Ø¯');await next();
 await ss('admin-identity-reviewed','12. ØªØ£ÙÙØ¯ ÙØ±Ø§Ø¬Ø¹Ø© ÙØ³ØªÙØ¯ Ø§ÙØ§Ø®ØªØ¨Ø§Ø±','ÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙØ¥Ø¯Ø§Ø±Ø©');await toggle();await next();await field('note','Ø§Ø¹ØªÙØ§Ø¯ ÙØ­Ù ØªØ¬Ø±ÙØ¨Ù Ø¨Ø¹Ø¯ ÙØ±Ø§Ø¬Ø¹Ø© Ø¨ÙØ§ÙØ§Øª Ø§ÙØ§Ø®ØªØ¨Ø§Ø±');await next();await ss('admin-review-summary','13. ÙØ±Ø§Ø¬Ø¹Ø© ÙØ±Ø§Ø± Ø§ÙØ§Ø¹ØªÙØ§Ø¯','ÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙØ¥Ø¯Ø§Ø±Ø©');await submit();
 await ss('admin-approved','14. ØªÙ Ø§Ø¹ØªÙØ§Ø¯ Ø§ÙØ¯ÙØ± Ø§ÙÙÙÙÙ','ÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙØ¥Ø¯Ø§Ø±Ø©');

 // 3. Create business.
 await persona('applicant');await tab('account');await ss('owner-role-active','15. ØµØ§Ø­Ø¨ Ø§ÙÙØ­Ù Ø¨Ø¹Ø¯ Ø§ÙØ§Ø¹ØªÙØ§Ø¯','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·','Ø¸ÙØ± Ø¯ÙØ± ØµØ§Ø­Ø¨ ÙØ­Ù ÙØ£ØµØ¨Ø­ Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø· ÙØªØ§Ø­ÙØ§.');
 await op('shop-new');await field('name','ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù');await ss('shop-name','16. Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø· - Ø§Ø³Ù Ø§ÙÙØ­Ù','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·');await next();
 await ss('shop-category','17. Ø§Ø®ØªÙØ§Ø± Ø§ÙØªØµÙÙÙ Ø§ÙØ¹Ø§Ù ÙÙÙØ´Ø§Ø·','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·');await choice('Ø¨ÙØ§ÙØ©');await next();
 await field('address','Ø§ÙÙØ§Ø³ÙÙÙ - Ø¹ÙÙØ§Ù ØªØ¬Ø±ÙØ¨Ù ÙÙÙØ­Ù');await next();await field('locationId','shop-b-point');await next();await field('description','ÙØªØ¬Ø± ØªØ¬Ø±ÙØ¨Ù ÙØ´Ø±Ø­ Ø¯ÙØ±Ø© Ø§ÙØªØ´ØºÙÙ ÙØ§ÙØ¨ÙØ¹ ÙØ§ÙØªÙØµÙÙ');await next();
 await ss('shop-delivery-policy','18. ØªØ­Ø¯ÙØ¯ Ø³ÙØ§Ø³Ø© Ø§ÙØªÙØµÙÙ','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·','Ø§Ø®ØªØ±ÙØ§ Ø§ÙÙØ­Ù ÙØªØ­ÙÙ Ø§ÙØªÙØµÙÙ ÙÙ Ø§ÙÙØ«Ø§Ù.');await choice('Ø§ÙÙØ­Ù');await next();
 await field('suggestedFee','25');await next();await field('prepMinutes','10');await next();await ss('shop-accepting','19. ØªØ´ØºÙÙ Ø§Ø³ØªÙØ¨Ø§Ù Ø§ÙØ·ÙØ¨Ø§Øª','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·');await toggle();await next();
 await next(); // archived stays false
 await ss('shop-review','20. ÙØ±Ø§Ø¬Ø¹Ø© Ø¥Ø¹Ø¯Ø§Ø¯Ø§Øª Ø§ÙÙØ´Ø§Ø· ÙØ¨Ù Ø§ÙØ­ÙØ¸','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·');await submit();
 await tab('catalog');await ss('shop-created','21. ÙÙØ­Ø© ÙÙØªØ¬Ø§Øª Ø§ÙÙØ­Ù Ø¨Ø¹Ø¯ Ø§ÙØ¥ÙØ´Ø§Ø¡','Ø¥ÙØ´Ø§Ø¡ Ø§ÙÙØ´Ø§Ø·','Ø§ÙÙØ´Ø§Ø· Ø¬Ø§ÙØ² ÙØ¥Ø¶Ø§ÙØ© Ø£ÙØ³Ø§ÙÙ ÙÙÙØªØ¬Ø§ØªÙ.');

 // 4. Section.
 await op('section-new');await field('name','ÙØ´Ø±ÙØ¨Ø§Øª');await ss('section-add','22. Ø¥Ø¶Ø§ÙØ© ÙØ³Ù Ø¯Ø§Ø®Ù Ø§ÙÙØ­Ù','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');await submit();await ss('section-created','23. Ø§ÙÙØ³Ù Ø¸ÙØ± Ø¯Ø§Ø®Ù Ø¥Ø¯Ø§Ø±Ø© Ø§ÙÙÙØªØ¬Ø§Øª','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');

 // 5. Product.
 await op('product-new');await field('name','ÙÙØ§Ù ÙØ¹Ø¯ÙÙØ© - ØªØ¬Ø±Ø¨Ø©');await ss('product-name','24. Ø¥Ø¶Ø§ÙØ© ÙÙØªØ¬ - Ø§ÙØ§Ø³Ù','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');await next();
 await ss('product-section','25. Ø±Ø¨Ø· Ø§ÙÙÙØªØ¬ Ø¨Ø§ÙÙØ³Ù','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');await choice('ÙØ´Ø±ÙØ¨Ø§Øª');await next();
 await field('price','15');await ss('product-price','26. ØªØ­Ø¯ÙØ¯ Ø³Ø¹Ø± Ø§ÙÙÙØªØ¬','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');await next();
 await field('stock','20');await next();await field('description','Ø²Ø¬Ø§Ø¬Ø© ÙÙØ§Ù ÙØ¹Ø¯ÙÙØ© - ÙÙØªØ¬ ØªØ¬Ø±ÙØ¨Ù');await next();await next(); // image blank
 await choice('Ø§ÙØ³Ø¹Ø± Ø´Ø§ÙÙ');await next();await field('taxRate','0');await next();
 await ss('product-available','27. ØªØ­Ø¯ÙØ¯ Ø¥ØªØ§Ø­Ø© Ø§ÙÙÙØªØ¬','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');await next(); // ÙØªØ§Ø­ Ø§ÙØªØ±Ø§Ø¶ÙÙØ§
 await next(); // archived false
 await ss('product-review','28. ÙØ±Ø§Ø¬Ø¹Ø© Ø¨ÙØ§ÙØ§Øª Ø§ÙÙÙØªØ¬ ÙØ¨Ù Ø§ÙØ­ÙØ¸','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');await submit();
 await ss('product-live','29. Ø§ÙÙÙØªØ¬ ÙØªØ§Ø­ ÙÙ ÙØªØ§ÙÙØ¬ Ø§ÙÙØ­Ù','Ø§ÙØ£ÙØ³Ø§Ù ÙØ§ÙÙÙØªØ¬Ø§Øª');

 // 6. Customer order.
 await persona('customer');await tab('shops');const shopCard=page.locator('.op-card').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).first();await shopCard.scrollIntoViewIfNeeded();await ss('customer-shop','30. Ø§ÙØ¹ÙÙÙ ÙØ±Ù Ø§ÙÙØ­Ù Ø§ÙØªØ¬Ø±ÙØ¨Ù','Ø·ÙØ¨ Ø§ÙØ¹ÙÙÙ');await shopCard.locator('[data-op=shop-open]').click();
 const prod=page.locator('.op-product').filter({hasText:'ÙÙØ§Ù ÙØ¹Ø¯ÙÙØ© - ØªØ¬Ø±Ø¨Ø©'}).first();await prod.locator('[data-op=cart-add]').click();await ss('customer-cart','31. Ø§ÙØ¹ÙÙÙ ÙØ¶ÙÙ Ø§ÙÙÙØªØ¬ ÙÙØ³ÙØ©','Ø·ÙØ¨ Ø§ÙØ¹ÙÙÙ');
 await op('checkout');await ss('checkout-delivery','32. Ø§Ø®ØªÙØ§Ø± Ø·Ø±ÙÙØ© Ø§ÙØ§Ø³ØªÙØ§Ù - ØªÙØµÙÙ','Ø·ÙØ¨ Ø§ÙØ¹ÙÙÙ');await choice('ØªÙØµÙÙ');await next();
 await field('destinationId','home-a');await next();await next(); // promo
 await next(); // coupon blank
 await field('note','Ø§ØªØµÙ ÙØ¨Ù Ø§ÙÙØµÙÙ - ÙÙØ§Ø­Ø¸Ø© Ø§Ø®ØªØ¨Ø§Ø±');await next();
 await ss('checkout-confirm','33. ÙØ±Ø§Ø¬Ø¹Ø© Ø¥Ø¬ÙØ§ÙÙ Ø§ÙØ·ÙØ¨ ÙØ¨Ù Ø§ÙØ¥Ø±Ø³Ø§Ù','Ø·ÙØ¨ Ø§ÙØ¹ÙÙÙ');await toggle();await next();await ss('checkout-review','34. Ø§ÙÙØ±Ø§Ø¬Ø¹Ø© Ø§ÙÙÙØ§Ø¦ÙØ© ÙÙØ·ÙØ¨','Ø·ÙØ¨ Ø§ÙØ¹ÙÙÙ');await submit();
 await ss('order-pending','35. Ø§ÙØ·ÙØ¨ ÙØµÙ ÙÙÙØ­Ù ÙÙÙØªØ¸Ø± Ø§ÙÙØ¨ÙÙ','Ø·ÙØ¨ Ø§ÙØ¹ÙÙÙ');

 // 7. Merchant accepts and prepares.
 await persona('applicant');await activateOwnerShop();await tab('orders');await ss('merchant-new-order','36. ØµØ§Ø­Ø¨ Ø§ÙÙØ­Ù ÙØ³ØªÙØ¨Ù Ø§ÙØ·ÙØ¨ Ø§ÙØ¬Ø¯ÙØ¯','Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ·ÙØ¨');const orderCard=page.locator('[data-order-id]').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).first();
 await orderCard.locator('[data-op=order-accept]').click();await ss('merchant-accepted','37. ÙØ¨ÙÙ Ø§ÙØ·ÙØ¨ ÙØªØ«Ø¨ÙØª Ø§ÙÙØ®Ø²ÙÙ','Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ·ÙØ¨');
 await page.locator('[data-order-id]').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).first().locator('[data-op=order-prepare]').click();await ss('merchant-preparing','38. Ø¨Ø¯Ø¡ ØªØ¬ÙÙØ² Ø§ÙØ·ÙØ¨','Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ·ÙØ¨');
 await page.locator('[data-order-id]').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).first().locator('[data-op=order-ready]').click();await ss('merchant-ready','39. Ø§ÙØ·ÙØ¨ Ø¬Ø§ÙØ² ÙÙØªÙØµÙÙ','Ø¥Ø¯Ø§Ø±Ø© Ø§ÙØ·ÙØ¨');

 // 8. Delivery request and bid.
 await page.locator('[data-order-id]').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).first().locator('[data-op=dispatch]').click();await ss('dispatch-source','40. Ø§Ø®ØªÙØ§Ø± ÙØµØ¯Ø± Ø§ÙÙÙØ¯ÙØ¨','Ø§ÙØªÙØµÙÙ');await choice('Ø§ÙÙØªØ§Ø­ÙÙ ÙÙ Ø¬ÙÙ');await next();
 await next(); // courier search blank
 await field('fare','25');await ss('dispatch-fare','41. ØªØ­Ø¯ÙØ¯ Ø³Ø¹Ø± Ø§ÙØªÙØµÙÙ Ø§ÙÙÙØªØ±Ø­','Ø§ÙØªÙØµÙÙ');await next();
 await field('description','ØªÙØµÙÙ Ø·ÙØ¨ ÙÙØ§Ù ÙÙ ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù');await next();await field('load','Ø·ÙØ¨ Ø®ÙÙÙ - Ø²Ø¬Ø§Ø¬Ø© ÙÙØ§Ù');await next();await ss('dispatch-review','42. ÙØ±Ø§Ø¬Ø¹Ø© Ø·ÙØ¨ Ø§ÙØªÙØµÙÙ ÙØ¨Ù ÙØ´Ø±Ù','Ø§ÙØªÙØµÙÙ');await submit();
 await tab('missions');await ss('delivery-open','43. ÙÙÙØ© Ø§ÙØªÙØµÙÙ ÙÙØ´ÙØ±Ø© ÙØªÙØªØ¸Ø± Ø¹Ø±Ø¶ ÙÙØ¯ÙØ¨','Ø§ÙØªÙØµÙÙ');

 await persona('courier');await tab('missions');await ss('courier-job','44. Ø§ÙÙÙØ¯ÙØ¨ ÙØ±Ù ÙÙÙØ© Ø§ÙØªÙØµÙÙ Ø§ÙÙØªØ§Ø­Ø©','Ø§ÙØªÙØµÙÙ');const taskCard=page.locator('[data-task-id]').filter({hasText:'ÙØªØ¬Ø±'}).first();await taskCard.locator('[data-op=bid]').click();
 await field('fare','25');await ss('courier-bid','45. Ø§ÙÙÙØ¯ÙØ¨ ÙÙØ¯Ù Ø³Ø¹Ø±Ù ÙÙÙØª Ø§ÙÙØµÙÙ','Ø§ÙØªÙØµÙÙ');await next();await field('discount','0');await next();await field('pickupMinutes','5');await next();await field('travelMinutes','10');await next();await submit();

 await persona('applicant');await tab('missions');await page.locator('[data-task-id]').first().locator('[data-op=offers]').click();await ss('merchant-offers','46. ØµØ§Ø­Ø¨ Ø§ÙÙØ­Ù ÙØ±Ø§Ø¬Ø¹ Ø¹Ø±ÙØ¶ Ø§ÙÙÙØ¯ÙØ¨ÙÙ','Ø§ÙØªÙØµÙÙ');await page.locator('[data-op=select-bid]').first().click();
 await ss('merchant-select-courier','47. ØªØ£ÙÙØ¯ Ø§Ø®ØªÙØ§Ø± Ø§ÙÙÙØ¯ÙØ¨ ÙØ§ÙØ³Ø¹Ø±','Ø§ÙØªÙØµÙÙ');await toggle();await submit();await ss('delivery-assigned','48. ØªÙ Ø¥Ø³ÙØ§Ø¯ Ø§ÙÙÙÙØ© ÙÙÙÙØ¯ÙØ¨','Ø§ÙØªÙØµÙÙ');

 // 9. Handoff and delivery.
 await persona('courier');await tab('missions');await page.locator('[data-op=at-pickup]').first().click();await page.waitForTimeout(300);await ss('courier-at-store','49. Ø§ÙÙÙØ¯ÙØ¨ ÙØµÙ ÙÙÙØ­Ù','Ø§ÙØªÙØµÙÙ');
 await persona('applicant');await activateOwnerShop();await tab('orders');await ss('merchant-handoff','50. Ø§ÙÙØ­Ù ÙØ¤ÙØ¯ ØªØ³ÙÙÙ Ø§ÙØ·ÙØ¨ ÙÙÙÙØ¯ÙØ¨ Ø§ÙÙØ­Ø¯Ø¯','Ø§ÙØªÙØµÙÙ');await page.locator('[data-op=handoff]').first().click();await page.waitForFunction(()=>!document.querySelector('[data-op=handoff]'));await page.waitForTimeout(150);
 await persona('courier');await tab('missions');await page.locator('[data-op=depart]').first().click();await page.waitForTimeout(300);await ss('courier-en-route','51. Ø§ÙÙÙØ¯ÙØ¨ Ø§Ø³ØªÙÙ ÙØ¨Ø¯Ø£ Ø§ÙØªÙØµÙÙ','Ø§ÙØªÙØµÙÙ');await page.locator('[data-op=arrived]').first().click();await page.waitForTimeout(300);await ss('courier-arrived','52. Ø§ÙÙÙØ¯ÙØ¨ ÙØµÙ ÙØ¹ÙÙØ§Ù Ø§ÙØ¹ÙÙÙ','Ø§ÙØªÙØµÙÙ');
 await page.locator('[data-op=delivered]').first().click();await ss('courier-delivery-confirm','53. ØªØ£ÙÙØ¯ Ø§ÙÙÙØ¯ÙØ¨ Ø£ÙÙ Ø³ÙÙÙ Ø§ÙØ·ÙØ¨','Ø§ÙØªÙØµÙÙ');await toggle();await submit();await ss('awaiting-customer','54. Ø§ÙØªØ³ÙÙÙ ÙÙØªØ¸Ø± ØªØ£ÙÙØ¯ Ø§ÙØ¹ÙÙÙ','Ø§ÙØªÙØµÙÙ');
 await persona('customer');await tab('missions');await ss('customer-confirm-receipt','55. Ø§ÙØ¹ÙÙÙ ÙØ¤ÙØ¯ Ø§Ø³ØªÙØ§Ù Ø§ÙØ·ÙØ¨','Ø§ÙØªÙØµÙÙ');await page.locator('[data-op=confirm-receipt]').first().click();await toggle();await submit();await ss('delivery-complete','56. Ø§ÙØªÙØµÙÙ Ø§ÙØªÙÙ Ø¨ØªØ£ÙÙØ¯ Ø§ÙØ¹ÙÙÙ','Ø§ÙØªÙØµÙÙ');

 // Order receipt.
 await persona('applicant');await activateOwnerShop();await tab('orders');await page.locator('[data-order-id]').filter({hasText:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù'}).first().locator('[data-op=receipt]').click();await ss('online-order-receipt','57. Ø¥ÙØµØ§Ù Ø§ÙØ·ÙØ¨ Ø§ÙØ¥ÙÙØªØ±ÙÙÙ','Ø§ÙÙØ§ØªÙØ±Ø© ÙØ§ÙØ¥ÙØµØ§Ù','Ø§ÙØ¥ÙØµØ§Ù ØªØ¬Ø±ÙØ¨Ù ÙÙÙØ³ ÙØ³ØªÙØ¯ÙØ§ Ø¶Ø±ÙØ¨ÙÙØ§.');await close();

 // 10. Offline POS.
 await tab('cash');if(await page.locator('[data-op=shift-open]').count()){await op('shift-open');await field('opening','100');await ss('pos-open-shift','58. ÙØªØ­ ÙØ±Ø¯ÙØ© Ø§ÙÙØ§Ø´ÙØ± Ø¨Ø±ØµÙØ¯ Ø¨Ø¯Ø§ÙØ©','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');await submit();}
 await ss('pos-screen','59. Ø´Ø§Ø´Ø© Ø§ÙÙØ§Ø´ÙØ± Ø¹ÙÙ ÙÙØ³ ÙØ®Ø²ÙÙ Ø§ÙÙØ­Ù','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');const posProd=page.locator('.op-product').filter({hasText:'ÙÙØ§Ù ÙØ¹Ø¯ÙÙØ© - ØªØ¬Ø±Ø¨Ø©'}).first();await posProd.locator('[data-op=cart-add]').click();await ss('pos-cart','60. Ø¥Ø¶Ø§ÙØ© Ø§ÙÙÙØªØ¬ ÙÙØ§ØªÙØ±Ø© Ø¨ÙØ¹ Ø£ÙÙÙØ§ÙÙ','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');
 await op('pos-checkout');await ss('pos-fulfillment','61. ÙÙØ¹ Ø¨ÙØ¹ Ø§ÙÙØ§Ø´ÙØ±: Ø¯Ø§Ø®Ù Ø§ÙÙØ­Ù','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');await choice('Ø¯Ø§Ø®Ù Ø§ÙÙØ­Ù');await next();
 await ss('pos-method','62. Ø§Ø®ØªÙØ§Ø± ÙØ³ÙÙØ© Ø§ÙØ¯ÙØ¹ Ø§ÙÙÙØ¯Ù','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');await choice('ÙÙØ¯Ù');await next();
 await field('amount','15');await next();await next(); // secondMethod
 await field('tendered','20');await next();await ss('pos-confirm','63. ØªØ£ÙÙØ¯ Ø§Ø³ØªÙØ§Ù ÙØ¨ÙØº Ø§ÙØ¨ÙØ¹','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');await toggle();await next();await ss('pos-review','64. ÙØ±Ø§Ø¬Ø¹Ø© ÙØ§ØªÙØ±Ø© Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ');await submit();
 await tab('orders');const counterOrder=page.locator('[data-order-id]').filter({hasText:'ÙØ§Ø´ÙØ±'}).first();await counterOrder.scrollIntoViewIfNeeded();await ss('pos-saved-order','65. Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ ÙØ­ÙÙØ¸ ÙØ·ÙØ¨ ÙØ§Ø´ÙØ±','Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ','Ø§ÙÙØ®Ø²ÙÙ ÙØ§ÙØªØ­ØµÙÙ Ø§ØªØ­Ø¯Ø«ÙØ§ ÙÙ ÙÙØ³ Ø§ÙØ¹ÙÙÙØ©.');
 await counterOrder.locator('[data-op=receipt]').click();await ss('pos-receipt','66. Ø¥ÙØµØ§Ù Ø§ÙØ¨ÙØ¹ Ø§ÙØ£ÙÙÙØ§ÙÙ','Ø§ÙÙØ§ØªÙØ±Ø© ÙØ§ÙØ¥ÙØµØ§Ù','ÙÙÙÙ Ø¹Ø±Ø¶Ù ÙØ·Ø¨Ø§Ø¹ØªÙ ÙÙ ÙÙØ³ Ø§ÙØ·ÙØ¨.');

 assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/manifest.json',JSON.stringify({title:'Ø¯ÙÙÙ ØªØ´ØºÙÙ ÙØ­Ù Ø¬ÙÙ - Ø§Ø®ØªØ¨Ø§Ø± ÙØ§ÙÙ',shop:'ÙØªØ¬Ø± Ø¬ÙÙ Ø§ÙØªØ¬Ø±ÙØ¨Ù',product:'ÙÙØ§Ù ÙØ¹Ø¯ÙÙØ© - ØªØ¬Ø±Ø¨Ø©',screenshots:shots,tests:{browserErrors:errors.length,completed:true},generatedAt:new Date().toISOString()},null,2));
 console.log('DONE',shots.length);
 await browser.close();
})().catch(async e=>{console.error('CAPTURE_FAIL',e);process.exit(1)});
