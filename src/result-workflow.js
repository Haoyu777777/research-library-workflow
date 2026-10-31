const {Modal,Setting,Notice,parseYaml}=require('obsidian');
const {randomUUID}=require('crypto');
const ResultLayout=require('./result-layout');
const types={definition:'Definition',lemma:'Lemma',theorem:'Theorem',corollary:'Corollary',proposition:'Proposition',proof:'Proof idea'};
const metadata=raw=>parseYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]||'')||{};

class SaveResultModal extends Modal {
 constructor(workflow,source){super(workflow.app);this.workflow=workflow;this.source=source;this.saving=false;this.closed=false;this.id=randomUUID();this.controller=new AbortController();}
 onOpen(){this.modalEl.addClass('research-dialog','research-result-dialog');this.titleEl.setText('Save a result');this.ready=this.load().catch(e=>{if(!this.closed)this.showError(e);});}
 showError(e){if(!this.status)this.status=this.contentEl.createEl('p',{cls:'research-meta research-form-error',attr:{role:'alert'}});this.status.setText(e.message||String(e));}
 async load(){const w=this.workflow,p=w.plugin;await p.projectReady;await p.annotationWorkflow.organizationReady;this.context=await w.context(this.source);if(this.closed)return;
  const c=this.context,project=c.projects[0]||p.projects.all()[0]?.id||'';this.form={title:c.title||'',usage:'direct',kind:types[c.kind]?c.kind:'theorem',project,reference:c.reference||p.references().find(f=>p.projects.contains(f,project))?.path||p.references()[0]?.path||'',page:c.page?String(c.page):''};
  const body=this.contentEl.createDiv({cls:'research-result-form'}),source=body.createEl('p',{cls:'research-meta research-result-source-summary'});this.sourceSummary=source;
  new Setting(body).setName('Title').addText(control=>{this.titleInput=control;control.setValue(this.form.title).setPlaceholder('A short name you will remember').onChange(v=>this.form.title=v);control.inputEl.setAttribute('aria-label','Result title');});
  new Setting(body).setName('How will you use it?').addDropdown(control=>control.addOptions({direct:'Use directly',adaptation:'Adapt it'}).setValue('direct').onChange(v=>{this.form.usage=v;this.hint.setText(v==='adaptation'?'The note separates your proposed statement, changed assumptions and proof changes.':'Write the statement and your notes in the Markdown editor.');}));
  this.hint=body.createEl('p',{text:'Write the statement and your notes in the Markdown editor.',cls:'research-meta'});
  const details=body.createEl('details',{cls:'research-result-source-details'});details.createEl('summary',{text:'Source and details'});
  new Setting(details).setName('Kind').addDropdown(control=>control.addOptions(types).setValue(this.form.kind).onChange(v=>this.form.kind=v));
  new Setting(details).setName('Project').addDropdown(control=>{for(const project of p.projects.all())control.addOption(project.id,project.title);control.setValue(this.form.project).onChange(v=>this.form.project=v);});
  new Setting(details).setName('Paper').addDropdown(control=>{for(const file of p.references())control.addOption(file.path,p.fields(file).title||file.basename);control.setValue(this.form.reference).onChange(v=>{this.form.reference=v;this.form.page='';this.context.snapshot=null;this.context.sourceLink=null;this.pageInput.setValue('');this.updateSummary();});});
  new Setting(details).setName('PDF page').addText(control=>{this.pageInput=control;control.setValue(this.form.page).setPlaceholder('PDF page number').onChange(v=>{this.form.page=v;this.updateSummary();});control.inputEl.setAttribute('aria-label','PDF page');});
  this.status=body.createEl('p',{cls:'research-meta research-form-error',attr:{role:'alert'}});
  const footer=this.contentEl.createDiv({cls:'research-result-footer'});new Setting(footer).addButton(control=>{this.saveButton=control;control.setButtonText('Save and write').setCta().onClick(()=>this.save());}).addButton(control=>control.setButtonText('Cancel').onClick(()=>this.close()));
  if(!this.form.page||!this.form.reference)details.open=true;this.updateSummary();this.titleInput.inputEl.focus();
 }
 updateSummary(){const p=this.workflow.plugin,file=this.app.vault.getAbstractFileByPath(this.form.reference),title=p.fields(file).title||file?.basename||'Choose a paper';this.sourceSummary.setText(title+(this.form.page?' · PDF page '+this.form.page:''));}
 async save(){if(this.saving)return;this.saving=true;this.saveButton.setDisabled(true);this.status.setText('');try{const file=await this.workflow.save({...this.form,id:this.id,context:this.context,signal:this.controller.signal});if(!this.closed){this.close();await this.workflow.write(file,'Statement');}}catch(e){if(!this.closed)this.showError(e);}finally{this.saving=false;if(!this.closed)this.saveButton.setDisabled(false);}}
 onClose(){this.closed=true;this.controller.abort();this.contentEl.empty();}
}

