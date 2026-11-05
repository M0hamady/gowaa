// Turns an owner's logo file into (1) a 512px round logo on a white plate and
// (2) a 1200x630 link-preview card that shows it inside Jowwa's frame.
// Both are drawn in the browser so the server never processes raw uploads.
const LIME='#d1f36a',DEEP='#123e32',GREEN='#174c3b',PAPER='#f7f6ed';
const MAX_BYTES=5*1024*1024,TYPES=['image/png','image/jpeg','image/webp'];

export function checkLogoFile(file){
 if(!file||!file.size)return 'اختار صورة اللوجو.';
 if(!TYPES.includes(file.type))return 'اللوجو لازم يكون صورة PNG أو JPG أو WEBP.';
 if(file.size>MAX_BYTES)return 'حجم اللوجو أكبر من 5 ميجا. صغّره وجرب تاني.';
 return '';
}
function loadImage(src){return new Promise((ok,fail)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=()=>fail(Error('تعذر قراءة الصورة.'));im.src=src;});}
const blob=(canvas,type,q)=>new Promise((ok,fail)=>canvas.toBlob(b=>b?ok(b):fail(Error('تعذر تجهيز الصورة.')),type,q));
function rounded(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
// The logo fits inside the circle's inscribed square, so square and round logos both stay whole.
function plate(ctx,im,cx,cy,r){
 ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.clip();
 const box=r*2*0.8,scale=Math.min(box/im.width,box/im.height),w=im.width*scale,h=im.height*scale;
 ctx.imageSmoothingQuality='high';ctx.drawImage(im,cx-w/2,cy-h/2,w,h);ctx.restore();
}
function wrap(ctx,text,max){const words=String(text).split(/\s+/),lines=[];let line='';for(const w of words){const t=(line+' '+w).trim();if(ctx.measureText(t).width>max&&line){lines.push(line);line=w;}else line=t;}if(line)lines.push(line);return lines;}

export async function prepareLogo(file,{name='',tag='على دليل جوه'}={}){
 const problem=checkLogoFile(file);if(problem)throw Error(problem);
 const url=URL.createObjectURL(file);
 try{
  const im=await loadImage(url);
  if(im.width<64||im.height<64)throw Error('اللوجو صغير جدًا. استخدم صورة أكبر من 64 بكسل.');
  const square=document.createElement('canvas');square.width=square.height=512;
  plate(square.getContext('2d'),im,256,256,256);
  try{await document.fonts?.ready;}catch{}
  const c=document.createElement('canvas');c.width=1200;c.height=630;const x=c.getContext('2d');
  x.fillStyle=DEEP;x.fillRect(0,0,1200,630);
  rounded(x,40,40,370,550,28);x.fillStyle=GREEN;x.fill();
  const cx=225,cy=279,r=150;
  x.beginPath();x.arc(cx,cy,r+14,0,Math.PI*2);x.fillStyle=LIME;x.fill();
  x.beginPath();x.arc(cx,cy,r+4,0,Math.PI*2);x.fillStyle=DEEP;x.fill();
  plate(x,im,cx,cy,r);
  rounded(x,cx-92,cy+r+2,184,48,24);x.fillStyle=LIME;x.fill();
  x.direction='rtl';x.textAlign='center';x.textBaseline='middle';x.fillStyle=DEEP;x.font='800 26px Cairo, Tahoma, sans-serif';x.fillText('على جوه',cx,cy+r+27);
  rounded(x,438,40,714,550,32);x.fillStyle=PAPER;x.fill();
  rounded(x,1000,75,112,112,28);x.fillStyle=DEEP;x.fill();
  try{const icon=await loadImage('/icon.svg');x.drawImage(icon,1016,91,80,80);}catch{}
  x.textAlign='right';x.textBaseline='alphabetic';
  x.fillStyle=DEEP;x.font='800 62px Cairo, Tahoma, sans-serif';x.fillText('جوه',974,128);
  x.fillStyle='#557061';x.font='400 24px Cairo, Tahoma, sans-serif';x.fillText('كل كيان أقرب ليك',974,172);
  x.font='800 24px Cairo, Tahoma, sans-serif';const tw=Math.min(560,x.measureText(tag).width+34);
  rounded(x,1112-tw,214,tw,44,18);x.fillStyle='#e0edc3';x.fill();x.fillStyle='#28553d';x.fillText(tag,1095,245);
  x.font='800 49px Cairo, Tahoma, sans-serif';let lines=wrap(x,name,630);
  if(lines.length>2){x.font='800 41px Cairo, Tahoma, sans-serif';lines=wrap(x,name,630);}
  x.fillStyle=DEEP;lines.slice(0,3).forEach((l,i)=>x.fillText(l,1104,330+i*64));
  x.fillStyle='#627166';x.font='400 25px Cairo, Tahoma, sans-serif';x.fillText('المنيو والصور والتواصل',1104,505);
  x.fillStyle='#dce2d5';x.fillRect(478,530,634,2);
  x.fillStyle='#28553d';x.font='400 23px Cairo, Tahoma, sans-serif';x.direction='ltr';x.textAlign='right';x.fillText('jowwa-kayan.vercel.app',1104,575);
  return {logo:await blob(square,'image/webp',0.9),card:await blob(c,'image/png'),preview:square.toDataURL('image/webp',0.8)};
 }finally{URL.revokeObjectURL(url);}
}
