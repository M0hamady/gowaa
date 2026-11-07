import legacy from '../src/legacy-place.mjs';
import {requireMemberPage} from '../src/server-member.mjs';
import {placeReturnPath} from '../public/customer-navigation.js';
export function createPlacePage({check=requireMemberPage,render=legacy}={}){return async(req,res)=>{const id=req.query?.id,category=req.query?.category;const next=id?placeReturnPath(id,req.query):category?'/guide/'+encodeURIComponent(category):'/places';if(id!=='directory-sucreve'&&!await check(req,res,next))return;return render(req,res);};}
export default createPlacePage();
