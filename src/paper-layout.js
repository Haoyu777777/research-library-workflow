// Plain Markdown layout shared by existing paper notes and future imports.
const cleanName=s=>String(s||'').trim().toLowerCase();
function bibtexBlocks(text){
 const lines=String(text).split('\n'),blocks=[];let offset=0;
 for(let i=0;i<lines.length;i++){
  const start=lines[i].match(/^(\s*>\s*)?(`{3,})bibtex\b[^\n]*$/i);
  if(!start){offset+=lines[i].length+1;continue;}
  const quote=start[1]||'',ticks=start[2],begin=offset,values=[];let end=offset+lines[i].length+1,closed=false,j=i+1;
  for(;j<lines.length;j++){let value=lines[j];if(quote){if(!/^\s*>/.test(value))break;value=value.replace(/^\s*> ?/,'');}if(new RegExp('^'+ticks+'`*\\s*$').test(value)){end+=lines[j].length;closed=true;break;}values.push(value);end+=lines[j].length+1;}
  if(!closed)throw Error('An unfinished BibTeX block needs review before changing the paper layout.');
  blocks.push({start:begin,end,bib:values.join('\n').trim(),quote,ticks});
  for(;i<=j;i++)offset+=lines[i].length+1;i--;
 }
 return blocks;
}
const bibtex=text=>bibtexBlocks(text)[0]?.bib;
function replaceBibtex(text,bib){
 const block=bibtexBlocks(text)[0];if(!block)return null;
 const replacement=[block.ticks+'bibtex',...String(bib).split('\n'),block.ticks].map(l=>block.quote+l).join('\n');
 return text.slice(0,block.start)+replacement+text.slice(block.end);
}
function upsertBibtex(text,bib){const updated=replaceBibtex(text,bib);if(updated!==null)return updated;const blocks=referenceBlocks(text);if(blocks.length>1)throw Error('Multiple reference sections need review.');const block='```bibtex\n'+bib+'\n```';if(blocks.length){const r=blocks[0];return text.slice(0,r.start)+reference(r.content+'\n\n'+block)+'\n'+text.slice(r.end);}const last=sections(text).at(-1);return text.trimEnd()+'\n\n'+(cleanName(last?.name)==='reference details'?'':'## Reference details\n\n')+reference(block)+'\n';}
function referenceBlocks(text){
 const lines=String(text).split('\n'),out=[];let offset=0,heading='',fence=null;
 for(let i=0;i<lines.length;i++){
  const mark=lines[i].match(/^\s*(`{3,}|~{3,})/);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;offset+=lines[i].length+1;continue;}if(fence){offset+=lines[i].length+1;continue;}const h=lines[i].match(/^##\s+(.+?)\s*$/);if(h)heading=cleanName(h[1]);
  const title=lines[i].match(/^>\s*\[!info\][+-]?\s+(Reference details|Citation)\s*$/i)?.[1];if(!title||cleanName(title)==='citation'&&heading!=='reference details'){offset+=lines[i].length+1;continue;}
  const start=offset,values=[];offset+=lines[i].length+1;let j=i+1;
  for(;j<lines.length&&/^>/.test(lines[j]);j++){values.push(lines[j].replace(/^> ?/,''));offset+=lines[j].length+1;}
  out.push({start,end:Math.min(text.length,offset),content:values.join('\n').trim()});i=j-1;
 }
 return out;
}
function withoutReference(text){for(const block of referenceBlocks(text).reverse())text=text.slice(0,block.start)+text.slice(block.end);return text;}
function sections(body){
 const result=[];let current={name:'',text:[]},fence=null;
 for(const line of body.split('\n')){
  const mark=line.match(/^\s*(`{3,}|~{3,})/);if(mark){if(!fence)fence=mark[1];else if(mark[1][0]===fence[0]&&mark[1].length>=fence.length)fence=null;}
  const h=!fence&&line.match(/^##\s+(.+?)\s*$/);
  if(h){result.push({...current,body:current.text.join('\n').trim()});current={name:h[1],text:[]};}else current.text.push(line);
 }
 result.push({...current,body:current.text.join('\n').trim()});return result;
}
const managed='```research-library\npaper-annotations\n```';
const reference=content=>'> [!info]- Citation\n'+String(content).trim().split('\n').map(line=>'> '+line).join('\n');
function compact(raw){
 const match=raw.match(/^(---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$))/),front=match?.[1]||'',body=raw.slice(front.length).replace(/\r\n/g,'\n'),refs=referenceBlocks(body);
 if(refs.length>1)throw Error('Multiple reference sections need review before changing this note.');
 const blocks=bibtexBlocks(body);if(blocks.length!==1)throw Error('A reading-paper note must have exactly one BibTeX entry block before migration.');
 const chunks=sections(withoutReference(body)),prefix=chunks.shift().body,notes=[],extra=[],annotations=[],citations=refs.map(r=>r.content);
 const normal=new Set(['why i saved this paper','my paper notes','your paper notes','notes']);
 const optional=new Set(['key definitions and results','assumptions to revisit','proof ideas and possible adaptations','open questions']);
 for(const part of chunks){const name=cleanName(part.name);if(normal.has(name)){if(part.body)notes.push(part.body);}else if(['your annotations','annotations'].includes(name)){if(part.body)annotations.push(part.body);}else if(['bibliography','citation','reference details'].includes(name)){if(part.body)citations.push(part.body);}else if(part.body||!optional.has(name))extra.push('## '+part.name+(part.body?'\n\n'+part.body:''));}
 const annotation=annotations.join('\n\n')||managed;
 if(!annotation.includes(managed))throw Error('The PDF annotation display block is missing; review this note first.');
 const citation=citations.join('\n\n');if(!bibtex(citation))throw Error('The BibTeX block is outside a recognized citation section.');
 const next=front+(front.endsWith('\n')?'\n':'')+[prefix,'## Notes'+(notes.length?'\n\n'+notes.join('\n\n'):''),...extra,'## Annotations\n\n'+annotation,'## Reference details\n\n'+reference(citation)].filter(Boolean).join('\n\n')+'\n';
 const retained=withoutReference(next)+'\n'+referenceBlocks(next).map(r=>r.content).join('\n');for(const part of chunks)if(part.body&&!retained.includes(part.body))throw Error('Existing section content was not preserved: '+part.name);for(const r of refs)if(r.content&&!retained.includes(r.content))throw Error('Existing reference text was not preserved.');
 if(bibtex(next)!==blocks[0].bib)throw Error('The citation entry changed during layout migration.');
 return next;
}
function renderTemplate(template,values){return template.replace(/\{\{(\w+)\}\}/g,(match,key,offset)=>{if(!(key in values))throw Error('Unknown paper-template field: '+key);const prefix=template.slice(template.lastIndexOf('\n',offset)+1,offset).match(/^\s*> ?/)?.[0]||'';return prefix?String(values[key]).replace(/\n/g,'\n'+prefix):values[key];});}
const template='# {{title}}\n\n{{authors}} · {{edition}}\n\n```research-library\npaper\n```\n\n## Notes\n\n## Annotations\n\n'+managed+'\n\n## Reference details\n\n'+reference('```bibtex\n{{bibtex}}\n```')+'\n';
module.exports={upsertBibtex,bibtexBlocks,bibtex,replaceBibtex,referenceBlocks,withoutReference,sections,compact,renderTemplate,template};
