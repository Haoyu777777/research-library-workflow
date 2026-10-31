const {Notice}=require('obsidian');
const DeletionSync=require('./deletion-sync');
const QuestionLayout=require('./question-status');
const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');

// All annotation writes share PDF++'s queue. A comment edit is a revision of
// the same paper, not a newly downloaded mathematical version.
module.exports=class PdfAnnotations {
  constructor(plugin){this.plugin=plugin;this.app=plugin.app;this.queues=new Map();this.timers=new Map();this.saving=Promise.resolve();this.activeVersions=new Map();}
  async onload(){
    this.data=await this.plugin.loadData() || {};this.data.pdfRevisions ||= {};
    this.deletions=new DeletionSync(this);this.deletions.onload();
    this.plugin.registerEvent(this.app.vault.on('modify',file=>{
      if(file.extension!=='md'||!file.path.startsWith('Annotations/')||this.plugin.naming?.applying)return;
      clearTimeout(this.timers.get(file.path));
      this.timers.set(file.path,setTimeout(()=>{this.timers.delete(file.path);this.plugin.run(()=>this.syncNote(file));},1000));
    }));
    this.plugin.register(()=>{for(const t of this.timers.values())clearTimeout(t);if(this.io?.process===this.wrapped)this.io.process=this.originalProcess;});
    this.app.workspace.onLayoutReady(()=>{this.install();this.deletions.ready=this.deletions.initialize();this.deletions.ready.catch(e=>this.plugin.run(()=>{throw e;}));});
  }
  install(){
    if(this.io)return this.io;
    const plus=this.app.plugins.plugins['pdf-plus'];
    if(!plus)throw new Error('Enable PDF++ to save standard PDF annotations.');
    this.plus=plus;this.io=plus.lib.highlight.writeFile.getPdfIo();this.originalProcess=this.io.process;
    // PDF++ owns the native PDF popup/menu confirmation. Keep it enabled for
    // every deletion, including marks that do not yet have a linked note.
    if(!plus.settings.warnEveryAnnotationDelete){plus.settings.warnEveryAnnotationDelete=true;this.plugin.run(()=>plus.saveSettings());}
    this.wrapped=(file,callback)=>{
      return this.enqueue(file,async()=>{
        const before=await this.deletions.inspect(file),version=this.deletions.versionForState(file,before);
        this.activeVersions.set(file.path,version);
        try{
          const result=await this.originalProcess.call(this.io,file,async doc=>{
            const value=await callback(doc);this.deletions.cleanDeletedPopups(doc,before);return value;
          });
          const after=await this.deletions.inspect(file);
          // This PDF++ I/O entrypoint writes annotations. pdf-lib may add harmless
          // q/Q content wrappers on its first save; that is still the same paper.
          (this.data.pdfContentVersions[file.path] ||= {})[before.contentHash]=version;
          await this.deletions.accept(file,after,version);
          return result;
        }finally{this.activeVersions.delete(file.path);}
      });
    };
    this.io.process=this.wrapped;return this.io;
  }
  enqueue(file,task){
    const previous=this.queues.get(file.path) || Promise.resolve();
    const next=previous.catch(()=>{}).then(task);this.queues.set(file.path,next);
    next.finally(()=>{if(this.queues.get(file.path)===next)this.queues.delete(file.path);}).catch(()=>{});return next;
  }
  async identify(file,bytes){
    const currentHash=await hash(bytes || await this.app.vault.readBinary(file)),known=this.data.pdfRevisions[file.path];
    if(known?.currentHash===currentHash)return known.versionId;
    if(this.deletions.states[file.path]){const state=await this.deletions.inspect(file);return this.deletions.versionForState(file,state);}
    return currentHash;
  }
  async versionFor(file){await this.deletions.ready;await this.queues.get(file.path);return this.identify(file);}
  find(page,id,nm){
    const io=this.install(),context=page.node.context;
    for(const ref of page.node.Annots()?.asArray() || []){
      const dict=context.lookup(ref);if(!dict?.get)continue;
      const objectId=`${ref.objectNumber}R${ref.generationNumber?ref.generationNumber:''}`;
      if((nm&&dict.get(context.obj('NM'))?.decodeText?.()===nm)||(!nm&&objectId===id))return {dict,id:objectId,ref};
    }
    return null;
  }
  setString(dict,name,text){
    const io=this.install(),ctx=dict.context;
    // Use PDF++'s own pdf-lib string class (Unicode-safe, same library instance).
    io.setAuthorToAnnotation(dict,'Research notes');
    const Hex=dict.get(ctx.obj('T')).constructor;dict.set(ctx.obj(name),Hex.fromText(String(text)));
  }
  async ensure(source,key,title){
    await this.deletions.ready;
    const io=this.install(),nm=source.annotationNm || `research-${key}`;
    return io.process(source.file,doc=>{
      const page=doc.getPage(source.page-1),existing=this.find(page,source.annotationId,source.annotationId?source.annotationNm:nm);
      if(existing)return {id:existing.id,nm:existing.dict.get(existing.dict.context.obj('NM'))?.decodeText?.() || null};
      // A broken link to an existing annotation must not create a second mark.
      if(source.annotationId)throw new Error('The linked PDF annotation is missing. Select the passage again.');
      const rects=source.rects?.length?source.rects:(source.rect?[source.rect]:[]),size=page.getSize();
      const rect=rects.length?this.plus.lib.highlight.geometry.mergeRectangles(...rects):[size.width-42,size.height-42,size.width-20,size.height-20];
      const fields={Subtype:rects.length?'Highlight':'Text',Rect:rect,C:[1,.816,0],F:4,CA:rects.length?.3:1};
      if(rects.length)fields.QuadPoints=this.plus.lib.highlight.geometry.rectsToQuadPoints(rects);
      else {fields.Name='Comment';fields.Open=false;}
      const ref=io.addAnnotation(page,fields),dict=page.node.context.lookup(ref);
      io.setContentsToAnnotation(dict,source.comment || title);this.setString(dict,'NM',nm);this.setString(dict,'Subj',title);
      const id=`${ref.objectNumber}R${ref.generationNumber?ref.generationNumber:''}`;return {id,nm};
    });
  }
  contents(raw,m){
    const sections=['My thoughts','Questions to check','Possible changes / proof ideas'],parts=[];
    for(const heading of sections){
      const start=raw.indexOf(`\n## ${heading}\n`);if(start<0)continue;
      const rest=raw.slice(start+heading.length+5),end=rest.search(/^## /m),text=QuestionLayout.withoutWidgets(end<0?rest:rest.slice(0,end)).trim();
      if(text)parts.push(`${heading}\n${text}`);
    }
    const original=m.annotation_comment;
    return [original,parts.length?parts.join('\n\n'):null].filter(Boolean).join('\n\n');
  }
  async syncNote(file){
    if(this.plugin.naming?.applying)return;
    await this.deletions.ready;
    if(this.app.vault.getAbstractFileByPath(file.path)!==file)return;
    const m=this.plugin.fields(file);if(!['research-annotation','imported-annotation'].includes(m.type)||!m.annotation_id)return;
    const pdf=this.app.vault.getAbstractFileByPath(m.source_pdf);if(!pdf)return;
    if(await this.versionFor(pdf)!==m.source_sha256)throw new Error('PDF version changed: comment sync paused to protect the version you read.');
    const contents=this.contents(await this.app.vault.read(file),m),io=this.install();
    // Read first, so edits to metadata and empty imported notes do not rewrite PDFs.
    const current=await io.read(pdf,doc=>{const found=this.find(doc.getPage(m.source_page-1),m.annotation_id,m.pdf_annotation_nm || m.annotation_external_id);return found?io.getContentsFromAnnotation(found.dict):null;});
    if(current===null||current===contents||(!contents&&m.type==='research-annotation'&&current===m.annotation_title))return;
    await io.process(pdf,doc=>{const found=this.find(doc.getPage(m.source_page-1),m.annotation_id,m.pdf_annotation_nm || m.annotation_external_id);if(found)io.setContentsToAnnotation(found.dict,contents);});
  }
  async backfill(file){
    const m=this.plugin.fields(file);if(m.type!=='research-annotation'||m.annotation_id)return false;
    const pdf=this.app.vault.getAbstractFileByPath(m.source_pdf);if(!pdf)return false;
    const marker=await this.ensure({file:pdf,page:m.source_page,rect:m.annotation_rect,rects:m.source_quad_rects,comment:this.contents(await this.app.vault.read(file),m)},m.capture_key,m.annotation_title);
    await this.plugin.update(file,{annotation_id:marker.id,pdf_annotation_nm:marker.nm,capture_source_link:m.source_link,source_link:`${pdf.path}#page=${m.source_page}&annotation=${marker.id}`});await this.deletions.remember(file,{...m,annotation_id:marker.id,pdf_annotation_nm:marker.nm});return true;
  }
};
