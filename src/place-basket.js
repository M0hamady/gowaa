const key='jowwa-basket';
const read=()=>{try{const rows=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(rows)?rows.filter(x=>x&&typeof x.id==='string'&&Number.isInteger(x.quantity)&&x.quantity>0):[];}catch{return [];}};
const dock=document.createElement('a');dock.id='place-basket-open';dock.className='place-basket-dock primary';dock.href='/market?basket=1';dock.setAttribute('aria-label','فتح السلة');document.body.append(dock);
function render(){const rows=read(),count=rows.reduce((n,x)=>n+x.quantity,0);dock.innerHTML=`<span aria-hidden="true">🛒</span><span>السلة</span>${count?`<b>${count}</b>`:'<small>فاضية</small>'}<span aria-hidden="true">↗</span>`;dock.setAttribute('aria-label',count?`فتح السلة • ${count} قطعة`:'فتح السلة • فاضية');}
render();window.addEventListener('storage',render);window.addEventListener('pageshow',render);
