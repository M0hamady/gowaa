import {paginationState,pageWindow} from '../public/pagination-core.js';

const number=new Intl.NumberFormat('ar-EG');

/** The caller owns filtering, URL history and data loading; rendering makes no requests. */
export function renderPagination(host,{page=1,total=0,pageSize=24,onChange,label='صفحات النتائج',hrefForPage}={}){
 const state=paginationState(total,page,pageSize);if(!host)return state;
 const compact=new Set(pageWindow(state.page,state.totalPages,3));
 host.classList.add('market-pagination');host.hidden=false;
 const summary=document.createElement('p');summary.className='pagination-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');summary.setAttribute('aria-atomic','true');
 summary.textContent=state.total?number.format(state.start)+'–'+number.format(state.end)+' من '+number.format(state.total)+' نتيجة • الصفحة '+number.format(state.page)+' من '+number.format(state.totalPages):'لا توجد نتائج';
 const nav=document.createElement('nav');nav.className='pagination-controls';nav.setAttribute('aria-label',label);nav.hidden=state.totalPages<=1;
 function control(target,text,title,{disabled=false,current=false,action='',compactOnly=false,glyph=''}={}){
  const link=typeof hrefForPage==='function'&&!disabled,node=document.createElement(link?'a':'button');
  if(link)node.href=hrefForPage(target);else{node.type='button';node.disabled=disabled;}
  node.dataset.page=String(target);node.className='pagination-control'+(action?' pagination-direction':' pagination-number')+(compactOnly?' pagination-wide-number':'');node.setAttribute('aria-label',title);
  if(action)node.dataset.paginationAction=action;if(current)node.setAttribute('aria-current','page');
  if(glyph){const symbol=document.createElement('span');symbol.className='pagination-glyph';symbol.setAttribute('aria-hidden','true');symbol.textContent=glyph;node.append(symbol);}
  const copy=document.createElement('span');copy.className=action?'pagination-label':'pagination-page-number';copy.textContent=text;node.append(copy);nav.append(node);
 }
 control(1,'الأولى','أول صفحة',{disabled:!state.hasPrevious,action:'first',glyph:'»'});
 control(Math.max(1,state.page-1),'السابق','الصفحة السابقة',{disabled:!state.hasPrevious,action:'previous',glyph:'›'});
 for(const page of state.pages)control(page,number.format(page),'الصفحة '+number.format(page),{current:page===state.page,compactOnly:!compact.has(page)});
 control(Math.min(state.totalPages,state.page+1),'التالي','الصفحة التالية',{disabled:!state.hasNext,action:'next',glyph:'‹'});
 control(state.totalPages,'الأخيرة','آخر صفحة',{disabled:!state.hasNext,action:'last',glyph:'«'});
 host.replaceChildren(summary,nav);
 nav.onclick=event=>{
  const target=event.target.closest('[data-page]');if(!target||target.disabled||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  event.preventDefault();const next=Number(target.dataset.page);if(next!==state.page&&next>=1&&next<=state.totalPages)onChange?.(next);
 };
 return state;
}
