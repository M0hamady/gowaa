/** Foreground-only location. Never claims background tracking or guaranteed wake lock. */
export function createTripMode({allowed,onPosition,onStatus=()=>{},nav=globalThis.navigator,doc=globalThis.document,clock=()=>Date.now()}){
 let enabled=false,watch=null,lock=null,generation=0,lastSent=0,sequence=0,watching=false;
 const status=(code,message)=>onStatus({code,message,enabled});
 async function release(){const l=lock;lock=null;if(l)try{await l.release();}catch{}}
 function clearWatch(){if(watch!==null){nav.geolocation?.clearWatch(watch);watch=null;}watching=false;}
 async function wake(gen){if(!nav.wakeLock?.request){status('wake-unavailable','الشاشة ممكن تقفل؛ خليك فاتح صفحة المشوار.');return;}try{const l=await nav.wakeLock.request('screen');if(!enabled||gen!==generation||doc.visibilityState!=='visible'){await l.release();return;}lock=l;l.addEventListener?.('release',()=>{if(lock===l){lock=null;status('wake-released','منع إغلاق الشاشة اتوقف؛ الجهاز هو اللي بيتحكم.');}});status('active','الموقع بيتحدّث والشاشة مطلوبة تفضل مفتوحة.');}catch{status('wake-denied','التتبع شغال والشاشة ممكن تقفل حسب إعدادات الجهاز.');}}
 async function begin(){if(!enabled||!allowed()||doc.visibilityState!=='visible'||watching)return;const gen=generation;watching=true;
  watch=nav.geolocation.watchPosition(position=>{
   if(!enabled||gen!==generation||!allowed()||doc.visibilityState!=='visible')return;
   const now=clock();if(now-lastSent<5000)return;const c=position.coords;if(!Number.isFinite(c.longitude)||!Number.isFinite(c.latitude)||!Number.isFinite(c.accuracy)||c.accuracy>5000){status('accuracy','إشارة الموقع ضعيفة؛ آخر موقع محفوظ ظاهر بوقته.');return;}
   lastSent=now;Promise.resolve(onPosition({coordinate:[c.longitude,c.latitude],accuracy:c.accuracy,recordedAt:new Date(position.timestamp||now).toISOString(),sequence:++sequence,source:'gps'})).catch(()=>status('send-failed','الموقع لم يتحدث؛ آخر تحديث ظاهر بوقته.'));
  },error=>{if(gen!==generation)return;status('location-error',error.code===1?'إذن الموقع مرفوض. تقدر تستكمل المهمة بتحديث الحالات.':'الموقع غير متاح مؤقتًا؛ وقت الوصول تقديري.');clearWatch();release();}, {enableHighAccuracy:true,maximumAge:10000,timeout:15000});
  await wake(gen);
 }
 async function start({lastSequence=0}={}){if(enabled)return; if(!allowed())throw Error('التتبع متاح للمندوب في المهمة المسندة فقط.');if(!nav?.geolocation)throw Error('المتصفح مش بيدعم تحديد الموقع.');enabled=true;generation++;sequence=lastSequence;lastSent=0;status('starting','بنطلب إذن الموقع للمهمة الحالية فقط.');await begin();}
 async function stop(){enabled=false;generation++;clearWatch();await release();status('stopped','مشاركة الموقع اتوقفت.');}
 const visibility=()=>{if(doc.visibilityState!=='visible'){generation++;clearWatch();release();if(enabled)status('hidden','التتبع متوقف والصفحة مش ظاهرة.');}else if(enabled){if(allowed())begin();else stop();}};
 const pagehide=()=>stop();doc?.addEventListener('visibilitychange',visibility);globalThis.addEventListener?.('pagehide',pagehide);
 return {start,stop,isEnabled:()=>enabled,async destroy(){await stop();doc?.removeEventListener('visibilitychange',visibility);globalThis.removeEventListener?.('pagehide',pagehide);}};
}
