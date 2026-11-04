export const MEMBER_COOKIE='jowwa_member';
export function safeReturnPath(value,fallback='/'){
 if(typeof value!=='string'||value.length>2000||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f\u007f]/.test(value))return fallback;
 try{const decoded=decodeURIComponent(value);if(decoded.startsWith('//')||/[\\\u0000-\u001f]/.test(decoded))return fallback;const u=new URL(value,'https://jowwa.invalid');if(u.origin!=='https://jowwa.invalid'||!/^\/(?:$|market(?:\/category\/[a-z-]+)?$|(?:place|item|seller|menu|catalog|bus|guide)\/[a-zA-Z0-9_-]+$|buses$|places$)/.test(u.pathname))return fallback;for(const k of ['access_token','refresh_token','token','__serviceRoute'])u.searchParams.delete(k);return u.pathname+u.search+u.hash;}catch{return fallback;}
}
export function verifiedMember(user){return !!(user?.id&&(user.phone_confirmed_at||user.email_confirmed_at));}
export function protectedDestination(value){
 try{const u=new URL(value,'https://jowwa.invalid');return /^\/(place|item|seller|menu|catalog)\//.test(u.pathname)||u.pathname==='/market'&&u.searchParams.has('menu')||u.pathname==='/'&&(u.searchParams.has('to')||u.searchParams.has('from')||u.searchParams.has('round'));}catch{return false;}
}
export function memberLabel(kind){return kind==='route'?'سجّل عشان نكمّل طريقك':kind==='basket'?'سجّل عشان تحفظ سلتك':'سجّل عشان تشوف تفاصيل المكان';}
