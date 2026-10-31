const Rules=require('./naming-rules');
const keys=['title','authors','year','edition'];
const norm=v=>String(v||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\\(?:mathbb|mathrm|mathcal|text|operatorname)\s*/g,'').replace(/[^\p{L}\p{N}]/gu,'');
const displayAuthors=list=>(list||[]).map(a=>typeof a==='string'?a:a.literal||[a.family,a.given].filter(Boolean).join(', ')).join('\n');
const value=(meta,key)=>key==='authors'?displayAuthors(meta.author):String(meta[key]||'');
function evidence(meta,source){const result={};for(const key of keys)result[key]={value:value(meta,key),source,status:value(meta,key)?'suggested':'missing',alternatives:[],confirmed:false};return result;}
function merge(fields,meta,source,{verified=false,overwrite=true}={}){
 for(const key of keys){const incoming=value(meta,key);if(!incoming)continue;const f=fields[key];const different=f.value&&norm(f.value)!==norm(incoming);if(different&&!f.alternatives.some(a=>a.value===incoming&&a.source===source))f.alternatives.push({value:incoming,source});if(f.confirmed||f.edited){if(different){f.conflict=true;f.confirmed=false;f.edited=true;}continue;}if(overwrite||!f.value){if(different&&!f.alternatives.some(a=>a.value===f.value))f.alternatives.push({value:f.value,source:f.source});f.value=incoming;f.source=source;}f.status=verified?'verified':different?'conflicting':'suggested';f.conflict=!verified&&!!different;}
 return fields;
}
function matchingTitle(a,b){const x=norm(a),y=norm(b);if(!x||!y)return 'unknown';if(x===y)return 'agree';const tokens=s=>new Set(String(s).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]),aa=tokens(a),bb=tokens(b),shared=[...aa].filter(t=>bb.has(t)).length;return shared/Math.max(aa.size,bb.size,1)>=.75?'similar':'conflicting';}
function confirmed(fields){return keys.every(k=>fields[k].confirmed&&(k==='year'||k==='authors'||fields[k].value.trim()));}
function receipt(fields,extra={}){return {confirmed:confirmed(fields),fields:Object.fromEntries(keys.map(k=>[k,{value:fields[k].value,source:fields[k].edited?'User correction':fields[k].source,state:fields[k].value?'user-confirmed':'unknown-confirmed',alternatives:fields[k].alternatives}])),...extra};}
function formatSuggestions(fields){for(const key of ['title','authors']){const f=fields[key];if(f.edited||f.caseChosen||f.confirmed||f.status==='verified')continue;const value=key==='authors'?f.value.split('\n').map(v=>Rules.normalCase(v,'author')).join('\n'):Rules.normalCase(f.value,'title');if(value!==f.value){if(!f.alternatives.some(a=>a.value===f.value))f.alternatives.push({value:f.value,source:'Original source capitalization'});f.value=value;f.status='suggested';f.source+=' · capitalization normalized';}}return fields;}
module.exports={formatSuggestions,keys,norm,displayAuthors,evidence,merge,matchingTitle,confirmed,receipt};
