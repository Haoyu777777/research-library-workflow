const {Modal,Setting,Notice,setIcon,loadPdfJs,normalizePath,parseYaml}=require('obsidian');
const NamingRules=require('./naming-rules');
const QuestionLayout=require('./question-status');
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
const safe=text=>String(text).replace(/[\\/:*?"<>|#\[\]]/g,' ').replace(/\s+/g,' ').trim().slice(0,115);
const fm=fields=>'---\n'+Object.entries(fields).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n\n';
const short=text=>{const s=text.replace(/\s+/g,' ').trim();return s.length>75?s.slice(0,72).replace(/\s+\S*$/,'')+'…':s;};

class TitleModal extends Modal {
  constructor(flow,file){super(flow.app);this.flow=flow;this.file=file;}
  onOpen(){this.modalEl.addClass('research-dialog');
    this.contentEl.createEl('h2',{text:'Name this annotation'});
    let title=this.flow.plugin.fields(this.file).annotation_title || this.file.basename;
    const input=new Setting(this.contentEl).setName('Title').addText(c=>{c.setValue(title).onChange(v=>title=v);c.inputEl.style.width='100%';setTimeout(()=>c.inputEl.focus(),0);});
    input.controlEl.style.width='70%';
    new Setting(this.contentEl).addButton(c=>c.setButtonText('Rename note').setCta().onClick(()=>this.flow.plugin.run(async()=>{
      if(!safe(title))throw new Error('Enter a descriptive title.');await this.flow.rename(this.file,title.trim());this.close();
    })));
  }
  onClose(){this.contentEl.empty();}
}

module.exports=class AnnotationWorkflow {
  constructor(plugin){this.plugin=plugin;this.app=plugin.app;this.buttons=new Set();this.inFlight=null;this.created=new Map();}
  onload(){
    this.plugin.pdfAnnotations.data.annotationPaperFolders ||= {};
    this.plugin.addCommand({id:'browse-annotations',name:'Browse comments by paper',callback:()=>this.plugin.run(()=>this.openLibrary())});
    this.plugin.addCommand({id:'organize-annotations',name:'Organize annotation notes by paper',callback:()=>this.plugin.run(()=>this.organizeAll())});
    this.plugin.addCommand({id:'comment-on-pdf-selection',name:'Comment on selected PDF passage',hotkeys:[{modifiers:['Mod','Shift'],key:'m'}],callback:()=>this.plugin.run(()=>this.capture())});
    this.plugin.addCommand({id:'delete-annotation',name:'Delete current annotation and PDF highlight',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!this.isAnnotation(f))return false;if(!checking)this.plugin.run(()=>this.plugin.pdfAnnotations.deletions.requestDeleteNote(f));return true;}});
    this.plugin.addCommand({id:'rename-annotation',name:'Rename current annotation',checkCallback:checking=>{const f=this.app.workspace.getActiveFile();if(!this.isAnnotation(f))return false;if(!checking)new TitleModal(this,f).open();return true;}});
    this.plugin.registerEvent(this.app.workspace.on('pdf-menu',(menu,data)=>{
      const selected=this.readSelection();
      const annotation=this.fromAnnotationMenu(menu,data);
      // A native right-click can select the word under an existing highlight.
      // The clicked annotation takes precedence over that incidental selection.
      const snapshot=annotation || (selected&&selected.page===data.pageNumber&&selected.file.path===menu.child?.file?.path?selected:null);
      if(!snapshot)return;
      menu.addSeparator();menu.addItem(item=>item.setTitle('Add research comment').setIcon('message-square-plus').onClick(()=>this.plugin.run(()=>this.capture(snapshot))));
    }));
    this.plugin.registerDomEvent(document,'click',event=>this.onPdfClick(event),true);
    this.plugin.registerDomEvent(document,'selectionchange',()=>{const selected=this.readSelection();if(selected)this.lastSelection={...selected,at:Date.now()};});
    const schedule=()=>{if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.attachToolbars();});};
    this.plugin.registerEvent(this.app.workspace.on('layout-change',schedule));
    this.plugin.registerEvent(this.app.workspace.on('active-leaf-change',schedule));
    this.plugin.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{for(const [key,path] of this.created)if(path===oldPath)this.created.set(key,file.path);}));
    const observer=new MutationObserver(records=>{if(records.some(r=>[...r.addedNodes].some(n=>n.nodeType===1&&(n.matches?.('.pdf-toolbar,.pdf-toolbar-right')||n.querySelector?.('.pdf-toolbar')))))schedule();});
    observer.observe(document.body,{childList:true,subtree:true});
    this.plugin.register(()=>{observer.disconnect();if(this.frame)cancelAnimationFrame(this.frame);for(const b of this.buttons)b.remove();});
    this.app.workspace.onLayoutReady(schedule);
    this.app.workspace.onLayoutReady(()=>{this.organizationReady=this.plugin.run(async()=>{await this.plugin.pdfAnnotations.deletions.ready;await this.plugin.projectReady;await this.organizeAll();});});
  }
  isAnnotation(file){return ['imported-annotation','research-annotation'].includes(this.plugin.fields(file).type);}
  annotations(){return this.app.vault.getMarkdownFiles().filter(f=>this.isAnnotation(f));}
  sorted(notes){
    const number=(value,fallback)=>Number.isFinite(Number(value))&&value!==null?Number(value):fallback;
    return [...notes].sort((a,b)=>{
      const x=this.plugin.fields(a),y=this.plugin.fields(b),page=number(x.source_page,Infinity)-number(y.source_page,Infinity);
      if(page)return page;
      const top=m=>Array.isArray(m.source_quad_rects)&&m.source_quad_rects.length?Math.max(...m.source_quad_rects.map(r=>r[3])):number(m.annotation_rect?.[3],-Infinity);
      const position=top(y)-top(x);if(position&&!Number.isNaN(position))return position;
      const left=number(x.annotation_rect?.[0],Infinity)-number(y.annotation_rect?.[0],Infinity);if(left&&!Number.isNaN(left))return left;
      return String(x.annotation_title || a.basename).localeCompare(String(y.annotation_title || b.basename),undefined,{numeric:true}) || a.path.localeCompare(b.path);
    });
  }
  paperNotes(pdf,version){return this.sorted(this.annotations().filter(f=>{const m=this.plugin.fields(f);return m.source_pdf===pdf&&(!version||m.source_sha256===version);}));}
  groups(notes=this.annotations()){
    const groups=new Map();for(const note of notes){const m=this.plugin.fields(note),key=JSON.stringify([m.source_pdf,m.source_sha256]);if(!groups.has(key)){
      const file=this.app.vault.getAbstractFileByPath(m.source_pdf),reference=this.plugin.references().find(f=>this.plugin.paperInfo(f).path===m.source_pdf),r=this.plugin.fields(reference);
      groups.set(key,{pdf:m.source_pdf,version:m.source_sha256,file,reference,title:r.title || file?.basename || m.source_pdf,edition:r.source_sha256===m.source_sha256?r.pdf_version:null,notes:[]});
    }groups.get(key).notes.push(note);}
    return [...groups.values()].sort((a,b)=>String(a.title).localeCompare(String(b.title),undefined,{numeric:true}) || a.pdf.localeCompare(b.pdf) || String(a.version).localeCompare(String(b.version))).map(group=>{
      const versions=Object.values(this.plugin.pdfAnnotations.data.annotationPaperFolders || {}).filter(entry=>entry.pdf===group.pdf).map(entry=>entry.version);
      const multiple=[...groups.values()].filter(entry=>entry.pdf===group.pdf).length>1;
      return {...group,edition:group.edition || (multiple?`Saved PDF version ${Math.max(0,versions.indexOf(group.version))+1}`:null),notes:this.sorted(group.notes)};
    });
  }
  async paperFolder(file,version){
    const task=async()=>{
      const registry=this.plugin.pdfAnnotations.data.annotationPaperFolders;
      let folder=Object.keys(registry).find(path=>registry[path].pdf===file.path&&registry[path].version===version);
      if(!folder){
        const base=`Annotations/${NamingRules.safe(file.basename,220)}`;folder=base;let n=2;
        while(registry[folder]||this.app.vault.getAbstractFileByPath(folder))folder=`${base} (${n++})`;
        registry[folder]={pdf:file.path,version};await this.plugin.pdfAnnotations.deletions.save();
      }
      if(!this.app.vault.getAbstractFileByPath('Annotations'))await this.app.vault.createFolder('Annotations');
      if(!this.app.vault.getAbstractFileByPath(folder))await this.app.vault.createFolder(folder);
      const index=`${folder}/_Comments.md`,existing=this.app.vault.getAbstractFileByPath(index);
      if(!existing){
        await this.app.vault.create(index,fm({type:'paper-annotation-index',source_pdf:file.path,source_sha256:version})+`# Paper comments\n\nComments are listed in PDF page order, then from top to bottom on each page.\n\n\`\`\`research-library\npaper-annotations\n\`\`\`\n`);
      }else if(this.plugin.fields(existing).type&&this.plugin.fields(existing).type!=='paper-annotation-index')throw new Error('The paper comments index name is already used by another note.');
      return folder;
    };
    this.folderQueue=(this.folderQueue || Promise.resolve()).catch(()=>{}).then(task);return this.folderQueue;
  }
  async openPaperIndex(file,version){
    const folder=await this.paperFolder(file,version || await this.plugin.pdfAnnotations.versionFor(file));return this.openIndex(`${folder}/_Comments.md`);
  }
  async openIndex(path){
    const leaf=await this.plugin.open(path);
    if(leaf.view.getMode?.()!=='preview')await leaf.setViewState({type:'markdown',state:{file:path,mode:'preview'}});
    return leaf;
  }
  async openLibrary(){
    const path='Annotations/All paper comments.md';
    if(!this.app.vault.getAbstractFileByPath(path)){
      if(!this.app.vault.getAbstractFileByPath('Annotations'))await this.app.vault.createFolder('Annotations');
      await this.app.vault.create(path,fm({type:'annotation-catalog'})+'# Comments by paper\n\n```research-library\nannotation-library\n```\n');
    }
    return this.openIndex(path);
  }
  async organizeNote(file){
    // Newly restored files can precede metadata-cache updates. Read their saved
    // frontmatter so Undo also restores notes directly into the right folder.
    const raw=await this.app.vault.read(file),m=parseYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || '') || {};
    if(!['research-annotation','imported-annotation'].includes(m.type)||!m.source_sha256)return;
    const pdf=this.app.vault.getAbstractFileByPath(m.source_pdf);if(!pdf)return;
    const registered=Object.keys(this.plugin.pdfAnnotations.data.annotationPaperFolders || {}).find(path=>path===file.parent?.path&&(this.plugin.pdfAnnotations.data.annotationPaperFolders[path].pdf===pdf.path)&&(this.plugin.pdfAnnotations.data.annotationPaperFolders[path].version===m.source_sha256));
    if(registered&&/^p\d{4} - /.test(file.basename))return file;
    await this.plugin.pdfAnnotations.deletions.flushNote(file);
    const path=await this.uniquePath(pdf,m.annotation_title || file.basename,m.source_page,file.path,m.source_sha256);
    if(path!==file.path)await this.app.fileManager.renameFile(file,path);
    return file;
  }
  async organizeAll(){
    for(const file of this.sorted(this.annotations()))await this.organizeNote(file);
    await this.plugin.pdfAnnotations.deletions.idle();
    await this.plugin.naming?.cleanupEmptyAnnotationFolders?.();
  }
  author(file){
    const reference=this.plugin.references().find(f=>this.plugin.paperInfo(f).path===file.path),m=this.plugin.fields(reference);
    const first=m.author?.[0];return safe(first?.family || first?.literal || file.basename.split(' - ')[0]) || 'Paper';
  }
  title(comment,text,page){
    const first=comment?.split(/\r?\n/).find(x=>x.trim());
    const heading=text?.normalize('NFKC').match(/\b(Definition|Lemma|Theorem|Corollary|Proposition|Remark)\s+([\d.A-Za-z′'’-]+)/i);
    if(first)return short(first);
    if(heading)return `${heading[1]} ${heading[2].replace(/\.+$/,'')}`;
    return NamingRules.annotationTitle({annotation_title:short(text || `Notes on page ${page}`)});
  }
  kind(text){return text?.normalize('NFKC').match(/^\s*(Definition|Lemma|Theorem|Corollary|Proposition)\b/i)?.[1]?.toLowerCase() || 'comment';}
  async uniquePath(file,title,page,ignore,version,userTitle=false){
    const folder=await this.paperFolder(file,version || await this.plugin.pdfAnnotations.versionFor(file));
    const base=`${folder}/${NamingRules.annotation({annotation_title:title,source_page:page,...(userTitle?{annotation_title_source:'user'}:{})})}`;
    let path=normalizePath(base+'.md'),n=2;
    while(this.app.vault.getAbstractFileByPath(path)&&path!==ignore)path=normalizePath(`${base} (${n++}).md`);
    return path;
  }
  editorLeaf(file){
    const workspace=this.app.workspace,pdfs=workspace.getLeavesOfType('pdf').filter(l=>l.getRoot()===workspace.rootSplit),parents=new Set(pdfs.map(l=>l.parent));
    const all=workspace.getLeavesOfType('markdown').filter(l=>l.getRoot()===workspace.rootSplit),usable=all.filter(l=>!parents.has(l.parent));
    const visible=l=>l.view.containerEl.getBoundingClientRect().width>0,filePath=l=>l.view.file?.path || l.getViewState?.().state?.file;
    const leaf=usable.find(l=>filePath(l)===file.path) || usable.find(visible) || usable[0];
    if(leaf)return leaf;
    if(pdfs.length){workspace.setActiveLeaf(pdfs.find(visible)||pdfs[0],{focus:false});return workspace.getLeaf('split','vertical');}
    return all.find(l=>filePath(l)===file.path) || all[0] || workspace.getLeaf('tab');
  }
  async openNote(file){
    await new Promise(resolve=>this.app.workspace.onLayoutReady(resolve));
    await this.ensureQuestionWidget(file);
    const leaf=this.editorLeaf(file);
    if(leaf.view.file?.path!==file.path){if(leaf.view.getViewType()==='markdown'&&typeof leaf.view.save==='function')await leaf.view.save();await leaf.openFile(file,{active:true});}
    this.app.workspace.setActiveLeaf(leaf,{focus:true});return leaf;
  }
  async ensureQuestionWidget(file,{create=false}={}){
    if(file?.extension!=='md'||this.app.vault.getAbstractFileByPath(file.path)!==file)return false;
    const allowed=m=>['research-annotation','imported-annotation','research-result'].includes(m.type),fields=raw=>parseYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]||'')||{},transform=raw=>create?QuestionLayout.addSection(raw):QuestionLayout.insert(raw).text;
    const sourceLeaf=()=>{const leaves=this.app.workspace.getLeavesOfType('markdown').filter(leaf=>leaf.view.file===file&&leaf.view.getMode?.()==='source'&&leaf.view.editor);return leaves.find(leaf=>leaf===this.app.workspace.activeLeaf)||leaves[0];};
    let inserted=false,leaf=sourceLeaf();
    if(leaf){
      // Markdown widgets can render during a CodeMirror update. Yield before
      // dispatching an editor edit, then reread the latest buffer and selection.
      await new Promise(resolve=>setTimeout(resolve,0));leaf=sourceLeaf();if(!leaf)return this.ensureQuestionWidget(file,{create});
      // Edit the current buffer synchronously so a saved-file replacement cannot
      // overwrite keystrokes typed after an asynchronous read or move the caret.
      const editor=leaf.view.editor,raw=editor.getValue();if(!allowed(fields(raw)))return false;const next=transform(raw);if(next===raw)return false;let at=0;while(at<raw.length&&raw[at]===next[at])at++;const count=next.length-raw.length;if(count<0||next.slice(0,at)+next.slice(at+count)!==raw)throw Error('Question controls could not be inserted without changing your writing.');const offset=pos=>{const lines=raw.split('\n');return lines.slice(0,pos.line).reduce((n,line)=>n+line.length+1,0)+pos.ch;},position=n=>{const lines=next.slice(0,n).split('\n');return {line:lines.length-1,ch:lines.at(-1).length};},selection=(editor.listSelections?.()||[{anchor:editor.getCursor('from'),head:editor.getCursor('to')}]).map(range=>({anchor:offset(range.anchor),head:offset(range.head)})),lines=raw.slice(0,at).split('\n');editor.replaceRange(next.slice(at,at+count),{line:lines.length-1,ch:lines.at(-1).length});const moved=selection.map(range=>({anchor:position(range.anchor>=at?range.anchor+count:range.anchor),head:position(range.head>=at?range.head+count:range.head)}));if(editor.setSelections)editor.setSelections(moved);else editor.setSelection(moved[0].anchor,moved[0].head);inserted=true;await leaf.view.save();
    }else{
      // Rendering must never save an editor that is still loading.
      const raw=await this.app.vault.read(file);if(!allowed(fields(raw))||transform(raw)===raw)return false;let defer=false;
      await this.app.vault.process(file,current=>{if(sourceLeaf()){defer=true;return current;}if(!allowed(fields(current)))return current;const next=transform(current);inserted=next!==current;return next;});if(defer)return this.ensureQuestionWidget(file,{create});
    }
    if(inserted){const saved=await this.app.vault.read(file);await this.plugin.pdfAnnotations.deletions.remember(file,fields(saved));await this.plugin.searchReview?.indexFile(file);}
    return inserted;
  }
  async writeQuestion(file){await this.ensureQuestionWidget(file,{create:true});const raw=await this.app.vault.read(file),heading=raw.match(/^#{2,6}\s+((?:Questions to check|Open questions))\s*$/mi)?.[1]||'Questions to check';const leaf=await this.openNote(file);await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});const editor=leaf.view.editor;if(editor){const lines=editor.getValue().split('\n'),start=lines.findIndex(line=>/^#{2,6}\s+/.test(line)&&line.replace(/^#{2,6}\s+/,'').trim()===heading),next=lines.findIndex((line,i)=>i>start&&/^#{1,6}\s/.test(line)),end=next<0?lines.length:next;let target=start+1;while(target<end&&!lines[target].trim())target++;if(lines[target]?.trim()==='```research-library'){target++;while(target<end&&lines[target].trim()!=='```')target++;target++;}while(target<end&&!lines[target].trim())target++;if(target>=end)target=Math.max(start+1,end-1);editor.setCursor({line:Math.max(0,target),ch:0});editor.focus();}return leaf;}
  openClickedNote(files){
    if(files.length===1){
      const request=(this.navigationRequest || 0)+1;this.navigationRequest=request;
      this.noteNavigation=(this.noteNavigation || Promise.resolve()).catch(()=>{}).then(()=>{if(request===this.navigationRequest)return this.openForWriting(files[0]);});
      return this.noteNavigation;
    }
    const modal=new Modal(this.app);modal.onOpen=()=>{modal.modalEl.addClass('research-dialog');modal.contentEl.createEl('h2',{text:'Choose an annotation'});for(const file of files){const m=this.plugin.fields(file);const b=modal.contentEl.createEl('button',{text:m.annotation_title || file.basename});b.style.display='block';b.style.marginBottom='8px';b.addEventListener('click',()=>{modal.close();this.plugin.run(()=>this.openForWriting(file));});}};modal.open();
  }
  onPdfClick(event){
    if(event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||event.detail>1)return;
    const target=event.target instanceof Element?event.target:event.target?.parentElement,page=target?.closest('.page[data-page-number]');
    if(!page||target.closest('a,button,input,textarea,.popupWrapper,.annotationEditorLayer'))return;
    const leaf=this.app.workspace.getLeavesOfType('pdf').find(l=>l.view.containerEl.contains(page));if(!leaf?.view.file)return;
    const selection=window.getSelection();if(selection&&!selection.isCollapsed&&selection.toString().trim())return;
    const number=Number(page.dataset.pageNumber),state=this.plugin.pdfAnnotations.data.pdfStates[leaf.view.file.path];
    const notes=this.annotations().filter(f=>{const m=this.plugin.fields(f);return m.source_pdf===leaf.view.file.path&&m.source_page===number&&m.source_sha256===state?.version;});
    if(!notes.length)return;
    const id=target.closest('[data-annotation-id]')?.getAttribute('data-annotation-id'),direct=notes.filter(f=>this.plugin.fields(f).annotation_id===id);
    if(direct.length){event.preventDefault();event.stopPropagation();this.plugin.run(()=>this.openClickedNote(direct));return;}
    // Highlights without a PDF popup can be painted only on the page canvas.
    // Test the actual quadrilaterals, not just their union rectangle.
    const pageView=leaf.view.viewer?.child?.pdfViewer?.pdfViewer?.getPageView(number-1);if(!pageView?.pdfPage)return;
    const bounds=page.getBoundingClientRect(),viewport=pageView.viewport;
    const point=viewport.convertToPdfPoint((event.clientX-bounds.left)*viewport.width/bounds.width,(event.clientY-bounds.top)*viewport.height/bounds.height);
    const contains=r=>r&&point[0]>=r[0]-.5&&point[0]<=r[2]+.5&&point[1]>=r[1]-.5&&point[1]<=r[3]+.5;
    if(!notes.some(f=>contains(this.plugin.fields(f).annotation_rect)))return;
    this.plugin.run(async()=>{
      const annotations=await pageView.pdfPage.getAnnotations({intent:'display'}),matches=notes.filter(f=>{
        const m=this.plugin.fields(f),annotation=annotations.find(a=>a.id===m.annotation_id);if(!annotation)return false;
        const quads=annotation.quadPoints;if(!quads?.length)return contains(annotation.rect);
        for(let i=0;i+7<quads.length;i+=8){const q=Array.from(quads.slice(i,i+8)),xs=q.filter((_,j)=>j%2===0),ys=q.filter((_,j)=>j%2===1);if(contains([Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]))return true;}
        return false;
      });
      if(matches.length)await this.openClickedNote(matches);
    });
  }
  activePdf(){
    const active=this.app.workspace.activeLeaf;
    if(active?.view?.getViewType()==='pdf')return active;
    return this.app.workspace.getLeavesOfType('pdf').find(l=>l.view.containerEl.contains(document.activeElement));
  }
  readSelection(){
    const selected=window.getSelection();if(!selected||selected.isCollapsed||!selected.toString().trim())return null;
    const anchor=selected.anchorNode?.parentElement,pageEl=anchor?.closest('.page[data-page-number]');if(!pageEl)return null;
    const leaf=this.app.workspace.getLeavesOfType('pdf').find(l=>l.view.containerEl.contains(pageEl));if(!leaf?.view.file)return null;
    const page=Number(pageEl.dataset.pageNumber),range=selected.getRangeAt(0);
    const end=(selected.focusNode?.nodeType===1?selected.focusNode:selected.focusNode?.parentElement)?.closest?.('.page[data-page-number]');
    if(!end||Number(end.dataset.pageNumber)!==page)return null;
    const child=leaf.view.viewer?.child,viewer=child?.pdfViewer?.pdfViewer,pageView=viewer?.getPageView(page-1);if(!pageView)return null;
    const selection=this.app.plugins.plugins['pdf-plus']?.lib.copyLink.getPageAndTextRangeFromSelection(selected)?.selection;
    if(!selection)return null;
    const coordinates=Array.isArray(selection)?selection:[selection.beginIndex,selection.beginOffset,selection.endIndex,selection.endOffset];
    if(!coordinates.every(Number.isFinite))return null;
    const bounds=pageEl.getBoundingClientRect(),viewport=pageView.viewport,points=[],rects=[];
    for(const r of range.getClientRects()){
      if(r.width<1||r.height<1)continue;
      const pair=[[r.left,r.top],[r.right,r.bottom]].map(([x,y])=>viewport.convertToPdfPoint((x-bounds.left)*viewport.width/bounds.width,(y-bounds.top)*viewport.height/bounds.height));
      points.push(...pair);rects.push([Math.min(pair[0][0],pair[1][0]),Math.min(pair[0][1],pair[1][1]),Math.max(pair[0][0],pair[1][0]),Math.max(pair[0][1],pair[1][1])]);
    }
    if(!points.length)return null;
    const rect=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
    const merged=[];
    for(const r of rects.sort((a,b)=>b[3]-a[3] || a[0]-b[0])){
      const line=merged.find(b=>Math.min(b[3],r[3])-Math.max(b[1],r[1])>.5*Math.min(b[3]-b[1],r[3]-r[1])&&r[0]<=b[2]+4&&r[2]>=b[0]-4);
      if(line){line[0]=Math.min(line[0],r[0]);line[1]=Math.min(line[1],r[1]);line[2]=Math.max(line[2],r[2]);line[3]=Math.max(line[3],r[3]);}else merged.push([...r]);
    }
    return {file:leaf.view.file,page,rect,rects:merged,text:selected.toString().trim(),sourceLink:`${leaf.view.file.path}#page=${page}&selection=${coordinates.join(',')}`};
  }
  fromAnnotationMenu(menu,data){
    const child=menu.child,raw=data?.annot?.data || data?.annot?.annotation?.data;
    if(!child?.file||!raw?.id||!raw.rect)return null;
    return {file:child.file,page:data.pageNumber,rect:Array.from(raw.rect),text:'',annotationId:raw.id,comment:raw.contentsObj?.str || raw.contents || '',sourceLink:`${child.file.path}#page=${data.pageNumber}&annotation=${raw.id}`};
  }
  attachToolbars(){
    for(const leaf of this.app.workspace.getLeavesOfType('pdf')){
      const toolbar=leaf.view.containerEl.querySelector('.pdf-toolbar-right');if(!toolbar||toolbar.querySelector('.research-comment-button'))continue;
      const button=toolbar.createEl('button',{cls:'pdf-toolbar-button clickable-icon research-comment-button',attr:{'aria-label':'Add research comment','title':'Add research comment · ⌘⇧M'}});
      setIcon(button,'message-square-plus');this.buttons.add(button);
      button.addEventListener('mousedown',event=>{event.preventDefault();this.toolbarSnapshot=this.readSelection();});
      button.addEventListener('click',()=>this.plugin.run(()=>this.capture(this.toolbarSnapshot || {file:leaf.view.file,page:leaf.view.viewer.child.pdfViewer.pdfViewer.currentPageNumber,rect:null,text:'',sourceLink:`${leaf.view.file.path}#page=${leaf.view.viewer.child.pdfViewer.pdfViewer.currentPageNumber}`})));
    }
  }
  async capture(given){
    if(this.inFlight)return this.inFlight;
    this.inFlight=this.createFromSelection(given).finally(()=>{this.inFlight=null;});return this.inFlight;
  }
  async createFromSelection(given){
    let source=given || this.readSelection();
    if(!source){
      const leaf=this.activePdf();
      if(this.lastSelection&&leaf?.view.file?.path===this.lastSelection.file.path&&Date.now()-this.lastSelection.at<15000)source=this.lastSelection;
      else if(leaf?.view.file){const page=leaf.view.viewer.child.pdfViewer.pdfViewer.currentPageNumber;source={file:leaf.view.file,page,rect:null,text:'',sourceLink:`${leaf.view.file.path}#page=${page}`};}
    }
    if(!source?.file)throw new Error('Select a passage in the PDF first, then choose Add research comment.');
    await loadPdfJs();
    const version=await this.plugin.pdfAnnotations.versionFor(source.file),key=await sha(new TextEncoder().encode(`${version}:${source.sourceLink}`));
    const previous=this.annotations().find(f=>{const m=this.plugin.fields(f);return m.capture_key===key || (source.annotationId&&m.source_pdf===source.file.path&&m.source_sha256===version&&m.annotation_id===source.annotationId);});
    const cached=this.created.get(key),existing=previous || (cached&&this.app.vault.getAbstractFileByPath(cached));
    if(existing){await this.plugin.pdfAnnotations.backfill(existing);await this.openForWriting(existing);new Notice('Opened your existing note for this passage.');return existing;}
    const title=this.title(source.comment,source.text,source.page),marker=await this.plugin.pdfAnnotations.ensure(source,key,title);
    const bytes=await this.app.vault.readBinary(source.file);
    const pdf=await window.pdfjsLib.getDocument({data:new Uint8Array(bytes),cMapPacked:true,cMapUrl:'/lib/pdfjs/cmaps/',standardFontDataUrl:'/lib/pdfjs/standard_fonts/'}).promise;
    let excerpt;
    try{const page=await pdf.getPage(source.page);excerpt=await this.excerpt(page,source.rect,key.slice(0,20));}finally{await pdf.destroy();}
    const path=await this.uniquePath(source.file,title,source.page,undefined,version);
    const reference=this.plugin.references().find(f=>this.plugin.paperInfo(f).path===source.file.path)?.path;
    const projects=this.plugin.projects?.paperIds(source.file.path) || [],fields={type:'research-annotation',project:projects[0] || null,projects,origin:'user',annotation_title:title,naming_review:title.startsWith('Highlight — '),annotation_kind:this.kind(source.text),annotation_format:2,source_pdf:source.file.path,source_sha256:version,source_page:source.page,source_link:`${source.file.path}#page=${source.page}&annotation=${marker.id}`,capture_source_link:source.sourceLink,annotation_id:marker.id,pdf_annotation_nm:marker.nm,source_quad_rects:source.rects || null,source_text:source.text,annotation_rect:source.rect,excerpt_image:excerpt,capture_key:key,created:new Date().toISOString(),selection:'personal-note'};
    if(reference){fields.reference=reference;const parent=this.plugin.fields(this.app.vault.getAbstractFileByPath(reference));if(parent.local_processing_only)fields.local_processing_only=true;if(parent.record_kind==='draft')fields.source_kind='draft';}
    const body=`# ${title}\n\n\`\`\`research-library\nannotation\n\`\`\`\n\n## Source passage\n\n![[${excerpt}]]\n\n## My thoughts\n\n${source.comment || ''}\n\n## Questions to check\n\n## Possible changes / proof ideas\n\n`;
    const note=await this.app.vault.create(path,fm(fields)+QuestionLayout.insert(body).text);await this.plugin.pdfAnnotations.deletions.remember(note,fields);this.created.set(key,note.path);await this.openForWriting(note);return note;
  }
  async excerpt(page,rect,id){
    const view=page.view,[x0,y0,x1,y1]=view,width=x1-x0,height=y1-y0;
    const crop=rect?[
      Math.max(x0,Math.min(rect[0]-22,x0+width*.14)),Math.max(y0,rect[1]-8),
      Math.min(x1,Math.max(rect[2]+22,x0+width*.86)),Math.min(y1,rect[3]+8)
    ]:[x0,y0,x1,y1];
    if(rect){
      const text=await page.getTextContent();
      for(const item of text.items){
        if(!item.str?.trim()||!item.transform)continue;
        const style=text.styles[item.fontName] || {},size=item.height || Math.hypot(item.transform[2],item.transform[3]) || 10;
        const low=item.transform[5]+(style.descent ?? -.22)*size,high=item.transform[5]+(style.ascent ?? .9)*size;
        if(low<crop[1]&&high>crop[1]&&high<rect[1])crop[1]=Math.min(rect[1],high+1);
        if(low<crop[3]&&high>crop[3]&&low>rect[3])crop[3]=Math.max(rect[3],low-1);
      }
    }
    const viewport=page.getViewport({scale:2.2}),converted=viewport.convertToViewportRectangle(crop);
    const left=Math.floor(Math.min(converted[0],converted[2])),top=Math.floor(Math.min(converted[1],converted[3]));
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(Math.abs(converted[2]-converted[0]));canvas.height=Math.ceil(Math.abs(converted[3]-converted[1]));
    const context=canvas.getContext('2d');if(!context)throw new Error('Could not create the source excerpt.');
    await page.render({canvasContext:context,viewport,transform:[1,0,0,1,-left,-top],background:'#ffffff',annotationMode:window.pdfjsLib.AnnotationMode.ENABLE}).promise;
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not save the source excerpt.');
    if(!(await this.app.vault.adapter.exists('Assets/Excerpts')))await this.app.vault.createFolder('Assets/Excerpts');
    const path=`Assets/Excerpts/${id}.png`,file=this.app.vault.getAbstractFileByPath(path),data=await blob.arrayBuffer();
    if(file)await this.app.vault.modifyBinary(file,data);else await this.app.vault.createBinary(path,data);
    canvas.width=1;canvas.height=1;return path;
  }
  async openForWriting(file){
    await new Promise(resolve=>this.app.workspace.onLayoutReady(resolve));
    await this.ensureQuestionWidget(file);
    const leaf=this.editorLeaf(file);
    const alreadyOpen=leaf.view?.file?.path===file.path;
    if(!alreadyOpen){if(leaf.view?.getViewType()==='markdown'&&typeof leaf.view.save==='function')await leaf.view.save();await leaf.openFile(file,{active:true});}
    if(leaf.view.getMode?.()!=='source')await leaf.setViewState({type:'markdown',state:{file:file.path,mode:'source',source:false}});
    this.app.workspace.setActiveLeaf(leaf,{focus:true});
    const editor=leaf.view.editor,lines=editor.getValue().split('\n'),index=lines.findIndex(l=>l==='## My thoughts');
    if(index>=0){let end=index+1;while(end+1<lines.length&&!/^## /.test(lines[end+1]))end++;while(end>index+2&&!lines[end].trim())end--;const line=Math.min(Math.max(index+2,end),lines.length-1);editor.setCursor({line,ch:lines[line]?.length || 0});editor.scrollIntoView({from:{line,ch:0},to:{line,ch:0}},true);}
    editor.focus();
  }
  async rename(file,title){
    const m=this.plugin.fields(file),pdf=this.app.vault.getAbstractFileByPath(m.source_pdf);if(!pdf)throw new Error('Source PDF not found.');
    const path=await this.uniquePath(pdf,title,m.source_page,file.path,m.source_sha256,true);
    await this.app.vault.process(file,content=>content.replace(/^# .+$/m,`# ${title}`));
    await this.plugin.update(file,{annotation_title:title,annotation_title_source:'user',naming_review:false});if(path!==file.path)await this.app.fileManager.renameFile(file,path);
  }
  async openSource(file){
    const m=this.plugin.fields(file);await this.plugin.openPdf(m.source_link,file.path);
  }
  async migrateExisting(overrides={}){
    const notes=this.annotations().filter(f=>this.plugin.fields(f).type==='imported-annotation'),documents=new Map(),changed=[];
    try{
      for(const file of notes){
        const m={...this.plugin.fields(file)};if(m.annotation_format===2)continue;
        const pdfFile=this.app.vault.getAbstractFileByPath(m.source_pdf);if(!pdfFile||!m.annotation_rect)continue;
        if(!documents.has(pdfFile.path)){await loadPdfJs();const bytes=await this.app.vault.readBinary(pdfFile);documents.set(pdfFile.path,await window.pdfjsLib.getDocument({data:new Uint8Array(bytes),cMapPacked:true,cMapUrl:'/lib/pdfjs/cmaps/',standardFontDataUrl:'/lib/pdfjs/standard_fonts/'}).promise);}
        const doc=documents.get(pdfFile.path),page=await doc.getPage(m.source_page),raw=await this.app.vault.read(file);
        const extracted=raw.match(/## Highlighted passage\s*\n([\s\S]*?)(?=\n## )/)?.[1]?.split('\n').filter(l=>l.startsWith('>')).map(l=>l.replace(/^> ?/,'')).join('\n') || '';
        const title=overrides[m.source_page] || this.title(m.annotation_comment,extracted,m.source_page),asset=await this.excerpt(page,m.annotation_rect,(await sha(new TextEncoder().encode(m.source_sha256+':'+m.annotation_id))).slice(0,20));
        await this.app.vault.process(file,current=>{
          let next=current.replace(/^# Highlight · page \d+$/m,`# ${title}\n\n\`\`\`research-library\nannotation\n\`\`\``);
          next=next.replace(/## Highlighted passage\s*\n[\s\S]*?(?=\n## )/,`## Source passage\n\n![[${asset}]]\n`);
          next=next.replace('## Your continuing notes','## My thoughts').replace('Write explanations, equations, questions, or proof ideas here.','');
          if(!next.includes('## Questions to check'))next+='\n## Questions to check\n\n';
          if(!next.includes('## Possible changes / proof ideas'))next+='## Possible changes / proof ideas\n\n';
          return next;
        });
        await this.plugin.update(file,{annotation_title:title,naming_review:title.startsWith('Highlight — '),annotation_kind:this.kind(extracted),annotation_format:2,source_text:extracted,excerpt_image:asset});
        const old=file.path,path=await this.uniquePath(pdfFile,title,m.source_page,file.path,m.source_sha256);
        if(path!==file.path)await this.app.fileManager.renameFile(file,path);changed.push({from:old,to:path});
      }
    }finally{for(const doc of documents.values())await doc.destroy();}
    return changed;
  }
  async importAnnotation(file,version,pageNumber,annotation,page,text){
    const existing=this.annotations().find(f=>{const m=this.plugin.fields(f);return m.source_pdf===file.path&&m.source_sha256===version&&m.annotation_id===annotation.id;});if(existing)return false;
    const comment=annotation.contentsObj?.str || annotation.contents || '',title=this.title(comment,text,pageNumber);
    const key=await sha(new TextEncoder().encode(`${file.path}:${version}:${annotation.id}`)),asset=await this.excerpt(page,annotation.rect,key.slice(0,20)),path=await this.uniquePath(file,title,pageNumber,undefined,version);
    const reference=this.plugin.references().find(f=>this.plugin.paperInfo(f).path===file.path)?.path;
    const projects=this.plugin.projects?.paperIds(file.path) || [],fields={type:'imported-annotation',project:projects[0] || null,projects,origin:'imported-pdf',annotation_title:title,naming_review:title.startsWith('Highlight — '),annotation_kind:this.kind(text),annotation_format:2,source_pdf:file.path,source_sha256:version,source_page:pageNumber,source_link:`${file.path}#page=${pageNumber}&annotation=${annotation.id}`,source_text:text,annotation_id:annotation.id,annotation_rect:Array.from(annotation.rect),annotation_comment:comment,excerpt_image:asset,selection:'imported'};if(reference){fields.reference=reference;const parent=this.plugin.fields(this.app.vault.getAbstractFileByPath(reference));if(parent.local_processing_only)fields.local_processing_only=true;if(parent.record_kind==='draft')fields.source_kind='draft';}
    const marker=this.plugin.pdfAnnotations.data.pdfStates[file.path]?.annotations.find(a=>a.page===pageNumber&&a.id===annotation.id);if(marker?.nm)fields.annotation_external_id=marker.nm;
    const body=`# ${title}\n\n\`\`\`research-library\nannotation\n\`\`\`\n\n## Source passage\n\n![[${asset}]]\n\n## Your original comment\n\n${comment?'```text\n'+comment+'\n```':'*No typed comment was attached.*'}\n\n## My thoughts\n\n## Questions to check\n\n## Possible changes / proof ideas\n\n`;
    const note=await this.app.vault.create(path,fm(fields)+QuestionLayout.insert(body).text);await this.plugin.pdfAnnotations.deletions.remember(note,fields);return true;
  }
  renderActions(el,file){
    if(!file||this.app.vault.getAbstractFileByPath(file.path)!==file)return;
    el.addClass('research-annotation-toolbar');
    const m=this.plugin.fields(file);
    const notes=this.paperNotes(m.source_pdf,m.source_sha256),index=notes.findIndex(note=>note.path===file.path),pdf=this.app.vault.getAbstractFileByPath(m.source_pdf);
    if(index>=0)el.createEl('p',{text:`PDF page ${m.source_page} · Comment ${index+1} of ${notes.length}`,cls:'research-meta research-note-context'});
    const actions=el.createDiv({cls:'research-actions research-note-primary'});
    this.plugin.button(actions,'Open original passage',()=>this.openSource(file),true);
    this.plugin.button(actions,'Write my thoughts',()=>this.openForWriting(file));
    const reference=this.plugin.referenceFor(file.path),entry=this.plugin.searchReview?.entry(file.path),menu=[];
    if(this.plugin.searchReview)menu.push({title:entry?.pinned?'Unpin from review':'Pin for review',icon:'pin',action:()=>this.plugin.searchReview.togglePin(file)},{title:'Write question',icon:'message-square',action:()=>this.writeQuestion(file)},{title:'Review settings',icon:'sliders-horizontal',action:()=>this.plugin.searchReview.openSettings(file)},{title:'Search and review',icon:'search',action:()=>this.plugin.searchReview.open()},{separator:true});
    const sheet=this.plugin.projectReview?.action(file);if(sheet)menu.push(sheet);
    if(reference)menu.push({title:'Paper details',icon:'file-text',action:()=>this.plugin.open(reference.path)});
    menu.push({title:'Save a result',icon:'bookmark-plus',action:()=>this.plugin.resultWorkflow.open(file)},{title:'Transcribe passage to LaTeX',icon:'scan-text',action:()=>this.plugin.transcription.open(file)},{separator:true},{title:'Delete annotation',icon:'trash-2',warning:true,action:()=>this.plugin.pdfAnnotations.deletions.requestDeleteNote(file)});
    this.plugin.actionMenu(actions,menu);
    const navigation=el.createDiv({cls:'research-actions research-note-navigation'});
    if(pdf)this.plugin.button(navigation,'All paper comments',()=>this.openPaperIndex(pdf,m.source_sha256));
    if(index>0)this.plugin.button(navigation,'Previous comment',()=>this.openForWriting(notes[index-1]));
    if(index>=0&&index<notes.length-1)this.plugin.button(navigation,'Next comment',()=>this.openForWriting(notes[index+1]));
    this.plugin.button(navigation,'Edit title',()=>new TitleModal(this,file).open());
    if(m.naming_review)el.createEl('p',{text:'Give this highlight a descriptive name with Edit title.',cls:'research-meta research-note-hint'});
    if(m.annotation_title_source==='source-context-review')el.createEl('p',{text:'Title suggested from the visible source context. Edit it to reflect your own purpose.',cls:'research-meta research-note-hint'});
  }
};
