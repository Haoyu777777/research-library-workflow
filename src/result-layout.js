// Preserve populated research sections; start new result notes with only the essentials.
const optional=new Set(['Assumptions and conventions','My understanding','Modified statement and assumptions','My proof or argument','Open questions']);
function compact(raw){const front=raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]||'',body=raw.slice(front.length);const lines=body.split('\n');let fence=null,parts=[],part={heading:null,lines:[]};for(const line of lines){const mark=line.match(/^\s*(`{3,}|~{3,})/);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;}const heading=!fence&&line.match(/^## (.+)$/);if(heading){parts.push(part);part={heading:heading[1],lines:[]};}else part.lines.push(line);}parts.push(part);const kept=parts.filter(p=>!optional.has(p.heading)||p.lines.join('\n').trim());if(!kept.some(p=>p.heading==='Notes'))kept.push({heading:'Notes',lines:[]});return front+kept.map(p=>(p.heading?'## '+p.heading+'\n\n':'')+p.lines.join('\n').replace(/^\n+|\n+$/g,'')).join('\n\n').trim()+'\n';}
function create({title,text='',image}){return '# '+title+'\n\n```research-library\nresult\n```\n\n'+(image?'## Source passage\n\n![['+image+']]\n\n':'')+'## Published statement\n\n'+text.trim()+'\n\n## Notes\n';}
function addAdaptationSections(raw){let next=raw.trimEnd();for(const title of ['Modified statement and assumptions','My proof or argument'])if(!sections(next).some(h=>h.level===2&&h.title===title))next+='\n\n## '+title+'\n';return next.trimEnd()+'\n';}
// Read real headings only: a heading inside a fenced example is statement text.
function sections(raw){const lines=raw.split('\n'),out=[];let fence=null,current=null;
 for(let i=0;i<lines.length;i++){const mark=lines[i].match(/^\s*(`{3,}|~{3,})/);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;continue;}const h=!fence&&lines[i].match(/^(#{2,3}) (.+?)\s*$/);if(h){if(current)current.end=i;current={title:h[2],level:h[1].length,start:i,end:lines.length};out.push(current);}}
 return out.map(s=>({...s,text:lines.slice(s.start+1,s.end).join('\n').trim()}));}
function section(raw,title){const list=sections(raw),s=list.find(s=>s.title===title);if(!s)return '';const lines=raw.split('\n'),end=list.find(h=>h.start>s.start&&h.level<=s.level)?.start??lines.length;return lines.slice(s.start+1,end).join('\n').trim();}
function published(raw){return section(raw,'Published statement')||section(raw,'Statement');}
function createWorkspace({title,text='',image,sourceLink,reference,usage='direct'}){return '# '+title+'\n\n```research-library\nresult\n```\n\n## Statement\n\n'+text.trim()+'\n\n## My work\n'+(usage==='adaptation'?'\n### Proposed statement\n\n### Changed assumptions\n\n### Proof changes\n':'')+'\n## Source\n\n'+(sourceLink?'[['+sourceLink+'|Original passage]]':'')+(reference?' · [['+reference+'|Paper details]]':'')+'\n\n'+(image?'![['+image+']]\n':'');}
function adapt(raw){
 if(!sections(raw).some(s=>s.level===2&&s.title==='My work'))return addAdaptationSections(raw);
 const lines=raw.split('\n'),headings=sections(raw),work=headings.find(s=>s.level===2&&s.title==='My work'),end=headings.find(s=>s.start>work.start&&s.level===2)?.start??lines.length;
 const existing=new Set(headings.filter(s=>s.start>work.start&&s.start<end).map(s=>s.title)),missing=['Proposed statement','Changed assumptions','Proof changes'].filter(t=>!existing.has(t));
 if(!missing.length)return raw;
 lines.splice(end,0,...('\n'+missing.map(t=>'### '+t+'\n').join('\n')+'\n').split('\n'));return lines.join('\n');
}
function usageSummary(m){return m.result_usage==='adaptation'?'Your adaptation · Draft':m.result_usage==='direct'?'Use directly':'';}
module.exports={compact,create,addAdaptationSections,sections,section,published,createWorkspace,adapt,usageSummary};
