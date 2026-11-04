import {calendarMonthEnd} from './core.mjs';
export const personas=[
 ['customer','عميل التجربة','customer'],['owner','صاحب المحل','merchant'],['courier','مندوب المنتجات','courier'],['driver','سائق أفراد','driver'],['cashier','موظف الكاشير','staff'],['admin','إدارة جوه','admin'],['applicant','حساب جديد','customer'],['courier2','مندوب آخر','courier'],['otherOwner','صاحب نشاط آخر','merchant']
];
/** All records are synthetic. No fixture phone is ever used for messaging or dialing. */
export function seedState(now=Date.now()){
 const at=new Date(now).toISOString();const users=Object.fromEntries(personas.map(([id,name,role],i)=>[id,{id,name,verified:true,admin:role==='admin',phone:'+2010000000'+String(i+1).padStart(2,'0')} ]));
 const s={schema:1,revision:0,nextId:100,nextQueue:1000,updatedAt:at,users,settings:{mode:'test',policyVersion:'test-policy-v1',identityUploadsEnabled:false,passengerLaunchEnabled:false,customerAlwaysFree:true,noPaidPlans:true,operator:'شركة كود أوشن للتطوير البرمجيات',support:'support@codeocean.online',categories:['مطاعم','خدمات منزلية','غسيل سيارات','بقالة','حلويات','ملابس'],rates:{parcel:{base:1500,perKm:400},ride:{base:3000,perKm:600}},feeRules:{'fee-online-default':{id:'fee-online-default',code:'online-processing',name:'رسوم الدفع الأونلاين الافتراضية',trigger:'online_payment',scope:'global',scopeId:null,bearer:'provider',base:'payment_amount',basisPoints:300,fixedPiastres:300,minimumPiastres:0,maximumPiastres:null,enabled:true,startsAt:null,endsAt:null,version:1}}},locations:{
  'shop-a-point':{id:'shop-a-point',name:'المحل التجريبي — الياسمين',area:'الياسمين',coordinate:[31.634,29.929]},
  'shop-b-point':{id:'shop-b-point',name:'النشاط التجريبي — النرجس',area:'النرجس',coordinate:[31.617,29.928]},
  'home-a':{id:'home-a',name:'عنوان تجربة أ — الياسمين',area:'الياسمين',coordinate:[31.626,29.931]},
  'home-b':{id:'home-b',name:'عنوان تجربة ب — النرجس',area:'النرجس',coordinate:[31.612,29.924]},
  'gate':{id:'gate',name:'نقطة ركوب تجريبية',area:'محيط كيان',coordinate:[31.631,29.937]}
 },applications:{},trials:{},shops:{},sections:{},products:{},team:{},courierLinks:{},availability:{},orders:{},tasks:{},bids:{},payments:{},onlinePayments:{},platformTransactions:[],taskPayments:{},ledger:[],settlements:{},shifts:{},cashEvents:[],stockEvents:[],promotions:{},platformBenefits:{
  'benefit-jowwa10':{id:'benefit-jowwa10',name:'كوبون جوه 10 جنيه',kind:'discount',type:'fixed',value:1000,scope:'global',scopeId:null,target:'goods',code:'JOWWA10',automatic:false,minimumPiastres:5000,capPiastres:1000,budgetPiastres:100000,maxUses:100,perCustomerMax:1,funder:'platform',enabled:true,startsAt:null,endsAt:null,used:0,spentPiastres:0,version:1},
  'benefit-cashback-test':{id:'benefit-cashback-test',name:'كاش باك جوه التجريبي',kind:'cashback',type:'percent',value:5,scope:'global',scopeId:null,target:'goods',code:null,automatic:true,minimumPiastres:5000,capPiastres:1000,budgetPiastres:100000,maxUses:100,perCustomerMax:3,funder:'platform',enabled:true,startsAt:null,endsAt:null,used:0,spentPiastres:0,version:1}
 },benefitUses:{},customerCredits:{},positions:{},consents:[],events:[],processed:{}};
 for(const [id,role]of [['owner','merchant'],['otherOwner','service_provider'],['courier','courier'],['courier2','courier'],['driver','driver']]){
  const app='approved-'+id;s.applications[app]={id:app,userId:id,role,profile:{fullName:users[id].name,area:'منطقة تجربة',address:'عنوان افتراضي للاختبار',businessName:users[id].name,vehicle:role==='driver'?'سيارة تجريبية':role==='courier'?'دراجة تجريبية':'',serviceDescription:'نشاط افتراضي للاختبار فقط'},identityRef:'fixture:identity-sample',identityReviewed:true,status:'approved',version:1,submittedAt:at,approvedAt:at,reviewerId:'admin',reviewNote:'اعتماد اصطناعي لا يشمل أي مستند أو هوية حقيقية'};
  s.trials[id]={startsAt:at,endsAt:calendarMonthEnd(at),automaticBilling:false,customerFree:true,kind:'test-professional-gift'};
 }
 for(const[id,ownerId,name,category,locationId]of [['shop-a','owner','مطبخ جوه — تجربة','مطاعم','shop-a-point'],['shop-b','otherOwner','خدمات البيت — تجربة','خدمات منزلية','shop-b-point']])s.shops[id]={id,ownerId,name,category,locationId,address:s.locations[locationId].name,description:'بيانات وهمية للاختبار فقط، لا تستقبل طلبات فعلية.',accepting:true,deliveryPolicy:'shop',suggestedFee:2500,prepMinutes:20,archived:false,version:1};
 for(const[id,shopId,name]of [['food','shop-a','الوجبات'],['drinks','shop-a','المشروبات'],['sweets','shop-a','الحلويات'],['home-service','shop-b','الخدمات المنزلية']])s.sections[id]={id,shopId,name,sort:0,archived:false,version:1};
 const product=(id,name,sectionId,price,stock,shopId='shop-a')=>({id,name,shopId,sectionId,description:'صنف تجريبي — السعر للاختبار',price,stock,unit:'قطعة',available:true,archived:false,taxMode:'included',taxRate:0,variants:[],offer:null,image:'',kind:'product',visits:1,version:1});
 s.products.meal=product('meal','وجبة فراخ تجريبية','food',12000,20);
 s.products.juice=product('juice','عصير تجريبي','drinks',3000,30);
 s.products.cake=product('cake','قطعة حلوى تجريبية','sweets',4500,10);
 s.products.wash={...product('wash','باقة غسيل — تجربة','home-service',25000,null,'shop-b'),kind:'service',visits:3};
 s.team['cashier-member']={id:'cashier-member',userId:'cashier',shopId:'shop-a',permissions:['cash','orders'],status:'accepted',version:1,inviterId:'owner'};
 s.courierLinks['private-courier']={id:'private-courier',shopId:'shop-a',name:users.courier.name,phone:users.courier.phone,courierId:'courier',visibility:'private',status:'accepted',version:1,inviterId:'owner'};
 for(const id of ['courier','courier2','driver'])s.availability[id]={available:true,public:id!=='courier2',updatedAt:at};
 return s;
}
