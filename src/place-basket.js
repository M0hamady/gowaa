import {providerBasketUpdated} from '../public/provider-basket-core.js';

// A place has its own catalog and basket. Open that basket in place; the market
// basket contains managed seller listings and is a separate checkout.
if(/^\/place\/[a-zA-Z0-9_-]+$/.test(location.pathname)){
 const dock=document.createElement('button');
 dock.id='place-basket-open';dock.type='button';dock.className='place-basket-dock primary';
 dock.setAttribute('aria-label','فتح سلة المكان');document.body.append(dock);
 function render(){
  const host=document.getElementById('provider-catalog'),opener=document.getElementById('provider-basket-open'),count=Number(opener?.dataset.basketCount)||0,status=host?.dataset.catalogStatus||'loading';
  dock.hidden=status==='idle'||status==='error'||status==='ready'&&!opener;
  dock.disabled=!opener;dock.setAttribute('aria-busy',String(status==='loading'));
  dock.innerHTML='<span aria-hidden="true">🛒</span><span class="place-basket-label">سلة المكان</span>'+(count?'<b>'+count+'</b>':'<small>'+(opener?'فاضية':'بنجهزها…')+'</small>')+'<span class="place-basket-arrow" aria-hidden="true">↗</span>';
  dock.setAttribute('aria-label',opener?'فتح سلة المكان • '+(count?count+' قطعة':'فاضية'):'بنجهّز سلة المكان');
 }
 dock.onclick=()=>document.getElementById('provider-basket-open')?.click();
 window.addEventListener(providerBasketUpdated,render);window.addEventListener('pageshow',render);render();
}