module.exports=class ResultWorkflow {
 constructor(plugin){this.plugin=plugin;this.app=plugin.app;this.saves=new Map();}
 open(source={}){const modal=new SaveResultModal(this,source);modal.open();return modal;}
 async context(source){const p=this.plugin,file=source?.path?this.app.vault.getAbstractFileByPath(source.path):null,m=file?.extension==='md'?metadata(await this.app.vault.read(file)):source||{};
  if(['research-annotation','imported-annotation'].includes(m.type)&&file){const snapshot=await p.transcription.snapshot(file);return {snapshot,title:snapshot.title,kind:snapshot.kind,projects:snapshot.projects,reference:snapshot.reference,page:snapshot.page,sourceLink:snapshot.sourceLink};}
  const reference=file?.path.startsWith('References/')?file:p.references().find(f=>(m.source_pdf||file?.extension==='pdf'&&file.path)&&p.paperInfo(f).path===(m.source_pdf||file.path)),projects=p.projects.ids(m),project=m.project_id||p.projects.active();
  return {title:'',kind:'theorem',projects:projects.length?projects:project&&project!=='*'?[project]:[],reference:reference?.path||'',page:m.source_page||'',sourceLink:m.source_link||null};
 }
 async save(form){if(this.saves.has(form.id))return this.saves.get(form.id);const job=this.performSave(form);this.saves.set(form.id,job);try{return await job;}catch(e){this.saves.delete(form.id);throw e;}}
 async performSave({title,usage,kind,project,reference,page,id,context={},signal}){
  if(signal?.aborted)throw Error('Result save cancelled.');
  const p=this.plugin;if(!id||!String(title||'').trim())throw Error('Enter a result title.');if(!['direct','adaptation'].includes(usage)||!types[kind])throw Error('Choose a result type and usage.');
  if(!p.projects.all().some(item=>item.id===project))throw Error('Choose a research project.');
  const file=this.app.vault.getAbstractFileByPath(reference),m=file?metadata(await this.app.vault.read(file)):{};if(!file||!file.path.startsWith('References/'))throw Error('Choose a saved paper.');
  const paper=p.paperInfo(file);if(!paper.file)throw Error('The source PDF is unavailable locally.');const number=Number(page);if(!Number.isInteger(number)||number<1)throw Error('Enter a positive PDF page number.');
  const count=await p.pdfAnnotations.io.read(paper.file,doc=>doc.getPageCount());if(number>count)throw Error('Enter a PDF page between 1 and '+count+'.');
  let snapshot=context.snapshot,current;
  if(snapshot){if(snapshot.reference!==reference||snapshot.pdfPath!==paper.path||snapshot.page!==number)throw Error('The selected paper or page differs from the captured passage. Reopen Save a result from that passage.');current=await p.transcription.validateSnapshot(snapshot);}
  const version=await p.pdfAnnotations.versionFor(paper.file);if(snapshot&&version!==snapshot.version)throw Error('The PDF version changed. Reopen Save a result from the current passage.');const sourceLink=snapshot?current.sourceLink:paper.path+'#page='+number;
  const localOnly=!!(snapshot?.localOnly||m.local_processing_only||m.record_kind==='draft'||paper.path.startsWith('Drafts/'));
  const fields={type:'research-result',id,title:title.trim(),kind,project,projects:[project],origin:'user',selection:'accepted',transcription_status:'unchecked',mathematical_status:'not-verified',result_usage:usage,result_layout:2,source_pdf:paper.path,source_sha256:version,source_page:number,source_link:sourceLink,reference,...(snapshot?{source_annotation:snapshot.path,excerpt_image:snapshot.imagePath,source_image_sha256:snapshot.imageHash}:{}),...(localOnly?{local_processing_only:true,source_kind:m.record_kind||'draft'}:{})};
  // Source statement stays blank until the user writes/transcribes it. Captured
  // extraction and personal comments are never silently treated as mathematics.
  return p.naming.createResult(fields,ResultLayout.createWorkspace({title:title.trim(),image:snapshot?.imagePath,sourceLink,reference,usage}),{signal});
 }
 async write(file,heading='My work'){const leaf=await this.plugin.open(file.path);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source'}});const editor=leaf.view.editor;if(editor){const lines=editor.getValue().split('\n'),index=lines.findIndex(line=>line==='## '+heading);if(index>=0)editor.setCursor({line:Math.min(index+2,lines.length-1),ch:0});editor.focus();}return leaf;}
 async adapt(file){if(!file||this.app.vault.getAbstractFileByPath(file.path)!==file)throw Error('This result is no longer available.');
  for(const leaf of this.app.workspace?.getLeavesOfType?.('markdown')||[])if(leaf.view.file?.path===file.path&&typeof leaf.view.save==='function')await leaf.view.save();
  // One atomic note update preserves all provenance and existing research text.
  await this.app.vault.process(file,raw=>{const m=metadata(raw);if(m.type!=='research-result')throw Error('Open a saved result first.');const changed=ResultLayout.adapt(raw),front=changed.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);if(!front)throw Error('The result metadata is missing.');const next=front[0].replace(/^result_usage:.*(?:\r?\n|$)/m,'');return next.replace(/\r?\n---(?:\r?\n|$)$/,'\nresult_usage: "adaptation"\n---\n')+changed.slice(front[0].length);});
  new Notice('Your adaptation is a draft; the source statement is preserved.');const raw=await this.app.vault.read(file);return this.write(file,ResultLayout.sections(raw).some(s=>s.title==='My work')?'My work':'Modified statement and assumptions');
 }
};
