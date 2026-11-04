import {mountMemberAccess} from './member-access.js';
import {mountProviderCatalog} from './provider-catalog-ui.js';
import {mountProviderAdmin} from './provider-admin.js';
import {mountProviderOwner} from './provider-owner.js';
function start(){
 const menu=new URLSearchParams(location.search).get('menu');
 if(location.pathname==='/market'&&menu&&/^[a-zA-Z0-9_-]{1,100}$/.test(menu)){
  document.documentElement.classList.add('member-checking');
  location.replace('/menu/'+encodeURIComponent(menu));return;
 }
 mountMemberAccess();mountProviderCatalog();mountProviderAdmin();mountProviderOwner();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
