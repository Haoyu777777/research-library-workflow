const {Modal,Setting,Notice,parseYaml}=require('obsidian');
const safe=value=>String(value).replace(/[\\/:*?"<>|#\[\]]/g,' ').replace(/\s+/g,' ').trim().slice(0,110);
const frontmatter=m=>'---\n'+Object.entries(m).map(([k,v])=>k+': '+JSON.stringify(v)).join('\n')+'\n---\n\n';

class NewProjectModal extends Modal {
  constructor(projects,done){super(projects.app);this.projects=projects;this.done=done;}
  onOpen(){this.modalEl.addClass('research-dialog');
    this.titleEl.setText('Create a research project');let title='';
    new Setting(this.contentEl).setName('Project name').addText(c=>{c.setPlaceholder('e.g. Random walks').onChange(v=>title=v);setTimeout(()=>c.inputEl.focus(),0);});
    new Setting(this.contentEl).addButton(c=>c.setButtonText('Create project').setCta().onClick(()=>this.projects.plugin.run(async()=>{const project=await this.projects.create(title);await this.projects.select(project.id);this.close();if(this.done)await this.done(project);else await this.projects.plugin.open(project.path);}))).addButton(c=>c.setButtonText('Cancel').onClick(()=>this.close()));
  }
}
class PaperProjectsModal extends Modal {
  constructor(projects,file){super(projects.app);this.projects=projects;this.file=file;}
  onOpen(){this.modalEl.addClass('research-dialog');
    this.titleEl.setText('Projects for this paper');this.contentEl.createEl('p',{text:this.projects.plugin.fields(this.file).title || this.file.basename});
    const selected=new Set(this.projects.ids(this.projects.plugin.fields(this.file)));
    for(const project of this.projects.all())new Setting(this.contentEl).setName(project.title).addToggle(c=>c.setValue(selected.has(project.id)).onChange(v=>v?selected.add(project.id):selected.delete(project.id)));
    new Setting(this.contentEl).addButton(c=>c.setButtonText('Save projects').setCta().onClick(()=>this.projects.plugin.run(async()=>{await this.projects.assign(this.file,[...selected]);this.close();new Notice('Paper projects updated.');}))).addButton(c=>c.setButtonText('Cancel').onClick(()=>this.close()));
  }
}
module.exports=class Projects {
  constructor(plugin){this.plugin=plugin;this.app=plugin.app;this.known={};}
  ids(fields){return [...new Set((Array.isArray(fields?.projects)?fields.projects:fields?.project?[fields.project]:[]).filter(x=>typeof x==='string'&&x))];}
  all(){return this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('Projects/')).map(f=>{const cached=this.plugin.fields(f),m=cached.type==='research-project'?cached:this.known[f.path] || {};return {id:m.project_id,title:m.title || f.basename,path:f.path};}).filter(p=>p.id).sort((a,b)=>a.title.localeCompare(b.title));}
  async initialize(){
    if(!this.app.vault.getAbstractFileByPath('Projects'))await this.app.vault.createFolder('Projects');
    for(const file of this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith('Projects/'))){
      const raw=await this.app.vault.read(file),fm=parseYaml(raw.match(/^---\n([\s\S]*?)\n---/)?.[1] || '') || {};
      if(fm.type==='research-project'){this.known[file.path]=fm;continue;}
      if(!raw.includes('```research-library\nproject\n```'))continue;
      const id=this.slug(file.basename),fields={type:'research-project',project_id:id,title:file.basename};this.known[file.path]=fields;await this.plugin.update(file,fields);
    }
    // Preserve project memberships on existing paper/result/annotation notes.
    for(const file of this.app.vault.getMarkdownFiles()){
      const m=this.plugin.fields(file);if(!['research-project','research-result','research-annotation','imported-annotation','research-note'].includes(m.type)&&!file.path.startsWith('References/'))continue;
      if(!m.project||Array.isArray(m.projects))continue;
      await this.plugin.update(file,{projects:[m.project]});
    }
    if(!this.all().length){
      // A new vault starts with one user-editable project rather than a subject
      // hard-coded into every capture/import operation.
      await this.create('Research');
    }
    const selected=this.plugin.pdfAnnotations.data.activeProject;
    if(!selected||selected!=='*'&&!this.all().some(p=>p.id===selected))await this.select(this.all()[0]?.id || '*');
  }
  slug(title){return safe(title).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,80) || 'project';}
  layout(){return '```research-library\nproject-overview\n```\n\n## Saved results\n\n```research-library\nproject-results\n```\n\n## Papers\n\n```research-library\nproject-papers\n```\n\n## Comments\n\n```research-library\nproject-comments\n```';}
  async create(title){
    const name=safe(title);if(!name)throw new Error('Enter a project name.');
    const projects=this.all(),same=projects.find(p=>p.title.toLowerCase()===name.toLowerCase());if(same)return same;
    const base=this.slug(name);let id=base,n=2;while(projects.some(p=>p.id===id))id=base+'-'+n++;
    let path='Projects/'+name+'.md';n=2;while(this.app.vault.getAbstractFileByPath(path))path='Projects/'+name+' ('+n+++').md';
    if(!this.app.vault.getAbstractFileByPath('Projects'))await this.app.vault.createFolder('Projects');
    const fields={type:'research-project',project_id:id,title:name},file=await this.app.vault.create(path,frontmatter(fields)+'# '+name+'\n\n'+this.layout()+'\n\n## Project notes\n\n');this.known[file.path]=fields;return {id,title:name,path:file.path};
  }
  active(){return this.plugin.pdfAnnotations.data.activeProject || '*';}
  context(file){const m=this.plugin.fields(file);return m.project_id || this.active();}
  async select(id){if(id!=='*'&&!this.all().some(p=>p.id===id))throw new Error('Project not found.');this.plugin.pdfAnnotations.data.activeProject=id;await this.plugin.pdfAnnotations.deletions.save();}
  async assign(reference,ids){
    if(ids.some(id=>!this.all().some(p=>p.id===id)))throw new Error('One of the selected projects no longer exists.');
    const unique=[...new Set(ids)],paper=this.plugin.paperInfo(reference);
    await this.plugin.update(reference,{projects:unique,project:unique[0] || null});
    if(paper.path)for(const note of this.plugin.annotationWorkflow.annotations().filter(f=>this.plugin.fields(f).source_pdf===paper.path))await this.plugin.update(note,{projects:unique,project:unique[0] || null});
  }
  paperIds(pdf){const reference=this.plugin.references().find(f=>this.plugin.paperInfo(f).path===pdf);return reference?this.ids(this.plugin.fields(reference)):this.active()==='*'?[]:[this.active()];}
  contains(file,id){return !id||id==='*'||this.ids(this.plugin.fields(file)).includes(id);}
  annotationContains(file,id){const m=this.plugin.fields(file),reference=this.plugin.references().find(f=>this.plugin.paperInfo(f).path===m.source_pdf);return !id||id==='*'||(reference?this.ids(this.plugin.fields(reference)):this.ids(m)).includes(id);}
  newModal(done){new NewProjectModal(this,done).open();}
  paperModal(file){new PaperProjectsModal(this,file).open();}
};
