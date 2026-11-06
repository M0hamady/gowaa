import legacy from '../src/legacy-page.mjs';
import {requireMemberPage} from '../src/server-member.mjs';
export function createMarketPage({check=requireMemberPage,render=legacy}={}){return async(req,res)=>{const type=req.query?.type,id=req.query?.id;if(!['seller','item','catalog'].includes(type)){res.statusCode=404;return res.end('Not found');}if(!await check(req,res,'/'+type+'/'+encodeURIComponent(id||'')+(type==='seller'&&req.query?.request==='1'?'?request=1':'')))return;return render(req,res);};}
export default createMarketPage();
