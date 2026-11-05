import transit from '../public/data/transit.json' with {type:'json'};
const base='https://jowwa-kayan.vercel.app';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export const sitemapXml=links=>'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+[...new Set(links)].slice(0,49999).map(url=>'<url><loc>'+xml(url)+'</loc></url>').join('')+'</urlset>';
// Only pages anyone can open are listed. Place, menu, guide and market detail pages
// require sign-in (noindex), so listing them would only produce crawl errors; they
// still share with a full preview card (src/share-meta.mjs).
export const PUBLIC_PAGES=['/','/market','/buses'];
export default async function handler(req,res){
 try{
  const links=[...PUBLIC_PAGES.map(p=>base+p),...transit.routes.map(r=>base+'/bus/'+encodeURIComponent(r.id))];
  res.setHeader('Content-Type','application/xml; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','public, max-age=3600');res.end(sitemapXml(links));
 }catch{res.statusCode=503;res.setHeader('Retry-After','60');res.end('Temporarily unavailable');}
}
