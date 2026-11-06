export const MARKET_PAGE_SIZE=24;

/** Read a URL page without accepting fractions, negative values or exponent notation. */
export function pageNumber(value=1){
 const text=String(value??'').trim();
 if(!/^\d+$/.test(text))return 1;
 const number=Number(text);
 return number>0?Math.min(Number.MAX_SAFE_INTEGER,number):1;
}

export function pageWindow(page,totalPages,size=5){
 const total=Math.max(1,Math.floor(Number(totalPages)||1)),count=Math.min(total,Math.max(1,Math.floor(Number(size)||5)));
 const current=Math.min(total,pageNumber(page)),start=Math.max(1,Math.min(current-Math.floor(count/2),total-count+1));
 return Array.from({length:count},(_,index)=>start+index);
}

export function paginationState(total,page=1,pageSize=MARKET_PAGE_SIZE){
 const count=Number.isFinite(Number(total))?Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.floor(Number(total)))):0;
 const size=Number.isInteger(pageSize)&&pageSize>0&&pageSize<=1000?pageSize:MARKET_PAGE_SIZE;
 const totalPages=Math.max(1,Math.ceil(count/size)),current=Math.min(totalPages,pageNumber(page)),offset=(current-1)*size;
 return {page:current,pageSize:size,total:count,totalPages,offset,start:count?offset+1:0,end:Math.min(offset+size,count),pages:pageWindow(current,totalPages),hasPrevious:current>1,hasNext:current<totalPages};
}

export function pageSlice(items,page=1,pageSize=MARKET_PAGE_SIZE){
 const rows=Array.isArray(items)?items:[],state=paginationState(rows.length,page,pageSize);
 return {...state,items:rows.slice(state.offset,state.offset+state.pageSize)};
}
