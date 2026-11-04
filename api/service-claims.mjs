export {verifiedBusinessPhone,claimOperation,createClaimsHandler} from '../src/legacy-service-claims.mjs';
import {createServiceGateway as createLegacyGateway} from '../src/legacy-service-claims.mjs';
import memberHandler from '../src/server-member.mjs';
import {providerCatalog,providerAdmin} from '../src/server-provider-catalog.mjs';
export function createServiceGateway({member=memberHandler,catalog=providerCatalog,admin=providerAdmin,...legacyOptions}={}){const legacy=createLegacyGateway(legacyOptions);return(req,res)=>{const route=req.query?.__serviceRoute;if(route==='member')return member(req,res);if(route==='provider-catalog')return catalog(req,res);if(route==='provider-admin')return admin(req,res);return legacy(req,res);};}
export default createServiceGateway();
