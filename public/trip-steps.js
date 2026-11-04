import {icon} from './ui-icons.js';
function stepLayout(root,definitions,canNext,onReady){
 root.classList.add('trip-steps');const steps=new Map();let current=definitions[0][0],furthest=0;
 const progress=document.createElement('div');progress.className='trip-step-progress';const footer=document.createElement('div');footer.className='trip-step-footer';footer.innerHTML=`<button type="button" class="trip-step-back" aria-label="الخطوة السابقة">${icon('arrow')}</button><button type="button" class="trip-step-next">التالي ${icon('back')}</button>`;
 for(const [id,title,nodes]of definitions){const section=document.createElement('section');section.dataset.tripStep=id;section.hidden=true;section.innerHTML=`<h2 tabindex="-1">${title}</h2>`;for(const node of nodes.filter(Boolean))section.append(node);steps.set(id,section);}
 root.replaceChildren(progress,...steps.values(),footer);
 const ids=[...steps.keys()],back=footer.querySelector('.trip-step-back'),next=footer.querySelector('.trip-step-next');
 function show(id,focus=false){if(!steps.has(id))return;current=id;steps.get(id).classList.remove('round-screen-enter');requestAnimationFrame(()=>steps.get(id).classList.add('round-screen-enter'));const index=ids.indexOf(id);furthest=Math.max(furthest,index);for(const [key,node]of steps)node.hidden=key!==id;progress.innerHTML=ids.map((key,i)=>`<button type="button" data-step-jump="${key}" ${i>furthest?'disabled':''} class="${i<=index?'done':''}" aria-label="${definitions[i][1]}" ${key===id?'aria-current="step"':''}>${i<index?icon('check'):i+1}</button>`).join('');progress.querySelectorAll('[data-step-jump]').forEach(button=>button.onclick=()=>show(button.dataset.stepJump,true));back.disabled=index===0;next.hidden=index===ids.length-1;next.disabled=!canNext(current);if(focus)steps.get(id).querySelector('h2').focus({preventScroll:true});}
 back.onclick=()=>show(ids[Math.max(0,ids.indexOf(current)-1)],true);next.onclick=()=>{if(!canNext(current))return;const id=ids[Math.min(ids.length-1,ids.indexOf(current)+1)];show(id,true);if(id===ids.at(-1))onReady();};show(current);
 return {show,current:()=>current,refresh(){next.disabled=!canNext(current);}};
}
export function mountTripSteps({root,getState,onRoute}){
 const $=id=>document.getElementById(id),start=root.querySelector('#from').closest('.endpoint'),destination=$('to').closest('.endpoint'),modes=root.querySelector('.travel-modes'),result=$('route-result'),footnote=root.querySelector('.footnote'),routeButton=$('route-button');
 const startTools=document.createElement('div');startTools.className='trip-step-tools';startTools.append($('use-location'),$('building-from'));
 const endTools=document.createElement('div');endTools.className='trip-step-tools';endTools.append($('building-to'));
 const reviewTools=document.createElement('div');reviewTools.className='trip-step-tools';reviewTools.append($('swap'),routeButton);
 const steps=stepLayout(root,[['from','هتتحرك منين؟',[start,startTools]],['to','رايح فين؟',[destination,endTools]],['mode','هتتحرك إزاي؟',[modes]],['ready','مشوارك جاهز',[reviewTools,result,footnote]]],id=>id==='from'?!!getState().from:id==='to'?!!getState().to:true,onRoute);
 modes.addEventListener('click',event=>{if(event.target.closest('[data-mode]'))steps.show('ready');});
 return {...steps,accept(which){if(steps.current()===which)steps.show(which==='from'?'to':'mode',true);steps.refresh();},ready:()=>steps.current()==='ready'};
}
export function mountRoundSteps({root,getState,onReady}){
 const q=s=>root.querySelector(s),start=q('#round-start').closest('.round-search'),startTools=q('#round-gps').parentElement,stops=q('#round-stop').closest('.round-search'),stopTools=q('#round-pick-stop').parentElement,modes=q('.round-modes'),loop=q('.round-return'),check=q('#round-return');
 startTools.append(q('#round-load'));const loopChoices=document.createElement('div');loopChoices.className='trip-loop-choices';loopChoices.innerHTML=`<button type="button" data-loop="yes">${icon('round')}<span>أرجع للبداية</span></button><button type="button" data-loop="no">${icon('navigation')}<span>أنهي عند آخر محطة</span></button>`;loop.hidden=true;
 const steps=stepLayout(root,[['start','هتبدأ منين؟',[start,startTools]],['stops','هتعدّي على إيه؟',[stops,stopTools,q('#round-stops')]],['mode','هتتحرك إزاي؟',[modes]],['loop','ترجع للبداية؟',[loop,loopChoices]],['ready','الراوند جاهز',[q('#round-status'),q('#round-result'),q('#round-calculate'),q('#round-save').parentElement,root.querySelector('.footnote')]]],id=>id==='start'?!!getState().start:id==='stops'?getState().stops.length>0:true,onReady);
 loopChoices.querySelectorAll('button').forEach(button=>button.onclick=()=>{check.checked=button.dataset.loop==='yes';check.dispatchEvent(new Event('change',{bubbles:true}));steps.show('ready');onReady();});
 modes.addEventListener('click',event=>{if(event.target.closest('[data-round-mode]'))steps.show('loop',true);});
 return steps;
}
