// Public link-preview data for pages that sit behind member sign-in.
// Only what is already public in the directory (name, category, short description,
// share card). Never phones, addresses beyond the area, or anything private.
import {readFile} from 'node:fs/promises';

const ORIGIN='https://jowwa-kayan.vercel.app';
const cache=new Map();
async function json(name){
 if(!cache.has(name))cache.set(name,readFile(process.cwd()+'/public/data/'+name,'utf8').then(JSON.parse).catch(()=>null));
 return cache.get(name);
}
const clip=(s,n)=>{s=String(s||'').replace(/\s+/g,' ').replace(/(?:\+?20|0)1[0-9][\s-]?[0-9]{3,4}[\s-]?[0-9]{4}/g,'').trim();return s.length>n?s.slice(0,n-1).trim()+'…':s;};
const safeImage=v=>typeof v==='string'&&/^\/(social|menus)\/[a-zA-Z0-9_\/-]+\.(png|jpg|webp)$/.test(v)?v:null;
const placeCard=p=>safeImage(p?.image)?.startsWith('/social/')?p.image:'/social/'+p.id+'.png';

export async function shareMeta(path){
 const base={title:'جوه | كيان سيتي',description:'دليل كيان سيتي: خريطة، باصات، أماكن وخدمات وسوق أهل كيان.',image:'/social/places.png',card:true,url:ORIGIN+path};
 try{
  let m;
  if((m=path.match(/^\/place\/([a-zA-Z0-9_-]{1,120})$/))){
   const p=((await json('places.json'))||[]).find(x=>x.id===decodeURIComponent(m[1]));
   if(!p)return base;
   return {...base,title:`${p.name} — ${p.category||'كيان سيتي'} | جوه`,description:clip(p.description||`تعرف على ${p.name} في كيان سيتي.`,180),image:placeCard(p)};
  }
  if((m=path.match(/^\/menu\/([a-z0-9-]{1,140})$/))){
   const items=(await json('market-directory.json'))?.items||[];const v=items.find(x=>x.id===m[1]);
   if(!v)return base;
   const p=((await json('places.json'))||[]).find(x=>x.id===v.placeId);
   const price=typeof v.price==='number'?` — ${new Intl.NumberFormat('ar-EG').format(v.price)} جنيه`:'';
   const photo=v.imageKind==='product_photo'?safeImage(v.imageUrl):null;
   return {...base,title:`${v.title}${price} | ${v.sellerName}`,description:clip(v.description||`${v.title} من ${v.sellerName} في كيان سيتي.`,180),image:photo||(p?placeCard(p):'/social/market.png'),card:!photo};
  }
  if((m=path.match(/^\/guide\/(.{1,80})$/)))return {...base,title:`${clip(decodeURIComponent(m[1]),60)} في كيان سيتي | جوه`,description:'أماكن وخدمات كيان سيتي مع التواصل ومصدر المعلومة.'};
  if(path==='/places')return {...base,title:'دليل أماكن وخدمات كيان سيتي | جوه'};
  if(/^\/(item|seller|catalog)\//.test(path))return {...base,title:'سوق جوه | منتجات وخدمات أهل كيان',description:'منتجات وخدمات من أهل كيان. ادخل لحسابك عشان تشوف التفاصيل وتتواصل.',image:'/social/market.png'};
 }catch{}
 return base;
}

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function shareTags(meta){
 const image=ORIGIN+meta.image;
 return `<title>${esc(meta.title)}</title><meta name="description" content="${esc(meta.description)}">`
  +`<meta property="og:type" content="website"><meta property="og:site_name" content="جوه"><meta property="og:locale" content="ar_EG">`
  +`<meta property="og:title" content="${esc(meta.title)}"><meta property="og:description" content="${esc(meta.description)}"><meta property="og:url" content="${esc(meta.url)}">`
  +`<meta property="og:image" content="${esc(image)}"><meta property="og:image:alt" content="${esc(meta.title)}">`
  +(meta.card?'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">':'')
  +`<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(meta.title)}"><meta name="twitter:description" content="${esc(meta.description)}"><meta name="twitter:image" content="${esc(image)}">`;
}
