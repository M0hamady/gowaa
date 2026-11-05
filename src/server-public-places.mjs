import {createClient} from '@supabase/supabase-js';
import {readFile} from 'node:fs/promises';

const clean = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = ['id','name','category','address','phone','description','url','image','menuUrl','mapCategory','schemaType','marketPriority','businessOwnerVerified','providerManaged','status','logo'];
  return Object.fromEntries(allowed.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
};

export default async function publicPlaces(req, res) {
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); res.statusCode = 405; return res.end(); }
    const [baseText, db] = await Promise.all([
      readFile(process.cwd() + '/public/data/places.json', 'utf8'),
      Promise.resolve(createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {auth:{persistSession:false}}))
    ]);
    const base = JSON.parse(baseText);
    const overrides = await db.from('site_content').select('id,data,archived').eq('kind','places');
    if (overrides.error) throw overrides.error;
    const merged = new Map(base.map(place => [place.id, clean(place)]));
    for (const row of overrides.data || []) {
      if (row.archived) { merged.delete(row.id); continue; }
      merged.set(row.id, {...merged.get(row.id), ...clean(row.data), id: row.id});
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(JSON.stringify([...merged.values()]));
  } catch {
    res.statusCode = 503;
    res.setHeader('Retry-After', '30');
    res.end(JSON.stringify({error:'تعذر تحميل آخر ترتيب للمحلات.'}));
  }
}
