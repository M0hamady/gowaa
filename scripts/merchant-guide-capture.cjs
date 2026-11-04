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
 async function activateOwnerShop(){await tab('account');const card=page.locator('.op-card').filter({hasText:'متجر جوه التجريبي'}).last();await card.locator('[data-op=shop-edit]').click();while(await form().locator('[data-next]:visible').count()){await next();}await submit();await page.waitForTimeout(120);}
 await page.goto('http://127.0.0.1:4177/work');await page.waitForSelector('#ops-main');

 // 1. Professional registration.
 await persona('applicant');await tab('account');await ss('register-start','1. حساب جديد - بداية طلب دور صاحب محل','تسجيل المحل','العميل يظل مجانيًا؛ الدور المهني يحتاج طلب ومراجعة.');
 await op('apply-role');await ss('register-role','2. اختيار الدور المهني: صاحب محل','تسجيل المحل','اختيار واضح ببطاقات وأيقونات.');
 await choice('صاحب محل');await next();await field('fullName','أحمد صاحب متجر التجربة');await ss('register-name','3. إدخال الاسم الكامل','تسجيل المحل');await next();
 await field('area','الياسمين');await next();await field('address','عنوان تجريبي - الياسمين');await next();await field('businessName','متجر جوه التجريبي');await ss('register-business','4. اسم النشاط المطلوب اعتماده','تسجيل المحل');await next();
 await field('vehicle','لا يوجد');await next();await field('serviceDescription','بيع منتجات يومية وتوصيل داخل كيان - بيانات اختبار');await ss('register-service','5. وصف النشاط والخدمة','تسجيل المحل');await next();
 await ss('register-identity','6. خطوة مستند الهوية التجريبي','تسجيل المحل','في بيئة التست لا يتم رفع بطاقة حقيقية.');await toggle();await next();
 const details=step().locator('details');if(await details.count())await details.locator('summary').click();await ss('register-terms','7. الموافقة على اتفاق وسياسات التجربة','تسجيل المحل');await toggle();await next();await toggle();await next(); // data accuracy
 await next(); // marketing optional false
 await ss('register-review','8. مراجعة بيانات طلب صاحب المحل قبل الإرسال','تسجيل المحل');await submit();
 await ss('register-submitted','9. تم إرسال الطلب للإدارة','تسجيل المحل','الدور لا يتفعل تلقائيًا.');

 // 2. Admin approval.
 await persona('admin');await tab('approvals');await ss('admin-review-list','10. الإدارة ترى طلب الدور المهني','مراجعة الإدارة');
 const applicantCard=page.locator('.op-card').filter({hasText:'حساب جديد'}).first();await applicantCard.locator('[data-op=application-review]').click();
 await ss('admin-decision','11. قرار الإدارة على طلب صاحب المحل','مراجعة الإدارة');await choice('اعتماد');await next();
 await ss('admin-identity-reviewed','12. تأكيد مراجعة مستند الاختبار','مراجعة الإدارة');await toggle();await next();await field('note','اعتماد محل تجريبي بعد مراجعة بيانات الاختبار');await next();await ss('admin-review-summary','13. مراجعة قرار الاعتماد','مراجعة الإدارة');await submit();
 await ss('admin-approved','14. تم اعتماد الدور المهني','مراجعة الإدارة');

 // 3. Create business.
 await persona('applicant');await tab('account');await ss('owner-role-active','15. صاحب المحل بعد الاعتماد','إنشاء النشاط','ظهر دور صاحب محل وأصبح إنشاء النشاط متاحًا.');
 await op('shop-new');await field('name','متجر جوه التجريبي');await ss('shop-name','16. إنشاء النشاط - اسم المحل','إنشاء النشاط');await next();
 await ss('shop-category','17. اختيار التصنيف العام للنشاط','إنشاء النشاط');await choice('بقالة');await next();
 await field('address','الياسمين - عنوان تجريبي للمحل');await next();await field('locationId','shop-b-point');await next();await field('description','متجر تجريبي لشرح دورة التشغيل والبيع والتوصيل');await next();
 await ss('shop-delivery-policy','18. تحديد سياسة التوصيل','إنشاء النشاط','اخترنا المحل يتحمل التوصيل في المثال.');await choice('المحل');await next();
 await field('suggestedFee','25');await next();await field('prepMinutes','10');await next();await ss('shop-accepting','19. تشغيل استقبال الطلبات','إنشاء النشاط');await toggle();await next();
 await next(); // archived stays false
 await ss('shop-review','20. مراجعة إعدادات النشاط قبل الحفظ','إنشاء النشاط');await submit();
 await tab('catalog');await ss('shop-created','21. لوحة منتجات المحل بعد الإنشاء','إنشاء النشاط','النشاط جاهز لإضافة أقسامه ومنتجاته.');

 // 4. Section.
 await op('section-new');await field('name','مشروبات');await ss('section-add','22. إضافة قسم داخل المحل','الأقسام والمنتجات');await submit();await ss('section-created','23. القسم ظهر داخل إدارة المنتجات','الأقسام والمنتجات');

 // 5. Product.
 await op('product-new');await field('name','مياه معدنية - تجربة');await ss('product-name','24. إضافة منتج - الاسم','الأقسام والمنتجات');await next();
 await ss('product-section','25. ربط المنتج بالقسم','الأقسام والمنتجات');await choice('مشروبات');await next();
 await field('price','15');await ss('product-price','26. تحديد سعر المنتج','الأقسام والمنتجات');await next();
 await field('stock','20');await next();await field('description','زجاجة مياه معدنية - منتج تجريبي');await next();await next(); // image blank
 await choice('السعر شامل');await next();await field('taxRate','0');await next();
 await ss('product-available','27. تحديد إتاحة المنتج','الأقسام والمنتجات');await next(); // متاح افتراضيًا
 await next(); // archived false
 await ss('product-review','28. مراجعة بيانات المنتج قبل الحفظ','الأقسام والمنتجات');await submit();
 await ss('product-live','29. المنتج متاح في كتالوج المحل','الأقسام والمنتجات');

 // 6. Customer order.
 await persona('customer');await tab('shops');const shopCard=page.locator('.op-card').filter({hasText:'متجر جوه التجريبي'}).first();await shopCard.scrollIntoViewIfNeeded();await ss('customer-shop','30. العميل يرى المحل التجريبي','طلب العميل');await shopCard.locator('[data-op=shop-open]').click();
 const prod=page.locator('.op-product').filter({hasText:'مياه معدنية - تجربة'}).first();await prod.locator('[data-op=cart-add]').click();await ss('customer-cart','31. العميل يضيف المنتج للسلة','طلب العميل');
 await op('checkout');await ss('checkout-delivery','32. اختيار طريقة الاستلام - توصيل','طلب العميل');await choice('توصيل');await next();
 await field('destinationId','home-a');await next();await next(); // promo
 await next(); // coupon blank
 await field('note','اتصل قبل الوصول - ملاحظة اختبار');await next();
 await ss('checkout-confirm','33. مراجعة إجمالي الطلب قبل الإرسال','طلب العميل');await toggle();await next();await ss('checkout-review','34. المراجعة النهائية للطلب','طلب العميل');await submit();
 await ss('order-pending','35. الطلب وصل للمحل وينتظر القبول','طلب العميل');

 // 7. Merchant accepts and prepares.
 await persona('applicant');await activateOwnerShop();await tab('orders');await ss('merchant-new-order','36. صاحب المحل يستقبل الطلب الجديد','إدارة الطلب');const orderCard=page.locator('[data-order-id]').filter({hasText:'متجر جوه التجريبي'}).first();
 await orderCard.locator('[data-op=order-accept]').click();await ss('merchant-accepted','37. قبول الطلب وتثبيت المخزون','إدارة الطلب');
 await page.locator('[data-order-id]').filter({hasText:'متجر جوه التجريبي'}).first().locator('[data-op=order-prepare]').click();await ss('merchant-preparing','38. بدء تجهيز الطلب','إدارة الطلب');
 await page.locator('[data-order-id]').filter({hasText:'متجر جوه التجريبي'}).first().locator('[data-op=order-ready]').click();await ss('merchant-ready','39. الطلب جاهز للتوصيل','إدارة الطلب');

 // 8. Delivery request and bid.
 await page.locator('[data-order-id]').filter({hasText:'متجر جوه التجريبي'}).first().locator('[data-op=dispatch]').click();await ss('dispatch-source','40. اختيار مصدر المندوب','التوصيل');await choice('المتاحون من جوه');await next();
 await next(); // courier search blank
 await field('fare','25');await ss('dispatch-fare','41. تحديد سعر التوصيل المقترح','التوصيل');await next();
 await field('description','توصيل طلب مياه من متجر جوه التجريبي');await next();await field('load','طلب خفيف - زجاجة مياه');await next();await ss('dispatch-review','42. مراجعة طلب التوصيل قبل نشره','التوصيل');await submit();
 await tab('missions');await ss('delivery-open','43. مهمة التوصيل منشورة وتنتظر عرض مندوب','التوصيل');

 await persona('courier');await tab('missions');await ss('courier-job','44. المندوب يرى مهمة التوصيل المتاحة','التوصيل');const taskCard=page.locator('[data-task-id]').filter({hasText:'متجر'}).first();await taskCard.locator('[data-op=bid]').click();
 await field('fare','25');await ss('courier-bid','45. المندوب يقدم سعره ووقت الوصول','التوصيل');await next();await field('discount','0');await next();await field('pickupMinutes','5');await next();await field('travelMinutes','10');await next();await submit();

 await persona('applicant');await tab('missions');await page.locator('[data-task-id]').first().locator('[data-op=offers]').click();await ss('merchant-offers','46. صاحب المحل يراجع عروض المندوبين','التوصيل');await page.locator('[data-op=select-bid]').first().click();
 await ss('merchant-select-courier','47. تأكيد اختيار المندوب والسعر','التوصيل');await toggle();await submit();await ss('delivery-assigned','48. تم إسناد المهمة للمندوب','التوصيل');

 // 9. Handoff and delivery.
 await persona('courier');await tab('missions');await page.locator('[data-op=at-pickup]').first().click();await page.waitForTimeout(300);await ss('courier-at-store','49. المندوب وصل للمحل','التوصيل');
 await persona('applicant');await activateOwnerShop();await tab('orders');await ss('merchant-handoff','50. المحل يؤكد تسليم الطلب للمندوب المحدد','التوصيل');await page.locator('[data-op=handoff]').first().click();await page.waitForFunction(()=>!document.querySelector('[data-op=handoff]'));await page.waitForTimeout(150);
 await persona('courier');await tab('missions');await page.locator('[data-op=depart]').first().click();await page.waitForTimeout(300);await ss('courier-en-route','51. المندوب استلم وبدأ التوصيل','التوصيل');await page.locator('[data-op=arrived]').first().click();await page.waitForTimeout(300);await ss('courier-arrived','52. المندوب وصل لعنوان العميل','التوصيل');
 await page.locator('[data-op=delivered]').first().click();await ss('courier-delivery-confirm','53. تأكيد المندوب أنه سلّم الطلب','التوصيل');await toggle();await submit();await ss('awaiting-customer','54. التسليم منتظر تأكيد العميل','التوصيل');
 await persona('customer');await tab('missions');await ss('customer-confirm-receipt','55. العميل يؤكد استلام الطلب','التوصيل');await page.locator('[data-op=confirm-receipt]').first().click();await toggle();await submit();await ss('delivery-complete','56. التوصيل اكتمل بتأكيد العميل','التوصيل');

 // Order receipt.
 await persona('applicant');await activateOwnerShop();await tab('orders');await page.locator('[data-order-id]').filter({hasText:'متجر جوه التجريبي'}).first().locator('[data-op=receipt]').click();await ss('online-order-receipt','57. إيصال الطلب الإلكتروني','الفاتورة والإيصال','الإيصال تجريبي وليس مستندًا ضريبيًا.');await close();

 // 10. Offline POS.
 await tab('cash');if(await page.locator('[data-op=shift-open]').count()){await op('shift-open');await field('opening','100');await ss('pos-open-shift','58. فتح وردية الكاشير برصيد بداية','البيع الأوفلاين');await submit();}
 await ss('pos-screen','59. شاشة الكاشير على نفس مخزون المحل','البيع الأوفلاين');const posProd=page.locator('.op-product').filter({hasText:'مياه معدنية - تجربة'}).first();await posProd.locator('[data-op=cart-add]').click();await ss('pos-cart','60. إضافة المنتج لفاتورة بيع أوفلاين','البيع الأوفلاين');
 await op('pos-checkout');await ss('pos-fulfillment','61. نوع بيع الكاشير: داخل المحل','البيع الأوفلاين');await choice('داخل المحل');await next();
 await ss('pos-method','62. اختيار وسيلة الدفع النقدي','البيع الأوفلاين');await choice('نقدي');await next();
 await field('amount','15');await next();await next(); // secondMethod
 await field('tendered','20');await next();await ss('pos-confirm','63. تأكيد استلام مبلغ البيع','البيع الأوفلاين');await toggle();await next();await ss('pos-review','64. مراجعة فاتورة البيع الأوفلاين','البيع الأوفلاين');await submit();
 await tab('orders');const counterOrder=page.locator('[data-order-id]').filter({hasText:'كاشير'}).first();await counterOrder.scrollIntoViewIfNeeded();await ss('pos-saved-order','65. البيع الأوفلاين محفوظ كطلب كاشير','البيع الأوفلاين','المخزون والتحصيل اتحدثوا في نفس العملية.');
 await counterOrder.locator('[data-op=receipt]').click();await ss('pos-receipt','66. إيصال البيع الأوفلاين','الفاتورة والإيصال','يمكن عرضه وطباعته من نفس الطلب.');

 assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/manifest.json',JSON.stringify({title:'دليل تشغيل محل جوه - اختبار كامل',shop:'متجر جوه التجريبي',product:'مياه معدنية - تجربة',screenshots:shots,tests:{browserErrors:errors.length,completed:true},generatedAt:new Date().toISOString()},null,2));
 console.log('DONE',shots.length);
 await browser.close();
})().catch(async e=>{console.error('CAPTURE_FAIL',e);process.exit(1)});
