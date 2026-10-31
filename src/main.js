const ActionMenus=require('./action-menus');
const { Plugin, Modal, Menu, Setting, Notice, MarkdownRenderer, MarkdownRenderChild, loadPdfJs, normalizePath, setIcon, parseYaml } = require('obsidian');
const AnnotationWorkflow = require('./annotations');
const PdfAnnotations = require('./pdf-annotations');
const Projects = require('./projects');
const PaperImport = require('./paper-import');
const LibraryMaintenance = require('./library-maintenance');
const SearchReview = require('./search-review');
const Transcription = require('./transcription');
const Naming = require('./naming');
const CitationAliases = require('./citation-aliases');
const Citations = require('./citations');
const PaperLayout=require('./paper-layout');
const ResultStatus=require('./result-status');
const ResultLayout=require('./result-layout');
const ResultWorkflow=require('./result-workflow');
const ResultConnections=require('./result-connections');
const ProjectReview=require('./project-review');
const SourceLinks=require('./source-links');

const yaml = value => JSON.stringify(value);
const frontmatter = fields => '---\n' + Object.entries(fields).map(([k,v]) => `${k}: ${yaml(v)}`).join('\n') + '\n---\n\n';
const slug = text => text.replace(/[\\/:*?"<>|#\[\]]/g, '-').trim().slice(0,110) || 'Untitled result';
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
const bibtexBlock = text => PaperLayout.bibtex(text);
function entryForKey(text,key){
  const entries=/@\w+\s*\{\s*([^,\s]+),/g;let match;
  while((match=entries.exec(text))){let depth=1,end=text.indexOf('{',match.index)+1;
    for(;end<text.length&&depth;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='{')depth++;if(text[end]==='}')depth--;}
    if(match[1]===key&&depth===0)return text.slice(match.index,end).trim();entries.lastIndex=end;
  }
}
const statement = text => ResultLayout.published(text);

class ResultModal {
  constructor(plugin,source){this.plugin=plugin;this.source=source;}
  open(){return this.plugin.resultWorkflow.open(this.source);}
}

class PdfModal extends Modal {
  constructor(plugin){super(plugin.app);this.plugin=plugin;}
  onOpen(){this.modalEl.addClass('research-dialog');
    this.contentEl.createEl('h2',{text:'Import existing PDF annotations'});
    this.contentEl.createEl('p',{text:'Imports highlights and typed comments into Markdown. Existing imported notes are skipped; the PDF is not changed.'});
    const pdfs=this.app.vault.getFiles().filter(f=>f.extension==='pdf');
    let path=pdfs[0]?.path;
    new Setting(this.contentEl).setName('PDF').addDropdown(c=>{for(const f of pdfs)c.addOption(f.path,f.basename);c.onChange(v=>path=v);});
    new Setting(this.contentEl).addButton(c=>c.setButtonText('Import annotations').setCta().onClick(()=>this.plugin.run(async()=>{
      if(!path)throw new Error('Add a PDF to this vault first.');
      const file=this.app.vault.getAbstractFileByPath(path);this.close();await this.plugin.importAnnotations(file);
    })));
  }
  onClose(){this.contentEl.empty();}
}

module.exports=class ResearchLibrary extends Plugin {
  async onload(){
    document.body.addClass('research-library-ui');
    this.register(()=>document.body.removeClass('research-library-ui'));
    this.pdfAnnotations=new PdfAnnotations(this);
    await this.pdfAnnotations.onload();
    this.projects=new Projects(this);
    this.naming=new Naming(this);this.naming.onload();
    this.paperImport=new PaperImport(this);
    this.maintenance=new LibraryMaintenance(this);this.maintenance.onload();
    this.annotationWorkflow=new AnnotationWorkflow(this);
    this.annotationWorkflow.onload();
    this.app.workspace.onLayoutReady(()=>{this.projectReady=this.run(async()=>{await this.pdfAnnotations.deletions.ready;await this.projects.initialize();});});
    this.searchReview=new SearchReview(this);this.searchReview.onload();
    this.projectReview=new ProjectReview(this);
    this.paperImport.onload();
    this.transcription=new Transcription(this);this.transcription.onload();
    this.resultWorkflow=new ResultWorkflow(this);this.resultConnections=new ResultConnections(this);
    this.citations=new Citations(this);this.citations.onload();
    for(const [id,name,fn] of [
      ['open-library','Open research library',()=>this.open('Home.md')],
      ['open-project-review-sheet','Open project review sheet',()=>this.projectReview.open()],
      ['save-result','Save a mathematical result',()=>new ResultModal(this,{...this.activeFields(),path:this.app.workspace.getActiveFile()?.path}).open()],
      ['import-annotations','Import PDF annotations',()=>new PdfModal(this).open()],
      ['export-bibtex','Export citations',()=>this.citations.open()],
      ['copy-bibtex','Copy current paper BibTeX',()=>this.copyBibtex(this.app.workspace.getActiveFile()?.path)],
      ['copy-citation','Copy current paper citation',()=>this.copyCitation(this.app.workspace.getActiveFile()?.path)],
      ['create-project','Create research project',()=>this.projects.newModal()],
      ['add-paper','Add a paper from PDF, arXiv or DOI',()=>this.paperImport.open()],
    ])this.addCommand({id,name,callback:()=>this.run(fn)});
    this.addRibbonIcon('library','Open research library',()=>this.open('Home.md'));
    this.referenceFoldState=new Map();this.referenceControls=new WeakSet();
    this.registerMarkdownPostProcessor((el,ctx)=>{
      if(!ctx.sourcePath.startsWith('References/'))return;
      const boxes=[...(el.matches?.('.callout[data-callout="info"]')?[el]:[]),...el.querySelectorAll('.callout[data-callout="info"]')];
      for(const box of boxes){const title=box.querySelector('.callout-title'),content=box.querySelector('.callout-content');if(!title||!content||!(['Reference details','Citation'].includes(title.textContent.trim()))||this.referenceControls.has(box))continue;
        const file=this.app.vault.getAbstractFileByPath(ctx.sourcePath),child=new MarkdownRenderChild(box);ctx.addChild(child);this.referenceControls.add(box);box.dataset.researchReference='true';
        const key=()=>file?.path||ctx.sourcePath,apply=()=>{const collapsed=this.referenceFoldState.get(key())!==false;box.classList.toggle('is-collapsed',collapsed);content.style.display=collapsed?'none':'';title.setAttribute('aria-expanded',String(!collapsed));content.setAttribute('aria-hidden',String(collapsed));};
        const toggle=event=>{event.preventDefault();event.stopImmediatePropagation();this.referenceFoldState.set(key(),box.classList.contains('is-collapsed')?false:true);apply();};
        title.setAttribute('role','button');title.setAttribute('tabindex','0');child.registerDomEvent(title,'click',toggle,{capture:true});child.registerDomEvent(title,'keydown',event=>{if(event.key==='Enter'||event.key===' ')toggle(event);},{capture:true});child.register(()=>{this.referenceControls.delete(box);delete box.dataset.researchReference;});apply();
      }
    });
    this.registerMarkdownCodeBlockProcessor('research-library',(source,el,ctx)=>{
      if(ctx.sourcePath.startsWith('Templates/')){el.createEl('pre',{text:source.trim()});return;}
      const child=new MarkdownRenderChild(el);ctx.addChild(child);
      // Live Preview can keep a code-block context after its note is renamed.
      // The file object follows note/folder moves; ctx.sourcePath can stay stale.
      const sourceFile=this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      let timer;
      const refresh=()=>{
        if(!sourceFile||this.app.vault.getAbstractFileByPath(sourceFile.path)!==sourceFile){el.empty();return;}
        return this.run(()=>this.render(source.trim(),el,sourceFile.path,child));
      };
      const schedule=()=>{clearTimeout(timer);timer=setTimeout(refresh,180);};
      if(source.trim().startsWith('project-review')||source.trim()==='question-status'||source.trim()==='result'||source.trim()==='annotation')child.registerEvent(this.app.workspace.on('research-library-search-updated',schedule));
      if(source.trim()!=='search-review'){
        child.registerEvent(this.app.metadataCache.on('changed',schedule));
        child.registerEvent(this.app.metadataCache.on('deleted',schedule));
        child.registerEvent(this.app.vault.on('delete',schedule));
        child.registerEvent(this.app.vault.on('rename',schedule));
      }
      child.register(()=>clearTimeout(timer));refresh();
    });
  }
  async run(fn){try{return await fn();}catch(e){console.error('Research Library:',e);new Notice(e.message || String(e),7000);}}
  fields(file){return file?this.app.metadataCache.getFileCache(file)?.frontmatter || {}:{};}
  activeFields(){return this.fields(this.app.workspace.getActiveFile());}
  references(){return this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('References/'));}
  paperInfo(file){
    const m=this.fields(file),candidates=[m.source_pdf,...(Array.isArray(m.attachments)?m.attachments:[]),...(Array.isArray(m.attachment)?m.attachment:[m.attachment])];
    for(const candidate of candidates){if(typeof candidate!=='string')continue;const path=(candidate.match(/\[\[([^|\]]+)/)?.[1] || candidate).split('#')[0];const pdf=this.app.vault.getAbstractFileByPath(path) || this.app.metadataCache.getFirstLinkpathDest(path,file?.path || '');if(pdf?.extension==='pdf')return {file:pdf,path:pdf.path};}
    return {};
  }
  results(project='*'){return this.app.vault.getMarkdownFiles().filter(f=>this.fields(f).type==='research-result'&&this.projects.contains(f,project));}
  async open(path){
    await new Promise(resolve=>this.app.workspace.onLayoutReady(resolve));
    const f=this.app.vault.getAbstractFileByPath(path);if(!f)throw new Error(`File not found: ${path}`);
    return await this.annotationWorkflow.openNote(f);
  }
  async openPdf(link,sourcePath){
    const path=String(link).split('#')[0],file=this.app.vault.getAbstractFileByPath(path) || this.app.metadataCache.getFirstLinkpathDest(path,sourcePath || '');
    if(file?.extension!=='pdf')throw new Error('The linked PDF is not available locally.');
    const origin=this.app.vault.getAbstractFileByPath(sourcePath||'');
    if(origin?.extension==='md'){
      const read=async f=>parseYaml((await this.app.vault.read(f)).match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'')||{},m=await read(origin);
      if(m.type==='research-result'&&m.source_pdf===file.path&&m.source_sha256){
        await this.pdfAnnotations.deletions.ready;await this.pdfAnnotations.queues.get(file.path);const live=await this.pdfAnnotations.deletions.inspect(file);
        if(this.pdfAnnotations.deletions.versionForState(file,live)!==m.source_sha256)throw new Error('This result belongs to a different saved PDF version. Restore the version you read before opening its source.');
        if(m.source_annotation||m.excerpt_image){const records=[],direct=this.app.vault.getAbstractFileByPath(m.source_annotation||'');if(direct?.extension==='md'){try{records.push({path:direct.path,m:await read(direct)});}catch{}}
          if(!records.some(record=>SourceLinks.matches(m,record))){for(const candidate of this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('Annotations/')&&f!==direct)){const cached=this.fields(candidate);if(cached.type&&!SourceLinks.matches(m,{m:cached}))continue;try{const record={path:candidate.path,m:await read(candidate)};if(SourceLinks.matches(m,record))records.push(record);}catch{}}}
          const target=SourceLinks.resolve(m,records,live,String(link));link=target.link;if(target.status==='missing'||target.status==='ambiguous')new Notice('Source annotation unavailable; opened the saved PDF page.');
        }
      }
    }
    const fragment=new URLSearchParams(String(link).split('#')[1] || ''),annotation=fragment.get('annotation');
    fragment.delete('annotation');const pageLink=annotation?file.path+(fragment.size?'#'+fragment.toString():''):link;
    const readers=this.app.workspace.getLeavesOfType('pdf').filter(l=>l.getRoot()===this.app.workspace.rootSplit);
    const matching=readers.filter(l=>(l.view.file?.path || l.getViewState?.().state?.file)===file.path);
    const loaded=l=>!!l.view.viewer?.child?.pdfViewer?.pdfDocument,visible=l=>l.view.containerEl.getBoundingClientRect().width>0;
    const existing=matching.find(l=>loaded(l)&&visible(l)) || matching.find(loaded) || matching.find(visible) || matching[0] || readers.find(visible) || readers[0];
    if(existing){this.app.workspace.setActiveLeaf(existing,{focus:true});await this.app.workspace.revealLeaf(existing);await this.app.workspace.openLinkText(pageLink,sourcePath || '',false);}
    else await this.app.workspace.openLinkText(pageLink,sourcePath || '','split');
    if(!annotation)return;
    // An Undo save reloads the PDF asynchronously. Obsidian can report the page
    // rendered while its old annotation layer has already been destroyed.
    // Wait for the current file bytes and a live layer before focusing a mark.
    await this.pdfAnnotations.queues.get(file.path);
    const expected=await digest(await this.app.vault.readBinary(file)),pageNumber=Number(fragment.get('page') || 1),deadline=Date.now()+10000;
    this.pdfLoadedHashes ||= new WeakMap();
    while(Date.now()<deadline){
      for(const leaf of this.app.workspace.getLeavesOfType('pdf').filter(l=>l.view.file?.path===file.path)){
      const child=leaf.view.viewer?.child,document=child?.pdfViewer?.pdfDocument;
      if(document){
        let loaded=this.pdfLoadedHashes.get(document);
        if(!loaded){loaded=document.getData().then(digest);this.pdfLoadedHashes.set(document,loaded);}
        let hash;try{hash=await loaded;}catch{this.pdfLoadedHashes.delete(document);}
        const page=child.pdfViewer.pdfViewer.getPageView(pageNumber-1),layer=page?.annotationLayer?.annotationLayer;
        if(hash===expected&&child.pdfViewer.pdfDocument===document&&page?.div?.dataset.loaded&&layer?.getAnnotation){
          if(!layer.getAnnotation(annotation)){new Notice('This highlight is no longer in the PDF; opened its page.');return;}
          // Reopening the same annotation URL can replace the layer we just
          // checked. Focus the live mark directly, without another file load.
          this.app.workspace.setActiveLeaf(leaf,{focus:true});child.highlightAnnotation(pageNumber,annotation);return;
        }
      }
      }
      await new Promise(resolve=>setTimeout(resolve,60));
    }
    throw new Error('The PDF is still reloading. Try opening the original passage again.');
  }
  button(el,text,fn,primary=false){const b=el.createEl('button',{text,cls:'research-button'+(primary?' mod-cta':''),attr:{type:'button'}});b.addEventListener('click',()=>this.run(fn));return b;}
  actionMenu(el,items,label='More annotation actions'){return (this.actionMenus ||= new ActionMenus(this)).create(el,items,label);}
  reviewMenuItems(file,{search=true}={}){
    const m=this.fields(file),entry=this.searchReview.entry(file.path),items=[];
    if(m.type!=='research-result'||m.selection==='accepted')items.push({title:entry?.pinned?'Unpin from review':'Pin for review',icon:'pin',action:()=>this.searchReview.togglePin(file)});
    items.push({title:'Review settings',icon:'sliders-horizontal',action:()=>this.searchReview.openSettings(file)});
    const sheet=this.projectReview?.action(file);if(sheet)items.push(sheet);
    if(search)items.push({title:'Search and review',icon:'search',action:()=>this.searchReview.open()});return items;
  }
  pageToolbar(el,{context='',primary,secondary=[],navigation=[],menu=[],label='More page actions'}){
    if(context)el.createEl('p',{text:context,cls:'research-meta research-note-context'});
    const actions=el.createDiv({cls:'research-actions research-page-primary'});
    if(primary)this.button(actions,primary.title,primary.action,true);for(const item of secondary)this.button(actions,item.title,item.action);if(menu.length)this.actionMenu(actions,menu,label);
    if(navigation.length){const nav=el.createDiv({cls:'research-actions research-page-navigation'});for(const item of navigation)this.button(nav,item.title,item.action);}return actions;
  }
  async update(file,fields){await this.app.fileManager.processFrontMatter(file,f=>Object.assign(f,fields));}
  async copyBibtex(path){
    const f=this.referenceFor(path);if(!f)throw new Error('Open a paper reference or linked result first.');
    const bib=await this.bibtexFor(f);
    await navigator.clipboard.writeText(bib);new Notice('BibTeX copied.');
  }
  referenceFor(path){const f=this.app.vault.getAbstractFileByPath(path || '');if(!f||f.extension!=='md')return null;if(f.path.startsWith('References/'))return f;const meta=this.fields(f),linked=meta.reference?this.app.vault.getAbstractFileByPath(meta.reference):null;return linked?.extension==='md'&&linked.path.startsWith('References/')?linked:meta.source_pdf?this.references().find(r=>this.paperInfo(r).path===meta.source_pdf)||null:null;}
  async bibtexFor(file){
    const raw=await this.app.vault.read(file),canonical=parseYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'')||{};if(canonical.bibliography_version===1)return this.paperImport.bibtexForRecord(canonical);const cached=bibtexBlock(raw);if(cached)return cached;
    throw new Error('Update this paper’s bibliography before exporting its citation.');
  }
  async copyCitation(path){const f=this.referenceFor(path);const key=this.fields(f).citekey || this.fields(f).id;if(!key)throw new Error('No saved citation key.');await navigator.clipboard.writeText(`\\cite{${key}}`);new Notice('Citation command copied.');}
  async exportBibtex(project=this.projects.context(this.app.workspace.getActiveFile())){
    const byKey=new Map();
    for(const f of this.references()){
      if(!this.projects.contains(f,project))continue;
      if(this.fields(f).record_kind==='draft')continue;
      const bib=await this.bibtexFor(f);
      for(const entry of CitationAliases.entriesFor(bib,this.fields(f).citation_aliases || [])){
        if(byKey.has(entry.key)&&byKey.get(entry.key)!==entry.bib)throw new Error(`Conflicting entries share citation key ${entry.key}. Fix them before exporting.`);
        byKey.set(entry.key,entry.bib);
      }
    }
    if(!byKey.size)throw new Error('No saved entries for this project.');
    const title=this.projects.all().find(p=>p.id===project)?.title || 'All papers',path='Exports/'+slug(title)+'.bib',text=[...byKey.values()].join('\n\n')+'\n';
    if(!this.app.vault.getAbstractFileByPath('Exports'))await this.app.vault.createFolder('Exports');
    const f=this.app.vault.getAbstractFileByPath(path);if(f)await this.app.vault.modify(f,text);else await this.app.vault.create(path,text);
    new Notice(`Exported ${byKey.size} citation${byKey.size===1?'':'s'} to ${path}.`);return text;
  }
  renderAnnotationGroups(el,notes,collapsed=false,showLinks=true){
    const groups=this.annotationWorkflow.groups(notes);
    if(!groups.length){el.createEl('p',{text:'No annotation notes yet.'});return;}
    for(const group of groups){
      let container=el;
      const label=`${group.title}${group.edition?' · '+group.edition:''} · ${group.notes.length} ${group.notes.length===1?'comment':'comments'}`;
      if(collapsed){container=el.createEl('details',{cls:'research-paper-comments'});container.createEl('summary',{text:label});}
      else if(groups.length>1)container.createEl('h3',{text:label});
      const actions=showLinks?container.createDiv({cls:'research-actions research-row-actions'}):null;
      if(actions&&group.file)this.button(actions,'Open paper comments',()=>this.annotationWorkflow.openPaperIndex(group.file,group.version));
      if(actions&&group.reference)this.button(actions,'Paper details',()=>this.open(group.reference.path));
      if(groups.some(other=>other!==group&&other.title===group.title&&other.pdf!==group.pdf))container.createEl('p',{text:group.pdf,cls:'research-meta'});
      const list=container.createEl('ol');
      for(const file of group.notes){const m=this.fields(file),item=list.createEl('li');this.button(item,`${m.annotation_title || file.basename} · p${m.source_page}`,()=>this.open(file.path));if(this.pdfAnnotations.data.annotationLinks[file.path]?.status==='detached')item.createSpan({text:' · recovered text; highlight deleted',cls:'research-meta'});}
    }
  }
  renderStats(el,items){
    const stats=el.createDiv({cls:'research-stats'});
    for(const [number,label]of items){const stat=stats.createDiv({cls:'research-stat'});stat.createSpan({text:String(number),cls:'research-stat-number'});stat.createSpan({text:label,cls:'research-stat-label'});}
  }
  renderPaperCards(el,refs,options={}){
    el.empty();
    const query=options.query??this.librarySearch??'',kind=options.kind??this.libraryKind??'*',collection=options.collection??this.libraryCollection??'*';
    const visible=refs.filter(f=>{const m=this.fields(f),draft=m.record_kind==='draft',group=m.collection || 'Unsorted';return (kind==='*'||(kind==='draft')===draft)&&(collection==='*'||group===collection)&&SearchReview.paperMatches(m,query);}).sort((a,b)=>String(this.fields(a).title || a.basename).localeCompare(String(this.fields(b).title || b.basename),undefined,{numeric:true}));
    el.createEl('p',{text:visible.length===refs.length?`${visible.length} ${visible.length===1?'source':'sources'}`:`Showing ${visible.length} of ${refs.length} sources`,cls:'research-meta'});
    if(!visible.length)el.createEl('p',{text:refs.length?'No papers match these filters.':'No papers in this project yet.',cls:'research-meta'});
    for(const f of visible){
      const m=this.fields(f),draft=m.record_kind==='draft',paper=this.paperInfo(f),card=el.createDiv({cls:'research-card research-source-row'});card.dataset.researchPath=f.path;
      card.createEl('p',{text:[draft?'Your draft':'Reading source',m.year,m.collection].filter(Boolean).join(' · '),cls:'research-meta'});
      const heading=card.createEl('h3');this.button(heading,m.title || f.basename,()=>this.open(f.path)).addClass('research-title-link');
      const authors=SearchReview.authorNames(m.author).join(', ');if(authors)card.createEl('p',{text:authors,cls:'research-authors'});
      card.createEl('p',{text:[m.pdf_version || 'Saved PDF',m.reading_status || 'unread',draft?'Local processing only':null].filter(Boolean).join(' · '),cls:'research-meta'});
      const row=card.createDiv({cls:'research-actions research-row-actions'});
      if(paper.path){this.button(row,draft?'Read draft':'Read PDF',()=>this.openPdf(paper.path,f.path));const notes=this.annotationWorkflow.paperNotes(paper.path,m.source_sha256);this.button(row,`Comments (${notes.length})`,()=>this.annotationWorkflow.openPaperIndex(paper.file,m.source_sha256));}
      this.actionMenu(row,[{title:draft?'Draft notes':'Paper notes',icon:'file-text',action:()=>this.open(f.path)},{title:'Projects',icon:'folder',action:()=>this.projects.paperModal(f)},{title:'Copy BibTeX',icon:'quote',action:()=>this.copyBibtex(f.path)}],`More actions for ${m.title || f.basename} — ${m.pdf_version || 'Saved PDF'}`);
    }
  }
  renderProjectOverview(el,project){
    el.addClass('research-dashboard');const refs=this.references().filter(f=>this.projects.contains(f,project)),drafts=refs.filter(f=>this.fields(f).record_kind==='draft').length;
    el.createEl('p',{text:`${refs.length} sources · ${this.annotationWorkflow.annotations().filter(f=>this.projects.annotationContains(f,project)).length} comments`,cls:'research-meta research-note-context'});
    const actions=el.createDiv({cls:'research-actions research-page-primary'});this.button(actions,'Save a result',()=>new ResultModal(this,{project_id:project}).open(),true);
    this.button(actions,'Show papers',async()=>{this.librarySearch='';this.libraryKind='*';this.libraryCollection='*';await this.projects.select(project);await this.open('Home.md');});
    this.actionMenu(actions,[{title:'Export citations',icon:'quote',action:()=>this.citations.open({project})},{title:'New project',icon:'folder-plus',action:()=>this.projects.newModal()}],'More project actions');
    const nav=el.createDiv({cls:'research-actions research-page-navigation'});this.button(nav,'Review sheet',()=>this.projectReview.open(project));this.button(nav,'Definitions and results',()=>this.searchReview.open({view:'definitions',project}));this.button(nav,'Pinned for review',()=>this.searchReview.open({view:'pinned',project}));this.button(nav,'Open questions',()=>this.searchReview.open({view:'questions',project}));this.button(nav,'Review inbox',async()=>{await this.projects.select(project);await this.open('Inbox/Review inbox.md');});
    this.renderStats(el,[[refs.length-drafts,'reading sources'],[drafts,'your drafts'],[this.results(project).filter(f=>this.fields(f).selection==='accepted').length,'saved results']]);
  }
  async renderProjectResults(el,project,component,inbox=false){
    const selected=this.results(project).filter(f=>this.fields(f).selection===(inbox?'suggested':'accepted'));
    if(!selected.length)el.createEl('p',{text:inbox?'No pending reference suggestions.':'No saved results yet. Save a result or check the review inbox.',cls:'research-meta'});
    for(const f of selected){
      const m=this.fields(f),card=el.createDiv({cls:'research-card research-result-row'});card.dataset.researchPath=f.path;
      card.createEl('p',{text:(m.kind || 'result')+' · '+ResultStatus.summary(m),cls:'research-meta research-result-status'});
      const heading=card.createEl('h3');this.button(heading,m.title || f.basename,()=>this.open(f.path)).addClass('research-title-link');const passage=statement(await this.app.vault.read(f));if(passage)await MarkdownRenderer.render(this.app,passage,card.createDiv({cls:'research-statement'}),f.path,component);
      const buttons=card.createDiv({cls:'research-actions research-row-actions'});this.button(buttons,'Open and edit',()=>this.open(f.path));this.button(buttons,'Source passage',()=>this.openPdf(m.source_link,f.path));if(inbox){this.button(buttons,'Accept for reference',()=>this.update(f,{selection:'accepted'}));this.button(buttons,'Dismiss',()=>this.update(f,{selection:'dismissed'}));}
    }
  }
  async render(mode,el,sourcePath,component){
    el.empty();el.addClass('research-shell');
    if(mode==='search-review'){await this.searchReview.render(el,component);return;}
    const actions=el.createDiv({cls:'research-actions'}),refs=this.references(),current=this.app.vault.getAbstractFileByPath(sourcePath),meta=this.fields(current);
    if(['paper','paper-annotations','annotation','result','project','project-overview','project-results','project-papers','project-comments','project-review','project-review-overview','project-review-items','project-review-questions','question-status','citation-list'].includes(mode)&&current?.extension!=='md'){actions.remove();return;}
    if(['project-review','project-review-overview','project-review-items','project-review-questions'].includes(mode)){actions.remove();await this.projectReview.render(el,current,component,mode==='project-review'?'all':mode.slice('project-review-'.length));return;}
    if(mode==='question-status'){actions.remove();await this.searchReview.renderQuestionState(el,current);return;}
    if(mode==='citation-list'){actions.remove();await this.citations.render(el,current);return;}
    if(mode==='home'){
      el.addClass('research-dashboard');actions.addClass('research-page-primary');
      const filter=el.createDiv({cls:'research-page-context'});filter.createEl('label',{text:'Project'});const select=filter.createEl('select',{attr:{'aria-label':'Library project'}});select.createEl('option',{text:'All projects',value:'*'});for(const p of this.projects.all())select.createEl('option',{text:p.title,value:p.id});select.value=this.projects.active();select.addEventListener('change',()=>this.run(async()=>{await this.projects.select(select.value);await this.render(mode,el,sourcePath,component);}));el.insertBefore(filter,actions);
      const project=this.projects.active(),visibleRefs=refs.filter(f=>this.projects.contains(f,project)),annotations=this.annotationWorkflow.annotations().filter(f=>this.projects.annotationContains(f,project)),drafts=visibleRefs.filter(f=>this.fields(f).record_kind==='draft').length;
      const projectNote=this.projects.all().find(p=>p.id===project);if(projectNote)this.button(filter,'Open project',()=>this.open(projectNote.path));
      this.button(actions,'Add paper',()=>this.paperImport.open(),true);this.button(actions,'Search and review',()=>this.searchReview.open({view:'all',target:'all',project:'*'}));
      this.actionMenu(actions,[{title:'New project',icon:'folder-plus',action:()=>this.projects.newModal()},{title:'Review new PDFs',icon:'inbox',action:()=>this.paperImport.openInbox()},{title:'Import PDF annotations',icon:'highlighter',action:()=>new PdfModal(this).open()},{title:'Export citations',icon:'quote',action:()=>this.citations.open({project})},{separator:true},{title:'AI transcription settings',icon:'scan-text',action:()=>this.transcription.settings()},{title:'Preview naming changes',icon:'text-cursor-input',action:()=>this.naming.preview()},{separator:true},{title:'Back up library',icon:'archive',action:()=>this.maintenance.backup()},{title:'Files and sync',icon:'folder-sync',action:()=>this.maintenance.showStatus()}],'More library actions');
      const navigation=el.createDiv({cls:'research-actions research-page-navigation'});this.button(navigation,'Browse comments',()=>this.annotationWorkflow.openLibrary());this.button(navigation,'Review sheet',()=>this.projectReview.open(project));this.button(navigation,'Pinned for review',()=>this.searchReview.open({view:'pinned',project}));this.button(navigation,'Open questions',()=>this.searchReview.open({view:'questions',project}));this.button(navigation,'Save a result',()=>new ResultModal(this).open());
      this.renderStats(el,[[visibleRefs.length-drafts,'reading sources'],[drafts,'your drafts'],[annotations.length,'comments'],[this.results(project).filter(f=>this.fields(f).selection==='suggested').length,'results to review']]);
      const filters=el.createDiv({cls:'research-library-filters'}),field=(label,tag,attrs)=>{const wrapper=filters.createDiv();wrapper.createEl('label',{text:label});return wrapper.createEl(tag,{attr:attrs});},search=field('Find papers','input',{type:'search',placeholder:'Title, author or filename','aria-label':'Find library items'}),kind=field('Document type','select',{'aria-label':'Document type'}),collection=field('Collection','select',{'aria-label':'Source collection'});
      for(const [value,label]of [['*','All items'],['reading','Reading sources'],['draft','Your drafts']])kind.createEl('option',{value,text:label});collection.createEl('option',{value:'*',text:'All collections'});for(const name of [...new Set(visibleRefs.map(f=>this.fields(f).collection || 'Unsorted'))].sort())collection.createEl('option',{value:name,text:name});search.value=this.librarySearch || '';kind.value=this.libraryKind || '*';collection.value=this.libraryCollection || '*';if(!collection.value){this.libraryCollection='*';collection.value='*';}
      const cards=el.createDiv({cls:'research-paper-list'}),refresh=()=>this.renderPaperCards(cards,visibleRefs);search.addEventListener('input',()=>{this.librarySearch=search.value;refresh();});kind.addEventListener('change',()=>{this.libraryKind=kind.value;refresh();});collection.addEventListener('change',()=>{this.libraryCollection=collection.value;refresh();});refresh();return;
    }
    if(mode==='paper'){
      actions.remove();const paper=this.paperInfo(current),context=[meta.pdf_version || 'Saved PDF',meta.metadata_status==='checked'?(meta.bibliography_coverage==='partial'?'Reviewed · citation details incomplete':'Metadata reviewed'):'Metadata needs review',meta.local_processing_only?'Local processing only':null].filter(Boolean).join(' · '),menu=[{title:'Update bibliography',icon:'search',action:()=>this.paperImport.edit(current)},{title:'Projects',icon:'folder',action:()=>this.projects.paperModal(current)},{title:'Copy BibTeX',icon:'quote',action:()=>this.copyBibtex(current.path)},{title:'Copy citation',icon:'copy',action:()=>this.copyCitation(current.path)},{title:'Add to citation list',icon:'list-plus',action:()=>this.citations.add(current)},{separator:true},...this.reviewMenuItems(current),{separator:true},{title:meta.metadata_status==='checked'?'Mark metadata unchecked':'I checked the metadata',icon:'check',action:()=>this.update(current,{metadata_status:meta.metadata_status==='checked'?'needs-review':'checked'})}];
      this.pageToolbar(el,{context,primary:paper.path?{title:meta.record_kind==='draft'?'Read draft':'Read PDF',action:()=>this.openPdf(paper.path,current.path)}:null,secondary:paper.file?[{title:'All paper comments',action:()=>this.annotationWorkflow.openPaperIndex(paper.file,meta.source_sha256)}]:[],menu,label:'More paper actions'});return;
    }
    if(mode==='paper-annotations'){
      actions.remove();const paper=this.paperInfo(current),reference=this.referenceFor(current.path),r=this.fields(reference),notes=this.annotationWorkflow.paperNotes(paper.path,meta.source_sha256);if(meta.type!=='paper-annotation-index'){el.createEl('p',{text:notes.length+' comments · PDF page order',cls:'research-meta'});this.renderAnnotationGroups(el,notes);return;}this.pageToolbar(el,{context:[r.title,r.pdf_version,`${notes.length} comments`].filter(Boolean).join(' · '),primary:paper.path?{title:'Read PDF',action:()=>this.openPdf(paper.path,current.path)}:null,navigation:[{title:'Browse all papers',action:()=>this.annotationWorkflow.openLibrary()},...(reference?[{title:'Paper details',action:()=>this.open(reference.path)}]:[])]});this.renderAnnotationGroups(el,notes,false,false);
      return;
    }
    if(mode==='annotation-library'){
      actions.remove();const notes=this.annotationWorkflow.annotations();this.pageToolbar(el,{context:`${this.annotationWorkflow.groups(notes).length} paper versions · ${notes.length} comments`,primary:{title:'Search comments',action:()=>this.searchReview.open({view:'all',target:'notes',scope:'annotation',project:'*'})},navigation:[{title:'Home',action:()=>this.open('Home.md')}]});this.renderAnnotationGroups(el,notes,true);
      return;
    }
    if(mode==='project-list'){
      actions.addClass('research-page-navigation');this.button(actions,'New project',()=>this.projects.newModal());for(const project of this.projects.all()){const card=el.createDiv({cls:'research-card research-project-row'}),heading=card.createEl('h3');this.button(heading,project.title,()=>this.open(project.path)).addClass('research-title-link');card.createEl('p',{text:[this.references().filter(f=>this.projects.contains(f,project.id)).length+' sources',this.results(project.id).filter(f=>this.fields(f).selection==='accepted').length+' saved results'].join(' · '),cls:'research-meta'});}return;
    }
    if(mode==='annotation'){
      actions.remove();await this.annotationWorkflow.ensureQuestionWidget(current);this.annotationWorkflow.renderActions(el,current);await this.resultConnections.renderAnnotation(el,current);return;
    }
    if(mode==='result'){
      actions.remove();await this.annotationWorkflow.ensureQuestionWidget(current);
      ResultStatus.render(el,meta);
      this.pageToolbar(el,{primary:{title:'Write my work',action:()=>this.resultWorkflow.write(current,meta.result_layout===2?'My work':'Notes')},secondary:[{title:'Open source',action:()=>this.openPdf(meta.source_link,current.path)},...(meta.source_annotation&&this.app.vault.getAbstractFileByPath(meta.source_annotation)?[{title:'Source annotation',action:()=>this.open(meta.source_annotation)}]:[])],navigation:[{title:meta.selection==='accepted'?'Return to suggestions':'Accept for reference',action:()=>this.update(current,{selection:meta.selection==='accepted'?'suggested':'accepted'})},{title:meta.transcription_status==='checked'?'Mark transcription unchecked':'I checked the transcription',action:()=>this.update(current,{transcription_status:meta.transcription_status==='checked'?'unchecked':'checked'})}],menu:[{title:meta.result_usage==='adaptation'?'Continue adaptation':'Adapt this result',icon:'file-plus',action:()=>this.resultWorkflow.adapt(current)},{title:'Write question',icon:'message-square',action:()=>this.annotationWorkflow.writeQuestion(current)},{title:'Connect results',icon:'link',action:()=>this.resultConnections.open(current)},{title:'Copy citation',icon:'copy',action:()=>this.copyCitation(current.path)},{title:'Add to citation list',icon:'list-plus',action:()=>this.citations.add(current)},...this.reviewMenuItems(current)],label:'More result actions'});await this.resultConnections.render(el,current);return;
    }
    if(['project-overview','project-results','project-papers','project-comments'].includes(mode)){
      actions.remove();const project=this.projects.context(current);
      if(mode==='project-overview')this.renderProjectOverview(el,project);
      if(mode==='project-results')await this.renderProjectResults(el,project,component);
      if(mode==='project-papers')this.renderPaperCards(el,refs.filter(f=>this.projects.contains(f,project)),{query:'',kind:'*',collection:'*'});
      if(mode==='project-comments')this.renderAnnotationGroups(el,this.annotationWorkflow.annotations().filter(f=>this.projects.annotationContains(f,project)),true);
      return;
    }
    if(mode==='inbox'){
      actions.remove();const project=this.projects.active(),selected=this.results(project).filter(f=>this.fields(f).selection==='suggested'),name=this.projects.all().find(p=>p.id===project)?.title || 'All projects';this.pageToolbar(el,{context:`${selected.length} suggestions · ${name}`,primary:selected.length?{title:'Review next',action:()=>this.open(selected[0].path)}:{title:'Search and review',action:()=>this.searchReview.open({view:'needs-review',project})},navigation:[{title:'Search suggestions',action:()=>this.searchReview.open({view:'needs-review',project})},{title:'Definitions and results',action:()=>this.searchReview.open({view:'definitions',project})},{title:'Home',action:()=>this.open('Home.md')}]});await this.renderProjectResults(el,project,component,true);return;
    }
    if(mode==='project'){
      actions.remove();const project=this.projects.context(current);this.renderProjectOverview(el,project);
      el.createEl('h2',{text:mode==='inbox'?'Suggestions to review':'Saved results'});await this.renderProjectResults(el,project,component,mode==='inbox');
      el.createEl('h2',{text:'Papers'});this.renderPaperCards(el,refs.filter(f=>this.projects.contains(f,project)),{query:'',kind:'*',collection:'*'});
      el.createEl('h2',{text:'Comments'});this.renderAnnotationGroups(el,this.annotationWorkflow.annotations().filter(f=>this.projects.annotationContains(f,project)),true);
    }
  }
  async importAnnotations(file,options={}){
    await loadPdfJs();
    await this.pdfAnnotations.deletions.reconcile(file);
    const version=await this.pdfAnnotations.versionFor(file),data=await this.app.vault.readBinary(file);
    const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(data),cMapPacked:true,cMapUrl:'/lib/pdfjs/cmaps/',standardFontDataUrl:'/lib/pdfjs/standard_fonts/'}).promise;
    let count=0,skipped=0;
    try{
      const numbers=options.pages?[...new Set(options.pages)].filter(n=>Number.isInteger(n)&&n>=1&&n<=pdf.numPages):Array.from({length:pdf.numPages},(_,i)=>i+1);
      for(const n of numbers){
        const page=await pdf.getPage(n),annotations=(await page.getAnnotations()).filter(a=>['Highlight','Text','FreeText','Underline','StrikeOut','Squiggly'].includes(a.subtype));
        if(!annotations.length){page.cleanup();continue;}const text=await page.getTextContent();
        for(const a of annotations){
          const existing=this.annotationWorkflow.annotations().some(f=>{const m=this.fields(f);return m.source_pdf===file.path&&m.source_sha256===version&&m.annotation_id===a.id;});
          if(existing){skipped++;continue;}
          const bounds=a.rect,overlap=item=>{const x=item.transform?.[4],y=item.transform?.[5],height=item.height||10;return typeof x==='number'&&x<bounds[2]&&x+(item.width||0)>bounds[0]&&y<bounds[3]&&y+height>bounds[1];};
          const snippet=text.items.filter(overlap).map(i=>i.str).join(' ').trim();
          if(await this.annotationWorkflow.importAnnotation(file,version,n,a,page,snippet))count++;else skipped++;
        }
        page.cleanup();
      }
    }finally{await pdf.destroy();}
    if(!options.quiet)new Notice(`Imported ${count} annotations; skipped ${skipped} already present.`,6000);return {imported:count,skipped};
  }
};
