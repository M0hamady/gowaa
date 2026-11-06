export {verifiedBusinessPhone,claimOperation,createClaimsHandler} from '../src/legacy-service-claims.mjs';
import {createServiceGateway as createLegacyGateway} from '../src/legacy-service-claims.mjs';
import memberHandler from '../src/server-member.mjs';
import {providerCatalog,providerAdmin} from '../src/server-provider-catalog.mjs';
import operationsHandler from '../src/server-operations.mjs';
import {createAdminSmsHandler} from '../src/server-admin-sms.mjs';
import publicPlaces from '../src/server-public-places.mjs';
import bookingsHandler from '../src/server-bookings.mjs';
import assistantJourneysHandler from '../src/server-assistant-journeys.mjs';
import assistantRequestsHandler from '../src/server-assistant-requests.mjs';
import providerRequestsHandler from '../src/server-provider-requests.mjs';
import providerAlertsHandler from '../src/server-provider-alert-dispatch.mjs';
import shopCheckoutHandler from '../src/server-shop-checkout.mjs';
export function createServiceGateway({member=memberHandler,catalog=providerCatalog,admin=providerAdmin,operations=operationsHandler,adminSms=createAdminSmsHandler(),publicPlacesHandler=publicPlaces,bookings=bookingsHandler,assistantJourneys=assistantJourneysHandler,assistantRequests=assistantRequestsHandler,providerRequests=providerRequestsHandler,providerAlerts=providerAlertsHandler,shopCheckout=shopCheckoutHandler,...legacyOptions}={}){const legacy=createLegacyGateway(legacyOptions);return(req,res)=>{const route=req.query?.__serviceRoute;if(route==='member')return member(req,res);if(route==='provider-catalog')return catalog(req,res);if(route==='provider-admin')return admin(req,res);if(route==='operations')return operations(req,res);if(route==='admin-sms')return adminSms(req,res);if(route==='public-places')return publicPlacesHandler(req,res);if(route==='bookings')return bookings(req,res);if(route==='assistant-journeys')return assistantJourneys(req,res);if(route==='assistant-requests')return assistantRequests(req,res);if(route==='provider-requests')return providerRequests(req,res);if(route==='provider-alerts')return providerAlerts(req,res);if(route==='shop-checkout')return shopCheckout(req,res);return legacy(req,res);};}
export default createServiceGateway();
