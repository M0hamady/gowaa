import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
const url = new URL(process.env.POSTGRES_URL_NON_POOLING);
url.searchParams.delete('sslmode'); url.searchParams.delete('sslrootcert');
const db = new pg.Client({connectionString:url.href,ssl:{rejectUnauthorized:true,ca:await readFile('supabase/prod-ca-2021.crt','utf8')},connectionTimeoutMillis:20000});
await db.connect();
try {
  const admins=(await db.query('select count(*)::int as total,count(*) filter(where u.phone_confirmed_at is not null)::int as phone_confirmed from public.jowwa_admin_users a join auth.users u on u.id=a.user_id')).rows;
  const notifications=(await db.query('select kind,state,count(*)::int as total from public.notification_outbox group by kind,state order by kind,state')).rows;
  const sms=(await db.query("select purpose,state,count(*)::int as total from jowwa_private.sms_dispatch where created_at>now()-interval '24 hours' group by purpose,state order by purpose,state")).rows;
  const migrations=(await db.query('select name from jowwa_private.migrations order by name')).rows.map(r=>r.name);
  const notificationPolicy=(await db.query("select p.starts_at,(select count(*)::int from notification_outbox o where o.kind in ('visit','order') and o.sent_at>=p.starts_at) as immediate_event_messages_since_policy,(select max(sent_at) from notification_outbox where kind='visit') as last_old_visit_sent_at from jowwa_private.admin_notification_policy p")).rows;
  const result={checkedAt:new Date().toISOString(),admins,notifications,sms,migrations,notificationPolicy};
  await writeFile('../outputs/Jowwa-live-health.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await db.end();}
