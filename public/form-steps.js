import {icon} from './ui-icons.js';
const controlIcon=(field,title='')=>{
 const name=String(field?.name||'').toLowerCase(),type=String(field?.type||field?.tagName||'').toLowerCase(),text=(name+' '+title).toLowerCase();
 if(/phone|whatsapp/.test(text))return 'phone';if(/email|mail/.test(text))return 'mail';if(/address|location|destination|fromid|toid|مكان|عنوان|الوجهة|البداية/.test(text))return 'map';
 if(/payment|method|price|amount|fare|fee|budget|cap|minimum|maximum|cash|tendered|سعر|مبلغ|دفع|رسوم|ميزانية/.test(text))return 'bank';
 if(/role|user|member|team|courier|driver|customer|مندوب|سائق|عميل|موظف/.test(text))return 'user';
 if(/product|section|category|stock|quantity|visits|منتج|قسم|تصنيف|مخزون|عدد/.test(text))return 'bag';
 if(/image|upload|identity|بطاق|صورة/.test(text))return 'upload';if(/date|time|minute|prep|موعد|وقت|دقايق/.test(text))return 'clock';
 if(/terms|consent|confirm|accept|approved|policy|موافق|تأكيد|الشروط/.test(text)||type==='checkbox')return 'shield';
 if(/description|note|reason|name|code|وصف|ملاحظة|سبب|اسم|كود/.test(text))return 'edit';if(type==='select-one')return 'layers';return 'edit';
};
const choiceIcon=(value,label='')=>{const v=(String(value)+' '+String(label)).toLowerCase();
 if(/delivery|parcel|توصيل/.test(v))return 'bike';if(/ride|driver|car|سائق|رحلة|أفراد/.test(v))return 'car';if(/pickup|counter|shop|merchant|store|محل|نشاط|استلام/.test(v))return 'store';
 if(/cash|card|transfer|payment|bank|نقد|بطاقة|تحويل|دفع/.test(v))return 'bank';if(/customer|user|عميل/.test(v))return 'user';if(/provider|service_provider|مقدم/.test(v))return 'store';
 if(/public|global|platform|جوه|الكل|عام/.test(v))return 'layers';if(/private|خاص/.test(v))return 'shield';if(/product|goods|منتج|الأصناف/.test(v))return 'bag';if(/category|section|تصنيف|قسم/.test(v))return 'grid';
 if(/no|false|reject|رفض|لا/.test(v))return 'close';return 'check';
};
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
 const pages=groups.map(({id,title,node})=>{
  const el=document.createElement('section'),field=node.querySelector('input,select,textarea'),hero=document.createElement('div'),heroIcon=document.createElement('div'),heroCopy=document.createElement('div'),heading=document.createElement('h3'),hint=document.createElement('p');
  el.dataset.questionId=id;el.className='question-page';heading.tabIndex=-1;heading.textContent=title;hint.className='question-hint';hint.textContent=field?.tagName==='SELECT'?'اختار إجابة واحدة واضحة':field?.type==='checkbox'?'راجع العبارة واضغط للموافقة':'اكتب إجابتك وبعدين كمل';
  heroIcon.className='question-hero-icon';heroIcon.innerHTML=icon(controlIcon(field,title));heroCopy.append(heading,hint);hero.className='question-hero';hero.append(heroIcon,heroCopy);el.append(hero,node);
  const page={id,title,node,el,field,focusTarget:field};
  if(field?.tagName==='SELECT'&&field.options.length<=10){
   node.hidden=true;field.tabIndex=-1;field.setAttribute('aria-hidden','true');const choices=document.createElement('div');choices.className='question-choice-grid';choices.setAttribute('role','group');choices.setAttribute('aria-label',title);
   const sync=()=>[...choices.children].forEach(button=>{const selected=button.dataset.value===field.value;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));});
   for(const option of field.options){const button=document.createElement('button');button.type='button';button.className='question-choice';button.dataset.value=option.value;button.innerHTML=icon(choiceIcon(option.value,option.textContent))+'<span>'+option.textContent+'</span>';button.onclick=()=>{field.value=option.value;field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));sync();};choices.append(button);}
   field.addEventListener('change',sync);sync();el.append(choices);page.choiceGrid=choices;page.focusTarget=choices.querySelector('.selected')||choices.querySelector('button');
  }else if(field?.type==='checkbox'){
   node.hidden=true;field.tabIndex=-1;field.setAttribute('aria-hidden','true');const toggle=document.createElement('button');toggle.type='button';toggle.className='question-toggle';
   const sync=()=>{toggle.classList.toggle('selected',field.checked);toggle.setAttribute('aria-pressed',String(field.checked));toggle.innerHTML=icon(field.checked?'check':'shield')+'<span>'+(field.checked?'موافق — اضغط للتراجع':'اضغط للموافقة')+'</span>';};toggle.onclick=()=>{field.checked=!field.checked;field.dispatchEvent(new Event('change',{bubbles:true}));sync();};field.addEventListener('change',sync);sync();el.append(toggle);page.focusTarget=toggle;
  }else{node.classList.add('question-input-label');if(field&&!field.placeholder&&field.type!=='file')field.placeholder=title;field?.setAttribute('aria-label',title);}
  return page;
 });
 // Identified nodes can be populated later (e.g. a live basket quote). Do not detach them.
 for(const extra of [...form.querySelectorAll('[data-step-for]')]){const page=pages.find(p=>p.id===extra.dataset.stepFor);if(page){extra.classList.add('question-context');page.el.append(extra);}}
 const intro=[...form.children].filter(node=>node!==submit&&node!==error&&!pages.some(p=>p.node===node)&&(node.id||node.textContent.trim()||node.querySelector('button,a')));
 const notice=document.createElement('div');notice.className='question-notice';notice.append(...intro);
 const progress=document.createElement('div');progress.className='question-progress';progress.innerHTML='<span aria-live="polite"></span><div role="progressbar" aria-label="تقدم الخطوات" aria-valuemin="1"><i></i></div>';
 const foot=document.createElement('div');foot.className='question-footer';foot.innerHTML='<button type="button" data-prev class="question-back" aria-label="السابق">'+icon('arrow')+'<span>السابق</span></button><button type="button" data-next class="primary">التالي '+icon('back')+'</button>';submit.innerHTML=icon('check')+' '+onSubmitLabel;foot.append(submit);
 const reviewPage=document.createElement('section');reviewPage.className='question-page question-review';reviewPage.dataset.questionId='review';reviewPage.innerHTML='<div class="question-hero"><div class="question-hero-icon">'+icon('check')+'</div><div><h3 tabindex="-1">نراجع قبل ما نكمل؟</h3><p class="question-hint">راجع إجاباتك، ولو محتاج تعدل ارجع خطوة.</p></div></div><dl></dl>';
 const hasSummary=summary&&pages.length>1;form.replaceChildren(progress,...pages.map(p=>p.el),...(hasSummary?[reviewPage]:[]),notice,error,foot);
 const previous=foot.querySelector('[data-prev]'),nextButton=foot.querySelector('[data-next]');let at=0,activeKey='';
 const enabled=()=>{const rows=pages.filter(p=>visible(p.id,form));return hasSummary?[...rows,{id:'review',el:reviewPage,focusTarget:reviewPage.querySelector('h3')}]:rows;};
 function reviewValues(){const list=reviewPage.querySelector('dl');list.replaceChildren();for(const p of pages.filter(p=>visible(p.id,form))){const values=[...p.el.querySelectorAll('input,select,textarea')].filter(field=>!field.disabled&&!['password','hidden'].includes(field.type)).map(field=>field.type==='checkbox'?(field.checked?'نعم':'لا'):field.type==='file'?[...field.files].map(file=>file.name).join('، '):field.tagName==='SELECT'?field.selectedOptions[0]?.textContent:field.value).filter(value=>String(value||'').trim());if(!values.length)continue;const term=document.createElement('dt'),definition=document.createElement('dd');term.textContent=p.title;definition.textContent=values.join(' • ');list.append(term,definition);}}
 function show(focus=false){const active=enabled();at=Math.max(0,Math.min(at,active.length-1));const current=active[at];activeKey=active.map(p=>p.id).join('|');pages.forEach(p=>p.el.hidden=p!==current);reviewPage.hidden=current?.id!=='review';progress.querySelector('span').textContent='الخطوة '+(at+1)+' من '+active.length;const bar=progress.querySelector('[role=progressbar]');bar.setAttribute('aria-valuemax',String(active.length));bar.setAttribute('aria-valuenow',String(at+1));bar.querySelector('i').style.width=((at+1)/active.length*100)+'%';previous.hidden=at===0;nextButton.hidden=at===active.length-1;submit.hidden=at!==active.length-1;notice.hidden=at!==active.length-1;error.textContent='';if(current?.id==='review')reviewValues();if(focus)(current?.focusTarget||current?.el.querySelector('h3'))?.focus?.({preventScroll:true});form.closest('dialog')?.scrollTo({top:0,behavior:'instant'});if(typeof review==='function')review(current?.id,form);}
 const invalid=page=>[...page.el.querySelectorAll('input,select,textarea')].find(field=>!field.disabled&&!field.checkValidity());
 function next(){const active=enabled(),page=active[at],failed=invalid(page);if(failed){error.textContent='كمل السؤال ده الأول قبل ما تروح للخطوة اللي بعدها.';(page.choiceGrid?.querySelector('button')||page.focusTarget||failed)?.focus?.({preventScroll:true});return;}at++;show(true);}
 previous.onclick=()=>{at--;show(true);};nextButton.onclick=next;
 form.addEventListener('submit',event=>{const active=enabled();if(at<active.length-1){event.preventDefault();event.stopImmediatePropagation();next();return;}const index=active.findIndex(page=>invalid(page));if(index>=0){event.preventDefault();event.stopImmediatePropagation();at=index;show();invalid(active[index])?.reportValidity();}},{capture:true});
 form.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.tagName==='INPUT'&&at<enabled().length-1){event.preventDefault();next();}});
 form.addEventListener('change',()=>{const active=enabled();if(active.map(p=>p.id).join('|')!==activeKey)show();});
 show();return {refresh:()=>show(),reset:()=>{at=0;show();},getStep:()=>enabled()[at]?.id};
}
