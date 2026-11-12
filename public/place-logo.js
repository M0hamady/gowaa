// A shop's own logo, shown inside Jowwa's frame (white plate, lime ring, Jowwa badge).
// Logos are either files shipped with the site (/logos/<id>.webp) or an owner upload
// stored privately and served through /api/image once the shop's details are approved.
export const LOGO_PATH=/^[0-9a-f-]{36}\/(?:logo|card)-[a-z0-9]{4,40}\.(?:webp|png)$/;
const STATIC=/^\/logos\/[a-z0-9-]{1,100}\.(?:webp|png|jpg)$/;
export function placeLogo(p){
 const v=typeof p?.logo==='string'?p.logo:'';
 // Reviewed Kayan brand artwork is stored on the same media CDN as its existing offer posters.
 if(p?.id==='directory-kayan-frozen-meats'&&/^https:\/\/d2ol7oe51mr4n9\.cloudfront\.net\/user_[a-zA-Z0-9]+\/[0-9a-f-]{36}\.png$/.test(v))return v;
 if(STATIC.test(v))return v;
 if(LOGO_PATH.test(v)&&/^[a-zA-Z0-9_-]{1,100}$/.test(p.id||''))return '/api/image?type=place&id='+encodeURIComponent(p.id)+'&v='+encodeURIComponent(v.split('/').pop().replace(/\..+$/,''));
 return '';
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function logoFrame(p,size=64){
 const src=placeLogo(p);if(!src)return '';
 return `<span class="jowwa-logo" style="--logo:${Number(size)||64}px"><img src="${esc(src)}" alt="لوجو ${esc(p.name)}" width="${size}" height="${size}" loading="lazy" decoding="async"><img class="jowwa-logo-badge" src="/icon.svg" alt="" aria-hidden="true" width="20" height="20"></span>`;
}
