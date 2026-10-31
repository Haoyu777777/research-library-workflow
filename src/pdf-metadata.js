// Conservative local title-page suggestions; filesystem/PDF creation dates are not publication dates.
const clean=v=>String(v||'').replace(/\s+/g,' ').trim();
function titlePage(items){
 const lines=[];for(const i of items){if(!clean(i.str)||!i.transform||/^[∗*†‡.,;\d\s]+$/.test(clean(i.str)))continue;const y=i.transform[5],x=i.transform[4],size=i.height||Math.hypot(i.transform[2],i.transform[3]);let l=lines.find(l=>Math.abs(l.y-y)<2);if(!l){l={y,items:[],size:0};lines.push(l);}l.items.push({x,text:i.str});l.size=Math.max(l.size,size);}
 lines.sort((a,b)=>b.y-a.y);for(const l of lines)l.text=clean(l.items.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' '));
 const stop=lines.findIndex(l=>/^(abstract\b|(?:\d+[. ]+)?introduction\b|1\s+(?:main|preliminaries|overview))/i.test(l.text)),front=lines.slice(0,stop<0?Math.min(12,lines.length):stop).filter(l=>!/^arxiv\s*:|^https?:|^\d+$|^(?:received|accepted|published)\b/i.test(l.text));
 if(!front.length)return {};const max=Math.max(...front.map(l=>l.size)),start=front.findIndex(l=>l.size>=max*.95&&l.text.length>12);if(start<0)return {};const titles=[front[start]];let end=start+1;while(end<front.length&&front[end].size>=max*.85&&titles.at(-1).y-front[end].y<max*2.2){titles.push(front[end++]);}
 const title=clean(titles.map(l=>l.text).join(' ')),rest=front.slice(end),dateLine=rest.find(l=>/^(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/.test(l.text));
 const authorLines=[];for(const l of rest){if(dateLine===l)continue;if(/@|https?:|university|department|institute|college|faculty|laboratory|address|preprint|copyright|©|\b\d{4}\b|\b(?:street|avenue|road)\b/i.test(l.text))break;const text=l.text.replace(/[∗*†‡\d]+$/g,'').trim();if(text.length>160||/[=<>\\]/.test(text)||!/[A-Z]/.test(text))break;const pieces=l.items.map(i=>clean(i.text).replace(/[∗*†‡]+$/g,'').trim()).filter(Boolean),names=pieces.filter(t=>/^\p{Lu}[\p{L}.'’-]*(?:\s+\p{Lu}[\p{L}.'’-]*)+$/u.test(t));if(names.length>1&&names.length===pieces.length)authorLines.push(...names);else authorLines.push(text);if(authorLines.length>=3)break;}
 const names=authorLines.flatMap(l=>l.split(/\s+(?:and|&)\s+|\s*;\s*/i)).filter(Boolean),author=names.map(name=>({literal:name}));
 return {title,author,...(dateLine?{year:dateLine.text.match(/\b(?:19|20)\d{2}\b/)[0]}:{})};
}
module.exports={titlePage};
