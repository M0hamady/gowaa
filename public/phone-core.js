export function normalizeEgyptianPhone(value){
 let phone=String(value||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[\s()+-]/g,'');
 if(phone.startsWith('0020'))phone=phone.slice(2);
 else if(/^01\d{9}$/.test(phone))phone='20'+phone.slice(1);
 else if(/^1\d{9}$/.test(phone))phone='20'+phone;
 if(!/^201[0125]\d{8}$/.test(phone))throw Error('اكتب رقم موبايل مصري صحيح من 11 رقم.');
 return '+'+phone;
}
export function maskedContact(contact,kind='phone'){
 const value=String(contact||'');
 if(kind==='email'){const [name,domain]=value.split('@');return domain?name.slice(0,1)+'•••@'+domain:'•••';}
 return value.length>4?'•••• '+value.slice(-4):'••••';
}
export function normalizeOtp(value){return String(value||'').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[^0-9]/g,'').slice(0,6);}
