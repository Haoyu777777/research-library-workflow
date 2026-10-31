// Insert a managed view under the question heading; never persist a status
// label in the user's writing. Preserve every existing byte, including EOLs.
function insert(raw){
 const front=raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]||'',body=raw.slice(front.length);let offset=front.length,at=null,eol='\n',fence=null,kind='',captured=[];
 for(const line of body.match(/[^\n]*(?:\n|$)/g)||[]){if(!line)continue;const text=line.replace(/\r?\n$/,'');const marker=text.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim()){if(kind==='research-library'&&captured.join('\n').trim()==='question-status')return {text:raw,inserted:false,hasHeading:at!==null,hasWidget:true};fence=null;kind='';captured=[];}else captured.push(text);}
  else if(marker){fence=marker[1];kind=marker[2].trim();captured=[];}
  else if(at===null&&/^#{2,6}\s+(?:Questions to check|Open questions)\s*$/i.test(text)){at=offset+text.length;eol=line.endsWith('\r\n')?'\r\n':'\n';}
  offset+=line.length;
 }
 if(at===null)return {text:raw,inserted:false,hasHeading:false};const addition=eol+eol+'```research-library'+eol+'question-status'+eol+'```';return {text:raw.slice(0,at)+addition+raw.slice(at),inserted:true,hasHeading:true,at,length:addition.length};
}
module.exports={insert};
// PDF popups contain research writing, never managed interface blocks. Respect
// surrounding fences so code examples remain the user's original text.
function withoutWidgets(raw){let fence=null,kind='',start=0,offset=0,ranges=[];for(const line of raw.match(/[^\n]*(?:\n|$)/g)||[]){if(!line)continue;const marker=line.replace(/\r?\n$/,'').match(/^ {0,3}(`{3,}|~{3,})(.*)$/);if(!fence&&marker){fence=marker[1];kind=marker[2].trim();start=offset;}else if(fence&&marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2].trim()){if(kind==='research-library')ranges.push([start,offset+line.length]);fence=null;kind='';}offset+=line.length;}for(const [start,end]of ranges.reverse())raw=raw.slice(0,start)+raw.slice(end);return raw;}
module.exports.withoutWidgets=withoutWidgets;

// Add the optional section only on an explicit Write question action.
function addSection(raw){const view=insert(raw);if(view.hasHeading||view.hasWidget)return view.text;const eol=raw.includes('\r\n')?'\r\n':'\n',gap=raw.endsWith(eol+eol)?'':raw.endsWith(eol)?eol:eol+eol;return insert(raw+gap+'## Questions to check'+eol+eol).text;}
module.exports.addSection=addSection;
