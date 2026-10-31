const {Modal,Setting,Notice,MarkdownRenderer,MarkdownRenderChild,parseYaml}=require('obsidian');
const {createHash}=require('crypto');
const PaperLayout=require('./paper-layout');
const ResultStatus=require('./result-status');
const kinds={comment:'Comment',definition:'Definition',lemma:'Lemma',theorem:'Theorem',corollary:'Corollary',proposition:'Proposition',proof:'Proof idea',question:'Question'};
const mathematical=new Set(['definition','lemma','theorem','corollary','proposition','proof']);
const normalize=value=>String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
const bibliographic=value=>String(value || '').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/\\(?:mathbb|mathrm|mathsf|mathcal|operatorname|text)\s*/g,'').replace(/[{}]/g,'').replace(/_/g,'').replace(/['’]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const authorNames=value=>(Array.isArray(value)?value:value?[value]:[]).map(a=>typeof a==='string'?a:a?.literal || [a?.given,a?.family].filter(Boolean).join(' '));
const authorAliases=value=>(Array.isArray(value)?value:value?[value]:[]).flatMap(a=>{if(typeof a==='string')return [a];const initials=String(a?.given||'').split(/[\s.-]+/).filter(Boolean).map(word=>Array.from(word)[0]).join(' ');return [a?.literal,[a?.given,a?.family].filter(Boolean).join(' '),[a?.family,a?.given].filter(Boolean).join(' '),[initials,a?.family].filter(Boolean).join(' '),[a?.family,initials].filter(Boolean).join(' ')];}).filter(Boolean).join(' ');
function paperMatches(meta,query,field='any'){const fields={paperTitle:meta.title || '',author:authorAliases(meta.author),filename:[meta.source_pdf,meta.original_relative_path].filter(Boolean).join(' ')};const haystacks=Object.entries(fields).filter(([k])=>field==='any'||k===(field==='title'?'paperTitle':field)).map(([,v])=>bibliographic(v));return terms(query).every(t=>haystacks.some(h=>h.includes(bibliographic(t))));}
const terms=query=>[...String(query || '').matchAll(/"([^"]+)"|(\S+)/g)].map(m=>normalize(m[1] || m[2])).filter(Boolean);
const fingerprint=value=>createHash('sha256').update(String(value || '').trim()).digest('hex');
const withoutManaged=text=>String(text || '').replace(/```(?:research-library|bibtex)\s*\n[\s\S]*?```/g,'').replace(/!\[\[[^\]]+\]\]/g,'').trim();
function sections(body){
 body=PaperLayout.withoutReference(body);
 const result={};let heading='',fence=false;
 for(const line of body.split('\n')){if(/^\s*```/.test(line))fence=!fence;const match=!fence&&line.match(/^##\s+(.+?)\s*$/);if(match){heading=normalize(match[1]);result[heading] ||= '';continue;}result[heading]=(result[heading] || '')+line+'\n';}
 for(const key of Object.keys(result))result[key]=withoutManaged(result[key]);return result;
}
function nestedQuestions(body){
 const lines=PaperLayout.withoutReference(body).split('\n');let fence=false,level=0,selected=[],found=[];
 for(const line of lines){if(/^\s*```/.test(line)){fence=!fence;if(level)selected.push(line);continue;}const h=!fence&&line.match(/^(#{2,6})\s+(.+?)\s*$/);if(h){if(level&&h[1].length<=level){found.push(withoutManaged(selected.join('\n')));level=0;selected=[];}if(!level&&/^(open questions|questions to check)$/i.test(h[2])){level=h[1].length;continue;}}if(level)selected.push(line);}
 if(level)found.push(withoutManaged(selected.join('\n')));return found.filter(Boolean).join('\n\n');
}
function makeEntry(file,raw,m){
 let type;if(['research-annotation','imported-annotation'].includes(m.type))type='annotation';else if(m.type==='research-result')type='result';else if(file.path.startsWith('References/'))type=m.record_kind==='draft'?'draft':'paper';else if(m.type==='research-project'||m.type==='research-note'||/^(Notes|Proofs)\//.test(file.path))type='note';else return null;
 const body=raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/,''),parts=sections(body);
 const excluded=new Set(['source passage','your original comment','bibliography','reference details','your annotations','annotations','published statement','statement','source']);
 const ownText=Object.entries(parts).filter(([name])=>!excluded.has(name)).map(([,value])=>value).join('\n').trim();
 return {file,path:file.path,type,m,title:m.annotation_title || m.title || file.basename,parts,ownText,statement:parts['published statement'] || parts.statement || '',originalComment:m.annotation_comment || '',passage:m.source_text || '',questionSection:parts['questions to check'] || parts['open questions'] || nestedQuestions(body),modified:file.stat?.mtime || 0};
}
function enrich(entry,parent,projectIDs){
 const m=entry.m,kind=entry.type==='annotation'?(m.annotation_kind || 'comment'):entry.type==='result'?(m.kind || 'theorem'):(m.review_kind || ''),questionText=entry.questionSection || (kind==='question'?[entry.ownText,entry.originalComment,entry.passage].filter(Boolean).join('\n'):'');
 const hasQuestions=kind==='question'||!!entry.questionSection.trim(),resolved=hasQuestions&&m.question_status==='resolved'&&(!m.resolved_question_hash||m.resolved_question_hash===fingerprint(questionText));
 const context=parent?.m || m,authors=authorNames(context.author).join(', ');
 const metadata=[entry.title,context.title,authors,m.citekey,context.citekey,context.pdf_version,context.original_relative_path,m.collection,context.collection,...projectIDs].filter(Boolean).join(' ');
 return {...entry,parent,authors,kind,projectIDs,questionText,hasQuestions,resolved,pinned:m.review_pinned===true,dismissed:entry.type==='result'&&m.selection==='dismissed',needsReview:['paper','draft'].includes(entry.type)?m.metadata_status!=='checked':entry.type==='result'&&(m.selection!=='accepted'||m.transcription_status!=='checked'),localOnly:!!(m.local_processing_only||context.local_processing_only),fields:{title:normalize(entry.title),noteTitle:['paper','draft'].includes(entry.type)?'':bibliographic(entry.title),writing:normalize(entry.ownText),statement:normalize(entry.statement),comment:normalize(entry.originalComment),passage:normalize(entry.passage),metadata:normalize(metadata),paperTitle:bibliographic(context.title),author:bibliographic(authorAliases(context.author)),filename:bibliographic([entry.path,context.source_pdf,context.original_relative_path].filter(Boolean).join(' '))}};
}
function queryEntries(entries,state){
 const tokens=terms(state.q).filter(t=>!/^[-–—]+$/.test(t)&&(!(state.target==='papers'||['title','author'].includes(state.match))||bibliographic(t))),weights={title:8,noteTitle:8,writing:5,statement:5,comment:4,passage:3,metadata:1,paperTitle:12,author:10,filename:2};
 return entries.flatMap(entry=>{
  if(!state.includeDismissed&&entry.dismissed)return [];
  const paper=['paper','draft'].includes(entry.type);if(state.target==='papers'&&!paper||state.target==='notes'&&paper)return [];
  if(state.project&&state.project!=='*'&&!entry.projectIDs.includes(state.project))return [];
  if(state.scope&&state.scope!=='*'&&entry.type!==state.scope)return [];
  if(state.kind&&state.kind!=='*'&&entry.kind!==state.kind)return [];
  if(state.view==='pinned'&&!entry.pinned)return [];
  if(state.view==='definitions'&&(!mathematical.has(entry.kind)||entry.type==='result'&&entry.m.selection!=='accepted'))return [];
  if(state.view==='questions'&&!entry.hasQuestions)return [];
  if(state.view==='needs-review'&&!entry.needsReview)return [];
  if(state.questionState==='open'&&(!entry.hasQuestions||entry.resolved))return [];
  if(state.questionState==='resolved'&&!entry.resolved)return [];
  let score=0;const matched=new Set();
  for(const token of tokens){let found=false;for(const [field,text] of Object.entries(entry.fields)){if(field==='noteTitle'&&entry.fields.title.includes(token))continue;if(state.match==='author'&&field!=='author'||state.match==='title'&&field!=='paperTitle')continue;if(state.target==='papers'&&!['paperTitle','author','filename'].includes(field))continue;const needle=['paperTitle','author','filename','noteTitle'].includes(field)?bibliographic(token):token;if(needle&&text.includes(needle)){score+=weights[field];matched.add(field);found=true;}}if(!found)return [];}
  if(paper&&tokens.length)score+=20;
  return [{...entry,score,matched:[...matched]}];
 }).sort((a,b)=>tokens.length?b.score-a.score||a.title.localeCompare(b.title):state.sort==='recent'?b.modified-a.modified:String(a.parent?.title || a.title).localeCompare(String(b.parent?.title || b.title),undefined,{numeric:true})||(a.m.source_page || 0)-(b.m.source_page || 0)||a.title.localeCompare(b.title));
}

class ReviewModal extends Modal {
 constructor(service,file){super(service.app);this.service=service;this.file=file;}
 async onOpen(){this.modalEl.addClass('research-dialog','research-review-dialog');
  await this.service.ready;await this.service.indexFile(this.file);const e=this.service.entry(this.file.path);if(!e){this.close();return;}
  this.titleEl.setText('Review settings');this.contentEl.createEl('p',{text:e.title});let kind=e.kind || 'comment',pinned=e.pinned,status=e.resolved?'resolved':'open';
  if(['annotation','result','note'].includes(e.type))new Setting(this.contentEl).setName('Mathematical type').addDropdown(c=>{c.selectEl.setAttribute('aria-label','Mathematical type');c.addOptions(kinds).setValue(kind).onChange(v=>kind=v);});
  new Setting(this.contentEl).setName('Pin for review').setDesc('Keep this item in your Pinned view.').addToggle(c=>c.setValue(pinned).onChange(v=>pinned=v));
  new Setting(this.contentEl).setName('Question state').setDesc('Applies to a Question item or a nonempty Questions to check / Open questions section. New question text reopens a previously resolved question.').addDropdown(c=>{c.selectEl.setAttribute('aria-label','Question state');c.addOptions({open:'Open',resolved:'Resolved'}).setValue(status).onChange(v=>status=v);});
  new Setting(this.contentEl).addButton(c=>c.setButtonText('Save review settings').setCta().onClick(()=>this.service.plugin.run(async()=>{await this.service.saveSettings(this.file,{kind,pinned,status});this.close();}))).addButton(c=>c.setButtonText('Cancel').onClick(()=>this.close()));
 }
}

module.exports=class SearchReview {
 constructor(plugin){this.plugin=plugin;this.app=plugin.app;this.records=new Map();this.timers=new Map();this.failures=new Map();this.state={q:'',target:'all',match:'any',view:'all',project:'*',scope:'*',kind:'*',questionState:'any',sort:'source',page:1,includeDismissed:false};}
 onload(){
  this.storageKey='research-library-search:'+this.app.vault.getName();try{Object.assign(this.state,JSON.parse(localStorage.getItem(this.storageKey) || '{}'));}catch{}
  this.plugin.addCommand({id:'search-and-review',name:'Search and review research notes',callback:()=>this.plugin.run(()=>this.open())});
  this.plugin.addCommand({id:'review-pinned','name':'Review pinned research items',callback:()=>this.plugin.run(()=>this.open({view:'pinned',project:this.plugin.projects.active()}))});
  this.plugin.addCommand({id:'review-questions','name':'Review open research questions',callback:()=>this.plugin.run(()=>this.open({view:'questions',project:this.plugin.projects.active()}))});
  this.plugin.registerEvent(this.app.metadataCache.on('changed',file=>this.queue(file)));
  this.plugin.registerEvent(this.app.vault.on('modify',file=>{if(file.extension==='md')this.queue(file);}));
  this.plugin.registerEvent(this.app.vault.on('create',file=>{if(file.extension==='md')this.queue(file);}));
  this.plugin.registerEvent(this.app.vault.on('delete',file=>{for(const path of this.records.keys())if(path===file.path||path.startsWith(file.path+'/'))this.records.delete(path);this.emit();}));
  this.plugin.registerEvent(this.app.vault.on('rename',(file,old)=>{for(const path of this.records.keys())if(path===old||path.startsWith(old+'/'))this.records.delete(path);if(file.extension==='md')this.queue(file);else for(const note of this.app.vault.getMarkdownFiles().filter(n=>n.path.startsWith(file.path+'/')))this.queue(note);this.emit();}));
  this.plugin.register(()=>{for(const timer of this.timers.values())clearTimeout(timer);});
  this.app.workspace.onLayoutReady(()=>{this.ready=(async()=>{await this.plugin.projectReady;await this.plugin.annotationWorkflow.organizationReady;for(const file of this.app.vault.getMarkdownFiles())await this.indexFile(file);this.emit();})();this.ready.catch(error=>this.plugin.run(()=>{throw error;}));});
 }
 queue(file){clearTimeout(this.timers.get(file.path));this.timers.set(file.path,setTimeout(()=>{this.timers.delete(file.path);this.plugin.run(async()=>{await this.indexFile(file);this.emit();});},160));}
 async indexFile(file){
  if(file.extension!=='md'||this.app.vault.getAbstractFileByPath(file.path)!==file)return;
  try{const raw=await this.app.vault.read(file),m=parseYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '') || {},entry=makeEntry(file,raw,m);if(entry)this.records.set(file.path,entry);else this.records.delete(file.path);this.failures.delete(file.path);}catch(error){this.failures.set(file.path,error.message);}
 }
 emit(){this.app.workspace.trigger('research-library-search-updated');}
 entry(path){const entry=this.records.get(path);if(!entry)return null;const m=entry.m,reference=['paper','draft'].includes(entry.type)?entry:[...this.records.values()].find(r=>['paper','draft'].includes(r.type)&&(r.path===m.reference||r.m.source_pdf===m.source_pdf&&(!m.source_sha256||r.m.source_sha256===m.source_sha256)));const projectIDs=this.plugin.projects.ids(entry.type==='annotation'&&reference?reference.m:m);if(m.project_id)projectIDs.push(m.project_id);return enrich(entry,reference,projectIDs);}
 search(state=this.state){return queryEntries([...this.records.keys()].map(path=>this.entry(path)).filter(Boolean),state);}
 persist(){try{localStorage.setItem(this.storageKey,JSON.stringify(this.state));}catch{}}
 async open(options={}){
  await this.ready;if(options.view){Object.assign(this.state,{q:'',target:'all',match:'any',scope:'*',kind:'*',questionState:options.view==='questions'?'open':'any',page:1,includeDismissed:false});}Object.assign(this.state,options);this.persist();const path='Search and review.md';if(!this.app.vault.getAbstractFileByPath(path))await this.app.vault.create(path,'---\ntype: research-search\n---\n\n# Search and review\n\n```research-library\nsearch-review\n```\n');const leaf=await this.plugin.open(path);await leaf.setViewState({type:'markdown',state:{file:path,mode:'preview'}});this.emit();return leaf;
 }
 async saveSettings(file,{kind,pinned,status}){
  await this.plugin.annotationWorkflow?.ensureQuestionWidget?.(file);
  await this.plugin.pdfAnnotations.deletions.flushNote(file);await this.indexFile(file);const old=this.entry(file.path);if(!old)throw new Error('This file is not indexed as a research item.');
  if(pinned&&old.type==='result'&&old.m.selection!=='accepted')throw new Error('Accept this reference draft before pinning it for review.');
  const updates={review_pinned:!!pinned};if(kind&&kinds[kind]&&['annotation','result','note'].includes(old.type))updates[old.type==='annotation'?'annotation_kind':old.type==='result'?'kind':'review_kind']=kind;
  const changed=enrich({...old,m:{...old.m,...updates}},old.parent,old.projectIDs);updates.question_status=status || (old.resolved?'resolved':'open');updates.resolved_question_hash=updates.question_status==='resolved'&&changed.hasQuestions?fingerprint(changed.questionText):null;
  await this.plugin.update(file,updates);await this.indexFile(file);this.emit();
 }
 async togglePin(file){await this.ready;await this.indexFile(file);const entry=this.entry(file.path);if(!entry)return;await this.saveSettings(file,{kind:entry.kind,pinned:!entry.pinned,status:entry.resolved?'resolved':'open'});}
 async setQuestion(file,status){await this.ready;await this.indexFile(file);const entry=this.entry(file.path);if(entry)await this.saveSettings(file,{kind:entry.kind,pinned:entry.pinned,status});}
 async renderQuestionState(el,file){await this.ready;await this.indexFile(file);const row=this.entry(file.path);el.empty();el.removeClass('research-shell');el.addClass('research-question-widget');el.hidden=!row?.hasQuestions;if(!row?.hasQuestions)return;const state=el.createDiv({cls:'research-question-state'});state.createSpan({text:row.resolved?'Resolved':'Open',cls:'research-question-label',attr:{role:'status','aria-label':'Question status','aria-live':'polite'}});this.plugin.button(state,row.resolved?'Reopen question':'Resolve question',()=>this.setQuestion(file,row.resolved?'open':'resolved'));}
 openSettings(file){return new ReviewModal(this,file).open();}
 addActions(el,file){
  if(!file)return;const entry=this.entry(file.path),m=this.plugin.fields(file);this.plugin.button(el,(entry?.pinned ?? m.review_pinned)?'Unpin from review':'Pin for review',()=>this.togglePin(file));this.plugin.button(el,'Review settings',()=>new ReviewModal(this,file).open());this.plugin.button(el,'Search and review',()=>this.open());
 }
 async render(el,component){
  await this.ready;el.empty();el.addClass('research-search');
  el.createEl('p',{text:'Search saved notes, captured passages and paper metadata. Use the PDF reader to search other text in a paper.',cls:'research-meta'});
  const controls=el.createDiv({cls:'research-search-controls'}),advanced=document.createElement('details');advanced.className='research-filter-details';const summary=advanced.createEl('summary',{text:'Filters'}),extra=advanced.createDiv({cls:'research-search-controls research-extra-controls'});
  const field=(label,tag='select',parent=controls)=>{const wrapper=parent.createDiv();wrapper.createEl('label',{text:label});return wrapper.createEl(tag,{attr:{'aria-label':label}});};
  const input=field('Search notes and sources','input');input.type='search';input.placeholder='Words, "exact phrases", author names, or LaTeX';input.value=this.state.q || '';
  const select=(label,options,key,parent=controls)=>{const element=field(label,'select',parent);for(const [value,text]of Object.entries(options))element.createEl('option',{value,text});element.value=this.state[key];if(!element.value){element.value=Object.keys(options)[0];this.state[key]=element.value;}return element;};
  const target=select('Search in',{papers:'Papers and drafts',notes:'Notes and passages',all:'Everything'},'target'),match=select('Match',{any:'Any words',title:'Paper title',author:'Author'},'match'),view=select('Review view',{all:'All research',pinned:'Pinned for review',definitions:'Definitions and results',questions:'Questions','needs-review':'Needs review'},'view');
  const project=select('Project',{'*':'All projects',...Object.fromEntries(this.plugin.projects.all().map(p=>[p.id,p.title]))},'project',extra),scope=select('Item type',{'*':'All item types',paper:'Reading sources',draft:'My draft records',annotation:'Annotations',result:'Saved results',note:'Project and research notes'},'scope',extra),kind=select('Mathematical type',{'*':'All types',...kinds},'kind',extra),status=select('Question state',{any:'All states',open:'Open',resolved:'Resolved'},'questionState',extra),sort=select('Sort by',{source:'Paper and page',recent:'Recently edited'},'sort',extra);
  const reset=el.createDiv({cls:'research-actions research-page-primary'});this.plugin.button(reset,'Find a paper',()=>{Object.assign(this.state,{target:'papers',match:'any',view:'all',project:'*',scope:'*',kind:'*',questionState:'any',sort:'source',page:1,includeDismissed:false});advanced.open=false;this.emit();},true);this.plugin.button(reset,'Find notes',()=>{Object.assign(this.state,{target:'notes',match:'any',view:'all',project:'*',scope:'*',kind:'*',questionState:'any',sort:'source',page:1,includeDismissed:false});advanced.open=false;this.emit();});this.plugin.button(reset,'Clear filters',()=>{Object.assign(this.state,{target:'all',match:'any',view:'all',project:'*',scope:'*',kind:'*',questionState:'any',sort:'source',page:1,includeDismissed:false});advanced.open=false;this.emit();});
  el.append(advanced);const include=extra.createEl('label'),checkbox=include.createEl('input',{type:'checkbox'});checkbox.checked=this.state.includeDismissed;include.createSpan({text:' Include dismissed result drafts'});
  const activeCount=()=>[this.state.project!=='*',this.state.scope!=='*',this.state.kind!=='*',this.state.questionState!=='any',this.state.sort!=='source',this.state.includeDismissed].filter(Boolean).length,updateSummary=()=>{const n=activeCount();summary.setText(n?'Filters · '+n+' active':'Filters');};updateSummary();advanced.open=activeCount()>0;
  if(this.failures.size)el.createEl('p',{text:this.failures.size+' files could not be indexed. Their contents were kept unchanged.',cls:'research-meta'});
  const results=el.createDiv({cls:'research-search-results'}),navigation=el.createDiv({cls:'research-actions research-page-navigation research-pagination'});let renderChild,timer,generation=0;
  const draw=async()=>{
   const request=++generation;updateSummary();this.persist();if(renderChild)component.removeChild(renderChild);results.empty();navigation.empty();renderChild=new MarkdownRenderChild(results);component.addChild(renderChild);const child=renderChild,rows=this.search(),pageSize=20,pages=Math.max(1,Math.ceil(rows.length/pageSize));this.state.page=Math.max(1,Math.min(this.state.page || 1,pages));const start=(this.state.page-1)*pageSize;
   results.createEl('p',{text:rows.length+' matching items'+(rows.length?' · '+(start+1)+'–'+Math.min(start+pageSize,rows.length):''),cls:'research-meta'});if(!rows.length)results.createEl('p',{text:this.state.view==='pinned'?'Pin an annotation or result while reading to collect it here.':'No matches. Try fewer keywords or a broader filter.'});
   for(const row of rows.slice(start,start+pageSize)){if(request!==generation)return;await this.renderCard(results,row,child);}
   if(this.state.page>1)this.plugin.button(navigation,'Previous results',()=>{this.state.page--;return draw();});navigation.createSpan({text:'Page '+this.state.page+' of '+pages});if(this.state.page<pages)this.plugin.button(navigation,'Next results',()=>{this.state.page++;return draw();});
  };
  const schedule=(reset=true)=>{if(reset)this.state.page=1;clearTimeout(timer);timer=setTimeout(()=>this.plugin.run(draw),180);};
  const controlsAndKeys=[[target,'target'],[match,'match'],[view,'view'],[project,'project'],[scope,'scope'],[kind,'kind'],[status,'questionState'],[sort,'sort']];input.addEventListener('input',()=>{this.state.q=input.value;schedule();});for(const [control,key] of controlsAndKeys)control.addEventListener('change',()=>{this.state[key]=control.value;if(key==='view'){this.state.questionState=control.value==='questions'?'open':'any';status.value=this.state.questionState;if(control.value!=='all'){this.state.target='all';target.value='all';this.state.match='any';match.value='any';}}if(key==='target'){this.state.scope='*';scope.value='*';}if(key==='view'&&activeCount())advanced.open=true;schedule();});checkbox.addEventListener('change',()=>{this.state.includeDismissed=checkbox.checked;schedule();});
  component.registerEvent(this.app.workspace.on('research-library-search-updated',()=>{if(input.value!==this.state.q)input.value=this.state.q;for(const [control,key] of controlsAndKeys)control.value=this.state[key];checkbox.checked=this.state.includeDismissed;updateSummary();if(activeCount())advanced.open=true;schedule(false);}));component.register(()=>{clearTimeout(timer);generation++;});await draw();
 }
 async renderCard(el,row,component){
  const card=el.createDiv({cls:'research-card research-search-result'});card.dataset.researchPath=row.path;const title=card.createEl('h3'),openItem=()=>row.type==='annotation'?this.plugin.annotationWorkflow.openForWriting(row.file):this.plugin.open(row.file.path);this.plugin.button(title,row.title,openItem).addClass('research-title-link');const labels=[kinds[row.kind] || ({paper:'Reading source',draft:'Your draft',annotation:'Annotation',result:'Saved result',note:'Research notes'})[row.type]];
  if(row.parent&&row.parent.path!==row.path)labels.push(row.parent.title);if(row.m.source_page)labels.push('PDF p'+row.m.source_page);if(row.localOnly)labels.push('Local processing only');if(row.hasQuestions)labels.push(row.resolved?'Question resolved':'Open question');if(row.needsReview&&row.type!=='result')labels.push('Bibliographic metadata needs review');card.createEl('p',{text:labels.join(' · '),cls:'research-meta'});
  if(row.authors)card.createEl('p',{text:row.authors,cls:'research-authors'});if(['paper','draft'].includes(row.type))card.createEl('p',{text:row.m.pdf_version || 'Version not specified',cls:'research-meta'});
  if(row.type==='result')card.createEl('p',{text:ResultStatus.summary(row.m),cls:'research-meta research-result-status'});
  if(this.state.q&&row.matched.length)card.createEl('p',{text:'Matched in: '+row.matched.map(x=>({noteTitle:'note title',writing:'your writing',statement:'statement',comment:'original comment',passage:'captured passage',metadata:'paper metadata',title:'title',paperTitle:'paper title',author:'author',filename:'filename'})[x]).join(', '),cls:'research-meta'});
  const actions=card.createDiv({cls:'research-actions research-row-actions'});this.plugin.button(actions,row.type==='annotation'?'Open annotation':'Open note',openItem);if(row.m.source_link)this.plugin.button(actions,'Original passage',()=>this.plugin.openPdf(row.m.source_link,row.file.path));else if(row.m.source_pdf)this.plugin.button(actions,'Read PDF',()=>this.plugin.openPdf(row.m.source_pdf,row.file.path));const menu=this.plugin.reviewMenuItems(row.file,{search:false});if(row.hasQuestions)menu.push({title:row.resolved?'Reopen question':'Resolve question',icon:'circle-check',action:()=>this.setQuestion(row.file,row.resolved?'open':'resolved')});this.plugin.actionMenu(actions,menu,'More actions for '+row.title+(row.m.pdf_version?' · '+row.m.pdf_version:'')+(row.m.source_page?' · PDF page '+row.m.source_page:''));
  if(row.type==='result'&&row.statement){const statement=card.createDiv({cls:'research-statement'});await MarkdownRenderer.render(this.app,row.statement,statement,row.path,component);}
  else if(row.hasQuestions&&row.questionText){const question=card.createDiv({cls:'research-statement'});await MarkdownRenderer.render(this.app,row.questionText,question,row.path,component);}
  else if(row.ownText.trim()||row.originalComment){const text=(row.ownText.replace(/^# .+$/m,'').trim() || row.originalComment);card.createEl('p',{text:text.length>400?text.slice(0,397)+'…':text});}
  if(row.type==='annotation'&&row.m.excerpt_image){const file=this.app.vault.getAbstractFileByPath(row.m.excerpt_image);if(file){const details=card.createEl('details');details.createEl('summary',{text:'Source passage'});details.createEl('img',{attr:{src:this.app.vault.adapter.getResourcePath(file.path),alt:'Original passage, PDF page '+row.m.source_page,loading:'lazy'}});}}
 }
};
module.exports.makeEntry=makeEntry;module.exports.enrich=enrich;module.exports.queryEntries=queryEntries;module.exports.terms=terms;module.exports.paperMatches=paperMatches;module.exports.authorNames=authorNames;
