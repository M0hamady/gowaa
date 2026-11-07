import {mountMemberAccess, onMemberChange, memberState, memberFetch, ensureBookingMember} from './member-access.js';
import {createProviderRequests} from './provider-requests-ui.js';
import {mountProviderCatalog} from './provider-catalog-ui.js';
import {mountPlaceBooking} from './place-booking.js';
import {legacyCustomerDestination,marketDetailRoute} from '../public/customer-navigation.js';
import {mountAssistantMember} from './assistant-member.js';
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
 // ui-controls also imports this entrypoint on marketplace pages. Their own
 // market.js instance owns request dialogs and links; mounting twice would
 // start two authentication flows for the same notification link. A member
 // gate owns its continuation until login reloads the destination page.
 const marketPage=/^\/market(?:\.html|\/category\/[a-z-]+)?\/?$/.test(location.pathname)||marketDetailRoute(location.pathname);
 const requests=marketPage||document.body.hasAttribute('data-member-page')?null:createProviderRequests({fetcher:memberFetch,ensure:()=>ensureBookingMember({kind:'request'}),getUser:()=>memberState().user});
 if(requests)onMemberChange((state,prior)=>{if(prior&&prior!==state.user?.id)requests.reset();});
 mountMemberAccess();mountAssistantMember();if(location.pathname!=='/place/directory-sucreve')mountProviderCatalog();mountPlaceBooking();requests?.mount();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
