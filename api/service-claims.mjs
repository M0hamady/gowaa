export {verifiedBusinessPhone,claimOperation,createClaimsHandler} from '../src/legacy-service-claims.mjs';
import {createServiceGateway as createLegacyGateway} from '../src/legacy-service-claims.mjs';
import memberHandler from '../src/server-member.mjs';
import {providerCatalog,providerAdmin} from '../src/server-provider-catalog.mjs';
import operationsHandler from '../src/server-operations.mjs';
export function createServiceGateway({member=memberHandler,catalog=providerCatalog,admin=providerAdmin,operations=operationsHandler,...legacyOptions}={}){const legacy=createLegacyGateway(legacyOptions);return(req,res)=>{const route=req.query?.__serviceRoute;if(route==='member')return member(req,res);if(route==='provider-catalog')return catalog(req,res);if(route==='provider-admin')return admin(req,res);if(route==='operations')return operations(req,res);return legacy(req,res);};}
export default createServiceGateway();
