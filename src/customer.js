import {mountMemberAccess} from './member-access.js';
import {mountProviderCatalog} from './provider-catalog-ui.js';
import {mountProviderAdmin} from './provider-admin.js';
function start(){mountMemberAccess();mountProviderCatalog();mountProviderAdmin();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
