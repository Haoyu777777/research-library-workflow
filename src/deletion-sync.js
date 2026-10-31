const {Notice,Modal,Setting}=require('obsidian');
const contentStream=require('./pdf-content-stream');
const Snapshot=require('./annotation-snapshot');
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

class DeleteConfirmation extends Modal {
  constructor(app,title,resolve){super(app);this.annotationTitle=title;this.resolve=resolve;}
  onOpen(){this.modalEl.addClass('research-dialog');
    this.titleEl.setText('Delete annotation and PDF highlight?');
    this.contentEl.createEl('p',{text:this.annotationTitle});
    this.contentEl.createEl('p',{text:'This removes the linked note and its mark in the PDF. You can restore both with Undo annotation deletion.'});
    new Setting(this.contentEl).addButton(button=>{
      button.setButtonText('Cancel').onClick(()=>this.close());setTimeout(()=>button.buttonEl.focus(),0);
    }).addButton(button=>button.setButtonText('Delete annotation').setWarning().onClick(()=>{this.resolve(true);this.close();}));
  }
  onClose(){this.resolve(false);this.contentEl.empty();}
}

module.exports=class DeletionSync {
  constructor(owner){this.owner=owner;this.plugin=owner.plugin;this.app=owner.app;this.suppressed=new Set();this.timers=new Map();this.jobs=new Set();this.stopped=false;}
  get links(){return this.owner.data.annotationLinks;}
  get states(){return this.owner.data.pdfStates;}
  get pending(){return this.owner.data.pendingAnnotationDeletes;}
  onload(){
    const data=this.owner.data;data.annotationLinks ||= {};data.pdfStates ||= {};data.pendingAnnotationDeletes ||= {};data.pdfContentVersions ||= {};data.annotationNoteBodies ||= {};data.annotationDeletionHistory ||= [];
    if(this.app.vault.getConfig?.('promptDelete')===false)this.app.vault.setConfig('promptDelete',true);
    this.plugin.addCommand({id:'undo-annotation-deletion',name:'Undo annotation deletion',checkCallback:checking=>{if(!this.latestDeletion())return false;if(!checking)this.plugin.run(()=>this.undo());return true;}});
    this.plugin.registerDomEvent(document,'keydown',event=>{
      if(!(event.metaKey||event.ctrlKey)||event.altKey||event.shiftKey||event.key.toLowerCase()!=='z'||event.defaultPrevented)return;
      if(event.target?.closest?.('input,textarea,[contenteditable="true"],.cm-editor,.modal-container'))return;
      const leaf=this.app.workspace.activeLeaf,record=this.latestDeletion();
      if(leaf?.view.getViewType()!=='pdf'||record?.link.pdf!==leaf.view.file?.path)return;
      event.preventDefault();event.stopPropagation();this.plugin.run(()=>this.undo(record.key));
    },true);
    this.plugin.registerEvent(this.app.metadataCache.on('changed',(file,_text,cache)=>{if(file.extension==='md')this.run(async()=>{await this.ready;await this.remember(file,cache?.frontmatter);});}));
    this.plugin.registerEvent(this.app.vault.on('delete',file=>{if(file.extension==='md')this.run(()=>this.noteDeleted(file));else if(!file.extension)for(const path of Object.keys(this.links))if(path.startsWith(file.path+'/'))this.run(()=>this.noteDeleted({path}));}));
    this.plugin.registerEvent(this.app.vault.on('modify',file=>{if(file.extension==='pdf')this.schedule(file);}));
    this.plugin.registerEvent(this.app.vault.on('create',file=>{if(file.extension==='pdf')this.schedule(file);}));
    this.plugin.registerEvent(this.app.vault.on('rename',(file,oldPath)=>this.run(()=>this.renamed(file,oldPath))));
    this.plugin.register(()=>{this.stopped=true;for(const timer of this.timers.values())clearTimeout(timer);});
  }
  run(task){const job=Promise.resolve().then(()=>{if(!this.stopped)return task();});this.jobs.add(job);job.catch(e=>{console.error('Annotation deletion sync:',e);new Notice(e.message || String(e),7000);}).finally(()=>this.jobs.delete(job));return job;}
  async save(){this.owner.saving=this.owner.saving.catch(()=>{}).then(()=>this.plugin.saveData(this.owner.data));await this.owner.saving;}
  schedule(file){clearTimeout(this.timers.get(file.path));this.timers.set(file.path,setTimeout(()=>{this.timers.delete(file.path);this.run(async()=>{await this.ready;if(this.app.vault.getAbstractFileByPath(file.path)!==file)return;await this.reconcile(file);await this.retry(file.path);});},400));}
  async initialize(){
    const notes=this.app.vault.getMarkdownFiles(),paths=new Set([...Object.values(this.links).map(x=>x.pdf),...Object.values(this.pending).map(x=>x.pdf)]);
    for(const note of notes){const link=this.linkFor(note,this.plugin.fields(note));if(link)paths.add(link.pdf);}
    // Reconcile persisted links first, including deletions made while the app was closed.
    for(const path of paths){const file=this.app.vault.getAbstractFileByPath(path);if(file?.extension==='pdf')try{await this.reconcile(file);}catch(e){new Notice(`Could not read ${file.basename}; linked notes were kept.`,7000);}}
    for(const [path,link] of Object.entries({...this.links}))if(!this.app.vault.getAbstractFileByPath(path))await this.queueRemovedNote(path,link);
    for(const file of this.app.vault.getMarkdownFiles())await this.remember(file,this.plugin.fields(file));
    for(const path of new Set(Object.values(this.pending).map(x=>x.pdf)))try{await this.retry(path);}catch(e){new Notice('A PDF could not be read; its pending annotation deletion was kept for retry.',7000);}
    await this.save();this.initialized=true;
  }
  linkFor(file,m){
    if(!['research-annotation','imported-annotation'].includes(m?.type)||!m.source_pdf||!m.annotation_id||!m.source_sha256||!Number.isInteger(m.source_page)||m.source_page<1)return null;
    return {note:file.path,pdf:m.source_pdf,version:m.source_sha256,page:m.source_page,id:String(m.annotation_id),nm:m.pdf_annotation_nm || m.annotation_external_id || null,rect:m.annotation_rect || null};
  }
  locate(state,link){
    if(!state)return null;
    if(link.nm)return state.annotations.find(a=>a.nm===link.nm) || null;
    return state.annotations.find(a=>a.page===link.page&&a.id===link.id&&(!link.rect || a.rect?.every((n,i)=>Math.abs(n-link.rect[i])<.1))) || null;
  }
  async remember(file,fields){
    if(this.stopped||this.app.vault.getAbstractFileByPath(file.path)!==file)return;
    const link=this.linkFor(file,fields || this.plugin.fields(file));if(!link)return;
    const previous=this.links[file.path],state=this.states[link.pdf],marker=state?.version===link.version&&this.locate(state,link);
    // A recovered note whose marker is already gone stays recoverable and detached.
    link.status=previous?.status==='active'&&previous.pdf===link.pdf&&previous.version===link.version&&(link.nm?previous.nm===link.nm:previous.id===link.id)?'active':marker?'active':'detached';
    if(marker){link.id=marker.id;link.page=marker.page;link.nm=marker.nm || link.nm;}
    const body=await this.app.vault.read(file),changed=!same(previous,link)||this.owner.data.annotationNoteBodies[file.path]!==body;
    this.owner.data.annotationNoteBodies[file.path]=body;
    if(changed){this.links[file.path]=link;await this.save();}
  }
  async inspect(file){
    const before=await sha(await this.app.vault.readBinary(file));
    const state=await this.owner.io.read(file,async doc=>{
      const pages=[],annotations=[];
      for(let i=0;i<doc.getPageCount();i++){
        const page=doc.getPage(i),ctx=page.node.context,contents=page.node.Contents(),streams=contents?.asArray?.() || (contents?[contents]:[]),hashes=[];
        const decoded=[];
        for(const ref of streams){
          const stream=ctx.lookup(ref);if(!stream?.getContents)throw new Error('Cannot inspect this PDF page; linked notes were kept.');
          decoded.push(contentStream(stream,ctx));
        }
        // pdf-lib surrounds contents with separate q/Q streams whenever it edits
        // page annotations. Ignore only matching outer graphics-state wrappers.
        while(decoded.length>1&&decoded[0].token==='q'&&decoded.at(-1).token==='Q'){decoded.shift();decoded.pop();}
        for(const item of decoded)hashes.push({filter:item.filter,hash:await sha(item.bytes)});
        pages.push({box:page.getMediaBox(),crop:page.getCropBox(),rotation:page.getRotation().angle,streams:hashes});
        for(const ref of page.node.Annots()?.asArray() || []){
          const dict=ctx.lookup(ref);if(!dict?.get)continue;
          const subtype=String(dict.get(ctx.obj('Subtype')) || '');if(!['/Highlight','/Text','/Underline','/FreeText','/StrikeOut','/Squiggly'].includes(subtype))continue;
          const nm=dict.get(ctx.obj('NM'))?.decodeText?.() || null,rect=dict.get(ctx.obj('Rect'))?.asArray?.().map(x=>x.asNumber());
          annotations.push({page:i+1,id:`${ref.objectNumber}R${ref.generationNumber?ref.generationNumber:''}`,nm,rect,subtype,snapshot:Snapshot.capture(page,ref)});
        }
      }
      return {contentHash:await sha(new TextEncoder().encode(JSON.stringify(pages))),annotations};
    });
    const currentHash=await sha(await this.app.vault.readBinary(file));if(before!==currentHash)throw new Error('The PDF is still being saved; linked annotations were kept.');
    return {...state,currentHash};
  }
  versionForState(file,state){
    const revision=this.owner.data.pdfRevisions[file.path],previous=this.states[file.path];
    if(revision?.currentHash===state.currentHash)return revision.versionId;
    if(previous?.contentHash===state.contentHash)return previous.version;
    return this.owner.data.pdfContentVersions[file.path]?.[state.contentHash] || state.currentHash;
  }
  async accept(file,state,version){
    const previousState=this.states[file.path];
    (this.owner.data.pdfContentVersions[file.path] ||= {})[state.contentHash]=version;
    this.states[file.path]={...state,version};this.owner.data.pdfRevisions[file.path]={versionId:version,currentHash:state.currentHash};
    for(const [path,link] of Object.entries({...this.links})){
      if(link.pdf!==file.path||link.version!==version)continue;
      const marker=this.locate(state,link);
      if(marker){
        const moved=link.id!==marker.id || link.page!==marker.page;
        link.status='active';link.id=marker.id;link.page=marker.page;link.nm=marker.nm || link.nm;
        const note=this.app.vault.getAbstractFileByPath(path);
        if(moved&&note)await this.plugin.update(note,{annotation_id:marker.id,source_page:marker.page,source_link:`${file.path}#page=${marker.page}&annotation=${marker.id}`});
      }else if(link.status==='active')await this.trashLinkedNote(path,this.locate(previousState,link));
    }
    await this.save();
  }
  async reconcile(file){return this.owner.enqueue(file,async()=>{const state=await this.inspect(file),version=this.versionForState(file,state);await this.accept(file,state,version);return state;});}
  cleanDeletedPopups(doc,before){
    const id=ref=>`${ref.objectNumber}R${ref.generationNumber?ref.generationNumber:''}`,active=new Set(),tracked=new Set(before.annotations.map(a=>a.id));
    for(const page of doc.getPages())for(const ref of page.node.Annots()?.asArray() || [])active.add(id(ref));
    for(const page of doc.getPages())for(const ref of [...(page.node.Annots()?.asArray() || [])]){
      const ctx=page.node.context,dict=ctx.lookup(ref);if(String(dict?.get?.(ctx.obj('Subtype')))!=='/Popup')continue;
      const parent=dict.get(ctx.obj('Parent'));if(parent&&tracked.has(id(parent))&&!active.has(id(parent)))page.node.removeAnnot(ref);
    }
  }
  async flushNote(note){for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(leaf.view.file===note&&typeof leaf.view.save==='function')await leaf.view.save();}
  async trashLinkedNote(path,marker){
    const note=this.app.vault.getAbstractFileByPath(path),previous=this.links[path];if(note)await this.flushNote(note);
    const record=previous&&await this.stageDeletion(previous,note?await this.app.vault.read(note):null,marker);
    delete this.links[path];clearTimeout(this.owner.timers.get(path));this.owner.timers.delete(path);
    for(const [key,value] of this.plugin.annotationWorkflow?.created || [])if(value===path)this.plugin.annotationWorkflow.created.delete(key);
    if(!note)return;
    this.suppressed.add(path);
    try{await this.app.vault.trash(note,false);await this.finishDeletion(record);}catch(e){if(previous)this.links[path]=previous;throw new Error(`The PDF highlight was deleted, but its note could not be moved to trash: ${e.message}`);}finally{this.suppressed.delete(path);}
  }
  async noteDeleted(file){
    clearTimeout(this.owner.timers.get(file.path));this.owner.timers.delete(file.path);
    const link=this.links[file.path];delete this.links[file.path];
    for(const [key,value] of this.plugin.annotationWorkflow?.created || [])if(value===file.path)this.plugin.annotationWorkflow.created.delete(key);
    if(this.suppressed.has(file.path)||!link){await this.save();return;}
    const record=await this.stageDeletion(link);
    await this.queueRemovedNote(file.path,link);await this.retry(link.pdf);await this.finishDeletion(record);
  }
  async queueRemovedNote(path,link){
    await this.stageDeletion(link);delete this.links[path];if(link.status==='active')this.pending[path]={...link};await this.save();
  }
  async retry(path){
    const file=this.app.vault.getAbstractFileByPath(path);if(file?.extension!=='pdf')return;
    for(const [key,link] of Object.entries({...this.pending})){
      if(link.pdf!==path)continue;
      // Restoration before the pending PDF edit cancels the queued deletion.
      if(this.app.vault.getAbstractFileByPath(link.note)){delete this.pending[key];await this.save();continue;}
      await this.owner.queues.get(path);
      const current=await this.inspect(file);if(this.versionForState(file,current)!==link.version)continue;
      let applied=false;
      await this.owner.io.process(file,doc=>{
        if(this.owner.activeVersions.get(path)!==link.version)return;
        for(let i=0;i<doc.getPageCount();i++){
          if(!link.nm&&i+1!==link.page)continue;
          const page=doc.getPage(i),found=this.owner.find(page,link.id,link.nm);
          if(found&&!link.nm&&link.rect){const rect=found.dict.get(page.node.context.obj('Rect'))?.asArray?.().map(x=>x.asNumber());if(!rect||!rect.every((n,j)=>Math.abs(n-link.rect[j])<.1))continue;}
          if(found){const popup=found.dict.get(page.node.context.obj('Popup'));if(popup)page.node.removeAnnot(popup);page.node.removeAnnot(found.ref);break;}
        }
        applied=true;
      });
      if(applied){delete this.pending[key];await this.save();}
    }
  }
  async requestDeleteNote(file){
    if(this.confirming)return;
    this.confirming=true;
    try{
      const confirmed=await new Promise(resolve=>new DeleteConfirmation(this.app,this.plugin.fields(file).annotation_title || file.basename,resolve).open());
      if(confirmed)await this.deleteNote(file);
      return confirmed;
    }finally{this.confirming=false;}
  }
  async deleteNote(file){
    await this.ready;if(this.app.vault.getAbstractFileByPath(file.path)!==file)return;
    await this.flushNote(file);await this.remember(file,this.plugin.fields(file));
    const link=this.links[file.path];if(link)await this.stageDeletion(link,await this.app.vault.read(file));
    await this.app.vault.trash(file,false);await this.idle();
  }
  latestDeletion(){return [...this.owner.data.annotationDeletionHistory].reverse().find(record=>record.status!=='restored'&&record.body&&record.snapshot);}
  async stageDeletion(link,body,marker){
    let record=[...this.owner.data.annotationDeletionHistory].reverse().find(item=>item.status!=='restored'&&item.link.note===link.note&&item.link.version===link.version&&(link.nm?item.link.nm===link.nm:item.link.id===link.id));
    if(!record){
      record={key:crypto.randomUUID(),at:new Date().toISOString(),link:{...link},status:'prepared'};this.owner.data.annotationDeletionHistory.push(record);
    }
    record.body=body ?? record.body ?? this.owner.data.annotationNoteBodies[link.note];
    record.snapshot=marker?.snapshot || record.snapshot || this.locate(this.states[link.pdf],link)?.snapshot;
    await this.save();return record;
  }
  async finishDeletion(record){
    if(!record)return;record.status='deleted';await this.save();
    if(this.announced?.has(record.key))return;(this.announced ||= new Set()).add(record.key);
    const content=document.createDocumentFragment();content.createSpan({text:'Annotation deleted. '});
    const button=content.createEl('button',{text:'Undo'}),notice=new Notice(content,12000);
    button.addEventListener('click',()=>{notice.hide();this.plugin.run(()=>this.undo(record.key));});
  }
  async undo(key){
    if(this.undoing)throw new Error('An annotation is already being restored.');
    this.undoing=true;
    try{
      await this.ready;await this.idle();
      const record=key?this.owner.data.annotationDeletionHistory.find(item=>item.key===key):this.latestDeletion();
      if(!record||record.status==='restored')throw new Error('There is no annotation deletion to undo.');
      if(!record.body||!record.snapshot)throw new Error('This older deletion has no complete Undo snapshot. Its note may still be in trash.');
      const link=record.link,pdf=this.app.vault.getAbstractFileByPath(link.pdf);
      if(pdf?.extension!=='pdf')throw new Error('Restore the source PDF before undoing this annotation deletion.');
      await this.owner.queues.get(pdf.path);
      const state=await this.inspect(pdf);
      if(this.versionForState(pdf,state)!==link.version)throw new Error('Undo paused: this is a different paper version. Restore the version you read first.');
      let note=this.app.vault.getAbstractFileByPath(link.note);
      if(note){
        await this.flushNote(note);const fields=this.plugin.fields(note),raw=await this.app.vault.read(note);
        if(raw!==record.body&&!(fields.source_pdf===link.pdf&&fields.source_sha256===link.version&&(link.nm?(fields.pdf_annotation_nm || fields.annotation_external_id)===link.nm:String(fields.annotation_id)===link.id)))throw new Error('Undo paused: another note now uses this filename. Rename it before trying again.');
      }
      record.status='restoring';delete this.pending[link.note];await this.save();
      // The queued write checks identity again; edits between the check above and
      // this callback must not attach a result to a different paper version.
      const marker=await this.owner.io.process(pdf,doc=>{
        if(this.owner.activeVersions.get(pdf.path)!==link.version)throw new Error('The PDF version changed while Undo was waiting.');
        const page=doc.getPage(link.page-1),recoveryNm=link.nm || `research-undo-${record.key}`;
        const recovered=this.owner.find(page,null,recoveryNm),existing=recovered || this.owner.find(page,link.id,link.nm);
        if(existing){
          if(!link.nm&&!recovered){const current=this.locate(state,link);if(!current||!same(current.snapshot,record.snapshot))throw new Error('Undo paused: the old PDF object now belongs to another annotation.');}
          return {id:existing.id,nm:recovered?recoveryNm:link.nm};
        }
        // Get the string class from PDF++ without changing the saved author.
        const dummy=page.node.context.obj({});this.owner.io.setContentsToAnnotation(dummy,'');
        const Hex=dummy.get(page.node.context.obj('Contents')).constructor;
        // Older PDF++ saves may have left the removed annotation's popup in
        // /Annots. Remove only that annotation's orphan popup before restoring.
        for(const ref of [...(page.node.Annots()?.asArray() || [])]){
          const ctx=page.node.context,dict=ctx.lookup(ref);if(String(dict?.get?.(ctx.obj('Subtype')))!=='/Popup')continue;
          const parent=dict.get(ctx.obj('Parent')),parentDict=parent&&ctx.lookup(parent),nm=parentDict?.get?.(ctx.obj('NM'))?.decodeText?.();
          const parentId=parent&&`${parent.objectNumber}R${parent.generationNumber?parent.generationNumber:''}`;
          if(link.nm?nm===link.nm:parentId===link.id)page.node.removeAnnot(ref);
        }
        const restored=Snapshot.restore(page,record.snapshot,Hex);
        if(!link.nm)restored.dict.set(page.node.context.obj('NM'),Hex.fromText(recoveryNm));
        return {id:restored.id,nm:restored.dict.get(page.node.context.obj('NM'))?.decodeText?.() || null};
      });
      if(!note){
        const parts=link.note.split('/');parts.pop();let folder='';
        for(const part of parts){folder=folder?folder+'/'+part:part;if(!this.app.vault.getAbstractFileByPath(folder))await this.app.vault.createFolder(folder);}
        note=await this.app.vault.create(link.note,record.body);
      }
      await this.plugin.update(note,{annotation_id:marker.id,...(marker.nm?{pdf_annotation_nm:marker.nm}:{}),source_pdf:link.pdf,source_sha256:link.version,source_page:link.page,source_link:`${link.pdf}#page=${link.page}&annotation=${marker.id}`});
      delete this.pending[link.note];this.links[link.note]={...link,id:marker.id,nm:marker.nm,status:'active'};
      this.owner.data.annotationNoteBodies[link.note]=await this.app.vault.read(note);
      record.status='restored';record.restoredAt=new Date().toISOString();await this.save();
      // Keep thoughts typed just before deletion consistent with the PDF popup.
      await this.owner.syncNote(note);
      await this.plugin.annotationWorkflow?.organizeNote?.(note);
      new Notice('Annotation and PDF highlight restored.');
      await this.plugin.annotationWorkflow?.openNote(note);return note;
    }finally{this.undoing=false;}
  }
  async renamed(file,oldPath){
    const folder=!file.extension,move=path=>path===oldPath?file.path:folder&&path.startsWith(oldPath+'/')?file.path+path.slice(oldPath.length):path;
    for(const [path,link] of Object.entries({...this.links})){const next=move(path);if(next!==path){delete this.links[path];link.note=next;this.links[next]=link;}const pdf=move(link.pdf);if(pdf!==link.pdf){link.pdf=pdf;const note=this.app.vault.getAbstractFileByPath(next);if(note)await this.plugin.update(note,{source_pdf:pdf,source_link:`${pdf}#page=${link.page}&annotation=${link.id}`});}}
    for(const group of [this.states,this.owner.data.pdfRevisions,this.owner.data.pdfContentVersions])for(const [path,value] of Object.entries({...group})){const next=move(path);if(next!==path){delete group[path];group[next]=value;}}
    for(const link of Object.values(this.pending)){link.note=move(link.note);link.pdf=move(link.pdf);}
    for(const record of this.owner.data.annotationDeletionHistory){record.link.note=move(record.link.note);record.link.pdf=move(record.link.pdf);}
    const folders=this.owner.data.annotationPaperFolders || {};
    for(const [path,entry] of Object.entries({...folders})){
      const next=move(path),pdf=move(entry.pdf);if(entry.pdf!==pdf){entry.pdf=pdf;const index=this.app.vault.getAbstractFileByPath(next+'/_Comments.md');if(index)await this.plugin.update(index,{source_pdf:pdf});}
      if(path!==next){delete folders[path];folders[next]=entry;}
    }
    for(const [path,body] of Object.entries({...this.owner.data.annotationNoteBodies})){const next=move(path);if(next!==path){delete this.owner.data.annotationNoteBodies[path];this.owner.data.annotationNoteBodies[next]=body;}}
    await this.save();
  }
  async idle(){
    // Excludes the current caller; suitable for commands and deterministic tests.
    for(let i=0;i<8;i++){const jobs=[...this.jobs,...this.owner.queues.values()];if(!jobs.length)break;await Promise.allSettled(jobs);}
    await this.owner.saving;
  }
};
