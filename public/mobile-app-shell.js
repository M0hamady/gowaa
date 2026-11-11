// Shared, progressive mobile shell. No changes to Jowwa's existing home,
// routing algorithms, seller checkout, map or authentication.
import {icon} from './ui-icons.js';

export const APP_TABS=Object.freeze([
 {id:'home',label:'الرئيسية',symbol:'home',href:'/'},
 {id:'routes',label:'المشاوير',symbol:'navigation',href:'/#trip'},
 {id:'services',label:'الخدمات',symbol:'grid',href:'/market?view=services'},
 {id:'market',label:'السوق',symbol:'store',href:'/market'},
 {id:'mine',label:'نشاطي',symbol:'user',href:'/market?view=mine'}
]);

const path=p=>{
 if(p==='/'||p==='/index.html')return 'home';
 if(p==='/market'||p==='/market.html'||/^\/market\/category\/[a-z-]+\/?$/.test(p))return 'market';
 if(p==='/places'||p==='/places.html')return 'places';
 if(p==='/buses'||p==='/buses.html')return 'buses';
 if(/^\/place\/[A-Za-z0-9_-]+(?:\.html)?\/?$/.test(p))return 'place';
 if(/^\/(?:menu|item|seller|catalog)\/[A-Za-z0-9_-]+(?:\.html)?\/?$/.test(p))return 'product';
 return null;
};
export function activeAppTab({pathname='/',search='',hash='',homeMode=false,activeView=''}={}){
 const page=path(pathname);
 if(page==='home')return homeMode&&!hash?'home':['trip','bus','places'].includes(hash.replace(/^#/,''))?'routes':homeMode?'home':'routes';
 if(page==='places'||page==='place')return 'services';
 if(page==='product')return 'market';
 if(page==='buses')return 'routes';
 if(page==='market'){
  const selected=activeView||new URLSearchParams(search).get('view')||'browse';
  return selected==='mine'?'mine':selected==='services'||selected==='printing'||selected==='directory'?'services':'market';
 }
 return null;
}
export function appTabHref(id){return APP_TABS.find(tab=>tab.id===id)?.href||null;}

export function mountMobileAppNavigation(doc=document,win=window){
 if(doc.querySelector('#jowwa-app-dock'))return;
 if(!path(win.location.pathname)||!doc.body)return;
 const nav=doc.createElement('nav');
 nav.id='jowwa-app-dock';
 nav.className='jowwa-app-dock';
 nav.setAttribute('aria-label','التنقل الرئيسي في جوه');
 nav.innerHTML=APP_TABS.map(t=>`<a data-app-tab="${t.id}" href="${t.href}" aria-label="${t.label}">${icon(t.symbol)}<span>${t.label}</span></a>`).join('');
 doc.body.append(nav);
 const update=()=>{
  const current=activeAppTab({pathname:win.location.pathname,search:win.location.search,hash:win.location.hash,homeMode:doc.body.classList.contains('home-mode'),activeView:doc.querySelector('.market-tabs [data-view].active')?.dataset.view});
  for(const a of nav.querySelectorAll('[data-app-tab]')){
   const selected=a.dataset.appTab===current;
   a.classList.toggle('active',selected);
   if(selected)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  }
 };
 nav.addEventListener('click',event=>{
  const anchor=event.target.closest('a[data-app-tab]');
  if(!anchor||event.defaultPrevented||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||event.button!==0)return;
  const id=anchor.dataset.appTab,page=path(win.location.pathname);
  if(page==='home'&&(id==='home'||id==='routes')){
   if(id==='home'){
    if(doc.body.classList.contains('home-mode')){event.preventDefault();update();return;}
    const back=doc.getElementById('home-back');
    if(back){event.preventDefault();back.click();update();}
   }else{
    const trip=doc.getElementById('trip-tab');
    if(trip){event.preventDefault();trip.click();win.history.pushState({jowwaTab:'trip'},'','/#trip');update();}
   }
  }
  if(page==='market'&&(id==='services'||id==='market'||id==='mine')){
   const view=id==='services'?'services':id==='mine'?'mine':'browse';
   const button=doc.querySelector('.market-tabs [data-view="'+view+'"]');
   if(button){event.preventDefault();button.click();update();}
  }
 });
 win.addEventListener('popstate',update);
 win.addEventListener('hashchange',update);
 doc.addEventListener('click',event=>{
  if(event.target.closest('.tabs button,.market-tabs button,#home-back'))queueMicrotask(update);
 });
 // Existing UX toggles home-mode after async map setup, so monitor only body
 // class (not the full map/market DOM) and avoid rendering loops.
 const observer=new MutationObserver(update);
 observer.observe(doc.body,{attributes:true,attributeFilter:['class']});
 update();
 return {update,destroy(){observer.disconnect();nav.remove();win.removeEventListener('popstate',update);win.removeEventListener('hashchange',update);}};
}
