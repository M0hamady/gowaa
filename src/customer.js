import {mountMemberAccess, onMemberChange, memberState} from './member-access.js';
import {mountProviderCatalog} from './provider-catalog-ui.js';
import {mountPlaceBooking} from './place-booking.js';
import {legacyCustomerDestination} from '../public/customer-navigation.js';
function start(){
 const destination=legacyCustomerDestination(location.pathname,location.search);
 if(destination){
  document.documentElement.classList.add('member-checking');
  location.replace(destination);return;
 }
 // Provider editing is only downloaded for an authenticated administrator.
 let adminModule=null;
 const mountAdmin=state=>{if(!state.admin||adminModule)return;adminModule=import('./provider-admin.js').then(module=>module.mountProviderAdmin()).catch(()=>{adminModule=null;});};
 onMemberChange(mountAdmin);mountAdmin(memberState());
 mountMemberAccess();mountProviderCatalog();mountPlaceBooking();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
