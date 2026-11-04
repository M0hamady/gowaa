import {icon} from './ui-icons.js';
import './visitor-services.js';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Keep full accessible names while using compact, consistent visible controls.
const controls=[
 ['#saved-button','heart','',true],['#sources-button,#help-map','info','',true],
 ['#edit-trip','edit','',true],['#install-app','plus','تثبيت'],['.topbar .market-link','store','السوق'],
 ['#trip-tab','navigation','مشوار'],['#bus-tab','bus','باصات'],['#places-tab','grid','خدمات'],
 ['#direct-trip','navigation','مباشر'],['#round-trip','round','راوند'],
 ['#building-from','building','البداية'],['#building-to','building','الوصول'],
 ['#use-location','locate','موقعي'],['#pick-from,#pick-to','map','',true],['#swap','swap','',true],
 ['#route-button','navigation','الطريق'],['#route-start-navigation,#start-navigation','play','ابدأ'],
 ['#route-details','chevron','',true],['#save-trip','heart','',true],['#share-trip,#copy-trip','share','',true],['#request-trip','car','طلب عربية'],['#edit-round-overview','edit','تعديل الراوند'],
 ['#zoom-in','plus','',true],['#zoom-out','minus','',true],['#map-location','locate','',true],['#layers-button','layers','',true],
 ['#close-dialog,#market-close,.close-dialog','close','',true],
 ['#round-gps','locate','موقعي'],['#round-pick-start','map','البداية'],['#round-pick-stop','plus','محطة'],
 ['#round-example','play','مثال'],['#round-calculate','round','رتّب الراوند'],
 ['#round-save','heart','حفظ'],['#round-load','save','المحفوظ'],['#round-reset','trash','مسح'],
 ['#round-show-map','map','الخريطة'],['#round-navigate','play','ابدأ'],['#round-share','share','مشاركة'],
 ['[data-start-index]','navigation','',true],['[data-remove-index]','close','',true],
 ['[data-round-mode="walk"]','walk','مشي'],['[data-round-mode="bike"]','bike','دراجة'],['[data-round-mode="car"]','car','عربية'],
 ['[data-transit-map]','map','الخريطة'],['.bus-directory-link','bus','كل الخطوط'],
 ['.market-header nav a[href="/"],.market-header nav a[href="/?"]','map','الخريطة'],
 ['.market-header nav a[href="/buses"]','bus','باصات'],['.market-header nav a[href="/market"]','store','السوق'],
 ['#account-button','user','حسابي'],['#add-listing,#my-add','plus','إضافة'],
 ['[data-view="browse"]','store','السوق'],['[data-view="directory"]','map','الأماكن'],
 ['[data-view="mine"]','bag','إضافاتي'],['[data-view="admin"]','shield','الإدارة'],
 ['#filter-form button[type="submit"]','search','',true],['#load-more','chevron','المزيد'],
 ['#my-profile','edit','البروفايل'],['#my-preview','user','معاينة'],['#my-archive','bag',null],
 ['#share-item,#share-seller,[data-share-url]','share','مشاركة'],
 ['[data-edit]','edit','تعديل'],['[data-stock]','grid','التوفر'],
 ['#privacy-button','shield','الخصوصية'],
 ['.contact-links a[href^="tel:"]','phone','اتصل'],['.contact-links a[href^="mailto:"]','mail','بريد'],
 ['.contact-links a[href^="/?to="]','map','شوفه على الخريطة'],
 ['.contact-links a[href^="https://wa.me/"]','phone','واتساب'],
 ['.contact-links a[target="_blank"],.service-action','link',null],
 ['.card-actions a','info','التفاصيل'],['.place-detail>button[data-share-url]','share','مشاركة'],
 ['.market-footer a[href*="view=mine"]','plus','أضف نشاطك']
];
function apply(el,name,label,iconOnly=false){
 if(el.closest('#navigation-ui')||el.querySelector('.ui-icon'))return;
 const original=el.getAttribute('aria-label')||el.textContent.trim();
 el.setAttribute('aria-label',original);el.title=original;
 el.classList.add('ui-control');if(iconOnly)el.classList.add('ui-icon-only');
 el.innerHTML=icon(name)+(iconOnly?'':`<span class="ui-control-label">${esc(label??el.textContent.trim())}</span>`);
}
export function enhanceControls(root=document){for(const [selector,...spec] of controls){if(root.matches?.(selector))apply(root,...spec);root.querySelectorAll?.(selector).forEach(el=>apply(el,...spec));}}
enhanceControls();
new MutationObserver(records=>{for(const r of records){if(r.target.nodeType===1&&r.target.closest('#map,#navigation-ui,.ui-icon'))continue;for(const node of r.addedNodes){if(node.nodeType===1&&!node.classList.contains('ui-icon')&&!node.classList.contains('ui-control-label'))enhanceControls(node);else if(node.nodeType===3&&r.target.matches?.('button'))enhanceControls(r.target);}}}).observe(document.body,{childList:true,subtree:true});
