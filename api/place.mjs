import legacy from '../src/legacy-place.mjs';
import {requireMemberPage} from '../src/server-member.mjs';
export function createPlacePage({check=requireMemberPage,render=legacy}={}){return async(req,res)=>{const id=req.query?.id,category=req.query?.category;const next=id?'/place/'+encodeURIComponent(id):category?'/guide/'+encodeURIComponent(category):'/places';if(!await check(req,res,next))return;return render(req,res);};}
export default createPlacePage();
