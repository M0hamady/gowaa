import {icon} from './ui-icons.js';
/** Keep controls mounted so previous answers, files and autocomplete survive each step. */
export function formSteps(form,{questions=[],review,summary=true,onSubmitLabel='حفظ',visible=()=>true}={}){
 if(form.dataset.stepsMounted)return;
 const submit=form.querySelector('[type=submit]');if(!submit)return;
 const error=form.querySelector('.form-error')||document.createElement('div');error.classList.add('form-error');error.setAttribute('role','alert');
 const labels=[...form.querySelectorAll('label')].filter(node=>node.querySelector('input,select,textarea')&&!node.parentElement.closest('label'));
 const titleOf=node=>node.dataset.question||[...node.childNodes].filter(n=>n.nodeType===3||n.nodeType===1&&n.tagName==='SPAN'&&!n.querySelector('input,select,textarea')).map(n=>n.textContent).join(' ').trim()||'اختيارك؟';
 const groups=questions.length?questions:labels.map((node,i)=>({id:node.querySelector('[name]')?.name||String(i),title:titleOf(node),node}));
 if(!groups.length)return;
 form.dataset.stepsMounted='true';form.noValidate=true;form.classList.add('single-question-form');
 const pages=groups.map(({id,title,node})=>{const el=document.createElement('section'),heading=document.createElement('h3');el.dataset.questionId=id;el.className='question-page';heading.tabIndex=-1;heading.textContent=title;el.append(heading,node);return {id,title,node,el};});
 // Identified nodes can be populated later (e.g. a live basket quote). Do not detach them.
 const intro=[...form.children].filter(node=>node!==submit&&node!==error&&(node.id||node.textContent.trim()||node.querySelector('button,a')));
 const notice=document.createElement('div');notice.className='question-notice';notice.append(...intro);
 const progress=document.createElement('div');progress.className='question-progress';progress.innerHTML='<span aria-live="polite"></span><div role="progressbar" aria-label="تقدم الخطوات" aria-valuemin="1"><i></i></div>';
 const foot=document.createElement('div');foot.className='question-footer';foot.innerHTML=`<button type="button" data-prev aria-label="السابق">${icon('arrow')}</button><button type="button" data-next class="primary">التالي ${icon('back')}</button>`;submit.innerHTML=icon('check')+' '+onSubmitLabel;foot.append(submit);
 const reviewPage=document.createElement('section');reviewPage.className='question-page question-review';reviewPage.dataset.questionId='review';reviewPage.innerHTML='<h3 tabindex="-1">نراجع قبل ما نكمل؟</h3><dl></dl>';
 const hasSummary=summary&&pages.length>1;form.replaceChildren(progress,...pages.map(p=>p.el),...(hasSummary?[reviewPage]:[]),notice,error,foot);
 const previous=foot.querySelector('[data-prev]'),nextButton=foot.querySelector('[data-next]');let at=0,activeKey='';
 const enabled=()=>{const rows=pages.filter(p=>visible(p.id,form));return hasSummary?[...rows,{id:'review',el:reviewPage}]:rows;};
 function reviewValues(){const list=reviewPage.querySelector('dl');list.replaceChildren();for(const p of pages.filter(p=>visible(p.id,form))){const values=[...p.el.querySelectorAll('input,select,textarea')].filter(field=>!field.disabled&&!['password','hidden'].includes(field.type)).map(field=>field.type==='checkbox'?(field.checked?'نعم':'لا'):field.type==='file'?[...field.files].map(file=>file.name).join('، '):field.tagName==='SELECT'?field.selectedOptions[0]?.textContent:field.value).filter(value=>String(value||'').trim());if(!values.length)continue;const term=document.createElement('dt'),definition=document.createElement('dd');term.textContent=p.title;definition.textContent=values.join(' • ');list.append(term,definition);}}
 function show(focus=false){const active=enabled();at=Math.max(0,Math.min(at,active.length-1));const current=active[at];activeKey=active.map(p=>p.id).join('|');pages.forEach(p=>p.el.hidden=p!==current);reviewPage.hidden=current?.id!=='review';progress.querySelector('span').textContent=`${at+1} / ${active.length}`;const bar=progress.querySelector('[role=progressbar]');bar.setAttribute('aria-valuemax',String(active.length));bar.setAttribute('aria-valuenow',String(at+1));bar.querySelector('i').style.width=((at+1)/active.length*100)+'%';previous.disabled=at===0;nextButton.hidden=at===active.length-1;submit.hidden=at!==active.length-1;notice.hidden=at!==active.length-1;error.textContent='';if(current?.id==='review')reviewValues();if(focus)current?.el.querySelector('h3').focus({preventScroll:true});form.closest('dialog')?.scrollTo({top:0,behavior:'instant'});if(typeof review==='function')review(current?.id,form);}
 const invalid=page=>[...page.el.querySelectorAll('input,select,textarea')].find(field=>!field.disabled&&!field.checkValidity());
 function next(){const active=enabled(),failed=invalid(active[at]);if(failed){failed.reportValidity();return;}at++;show(true);}
 previous.onclick=()=>{at--;show(true);};nextButton.onclick=next;
 form.addEventListener('submit',event=>{const active=enabled();if(at<active.length-1){event.preventDefault();event.stopImmediatePropagation();next();return;}const index=active.findIndex(page=>invalid(page));if(index>=0){event.preventDefault();event.stopImmediatePropagation();at=index;show();invalid(active[index])?.reportValidity();}},{capture:true});
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'&&at<enabled().length-1){event.preventDefault();next();}});
 form.addEventListener('change',()=>{const active=enabled();if(active.map(p=>p.id).join('|')!==activeKey)show();});
 show();return {refresh:()=>show(),reset:()=>{at=0;show();},getStep:()=>enabled()[at]?.id};
}
