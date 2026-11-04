import legacy from '../src/legacy-menu.mjs';
import {requireMemberPage} from '../src/server-member.mjs';
export function createMenuPage({check=requireMemberPage,render=legacy}={}){return async(req,res)=>{if(!await check(req,res,'/menu/'+encodeURIComponent(req.query?.id||'')))return;return render(req,res);};}
export default createMenuPage();
