const {Notice,Modal,Setting}=require('obsidian');
const fs=require('fs').promises,path=require('path'),os=require('os'),crypto=require('crypto'),{execFile}=require('child_process');
const command=(file,args)=>new Promise((resolve,reject)=>execFile(file,args,{timeout:120000,maxBuffer:1024*1024},(error,stdout)=>error?reject(error):resolve(stdout)));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

module.exports=class LibraryMaintenance {
 constructor(plugin){this.plugin=plugin;this.app=plugin.app;}
 onload(){
  this.plugin.addCommand({id:'backup-library',name:'Create a local library backup',callback:()=>this.plugin.run(()=>this.backup())});
  this.plugin.addCommand({id:'check-library-sync',name:'Check library files and synchronization setup',callback:()=>this.plugin.run(()=>this.showStatus())});
  this.app.workspace.onLayoutReady(()=>{this.plugin.registerInterval(setInterval(()=>this.plugin.run(()=>this.dailyBackup()),60*60*1000));/* Automatic external backups are opt-in through setup. */});
 }
 async inventory(root){
  const result={};const visit=async(dir,prefix='')=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){
   if(item.name==='.DS_Store'||item.name==='workspace.json'||item.name==='workspace-mobile.json')continue;
   const rel=prefix?prefix+'/'+item.name:item.name,absolute=path.join(dir,item.name);
   if(item.isSymbolicLink())throw new Error('Backup paused: the library contains a symbolic link ('+rel+').');
   if(item.isDirectory())await visit(absolute,rel);else if(item.isFile())result[rel]=hash(await fs.readFile(absolute));
  }};await visit(root);return result;
 }
 async backup({quiet=false}={}){
  if(this.backupTask)return this.backupTask;
  this.backupTask=this.createBackup(quiet).finally(()=>this.backupTask=null);return this.backupTask;
 }
 async createBackup(quiet){
  const base=this.app.vault.adapter.getBasePath?.() || this.app.vault.adapter.basePath;
  if(!base)throw new Error('A local vault is required for this backup.');
  if(process.platform!=='darwin')throw Error('This alpha backup command supports macOS only.');
  const preferences=await this.plugin.loadData();if(!preferences?.distributionSetup?.backupsEnabled)throw Error('Enable local backups in Research Library setup first.');
  const destination=path.join(os.homedir(),'Documents','Research Library Backups');await fs.mkdir(destination,{recursive:true});
  await this.plugin.projectReady;
  await this.plugin.annotationWorkflow.organizationReady;
  for(const leaf of this.app.workspace.getLeavesOfType('markdown'))if(typeof leaf.view.save==='function')await leaf.view.save();
  await this.plugin.pdfAnnotations.deletions.ready;await this.plugin.pdfAnnotations.deletions.idle();
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),name=path.basename(base),zip=path.join(destination,name+' - '+stamp+'.zip'),temporary=await fs.mkdtemp(path.join(os.tmpdir(),'research-library-backup-')),snapshot=path.join(temporary,name);
  try{
   let inventory,stable=false;
   for(let attempt=0;attempt<3;attempt++){
    await fs.rm(snapshot,{recursive:true,force:true});await fs.cp(base,snapshot,{recursive:true});inventory=await this.inventory(snapshot);const current=await this.inventory(base);
    if(JSON.stringify(Object.entries(inventory).sort())===JSON.stringify(Object.entries(current).sort())){stable=true;break;}
   }
   if(!stable)throw new Error('The library changed during backup. Try again after your edits finish saving.');
   await command('/usr/bin/ditto',['-c','-k','--keepParent',snapshot,zip+'.partial']);await command('/usr/bin/unzip',['-tqq',zip+'.partial']);await fs.rename(zip+'.partial',zip);
   const manifest={created:new Date().toISOString(),vault:name,files:inventory,archiveSha256:hash(await fs.readFile(zip)),excludedVolatileFiles:['.DS_Store','workspace.json','workspace-mobile.json']};await fs.writeFile(zip+'.manifest.json',JSON.stringify(manifest,null,2)+'\n');
   localStorage.setItem('research-library-backup:'+base,JSON.stringify({at:Date.now(),zip}));if(!quiet)new Notice('Library backup saved in Documents/Research Library Backups.');return {zip,manifest:zip+'.manifest.json',fileCount:Object.keys(inventory).length};
  }catch(error){await fs.rm(zip+'.partial',{force:true}).catch(()=>{});throw error;}finally{await fs.rm(temporary,{recursive:true,force:true});}
 }
 async dailyBackup(){
  const prefs=await this.plugin.loadData();if(!prefs?.distributionSetup?.backupsEnabled||process.platform!=='darwin')return;
  const base=this.app.vault.adapter.getBasePath?.() || this.app.vault.adapter.basePath;let previous;try{previous=JSON.parse(localStorage.getItem('research-library-backup:'+base));}catch{}
  if(!previous||Date.now()-previous.at>24*60*60*1000)await this.backup({quiet:true});
 }
 async status(){
  const base=this.app.vault.adapter.getBasePath?.() || this.app.vault.adapter.basePath,files=this.app.vault.getFiles(),conflicts=files.filter(f=>/conflicted copy|sync conflict|conflict(ed)? \d{4}[-/]/i.test(f.name)).map(f=>f.path);
  const missing=this.plugin.references().filter(f=>!this.plugin.paperInfo(f).file).map(f=>f.path);let backup;try{backup=JSON.parse(localStorage.getItem('research-library-backup:'+base));}catch{}
  return {vault:base,insideGoogleDrive:/[\\/]GoogleDrive-[^\\/]+[\\/]/.test(base),conflicts,missingPdfs:missing,lastBackup:backup?.zip || null};
 }
 async showStatus(){const status=await this.status(),modal=new Modal(this.app);modal.onOpen=()=>{modal.modalEl.addClass('research-dialog');modal.titleEl.setText('Library files and synchronization');modal.contentEl.createEl('p',{text:'Vault: '+status.vault});modal.contentEl.createEl('p',{text:status.insideGoogleDrive?'This vault is inside Google Drive. Drive Desktop controls cloud synchronization and offline availability.':'This vault is outside Google Drive.'});modal.contentEl.createEl('p',{text:'Last local backup: '+(status.lastBackup || 'None yet')});modal.contentEl.createEl('p',{text:'Missing PDFs: '+status.missingPdfs.length+' · Possible conflict copies: '+status.conflicts.length});for(const item of [...status.missingPdfs,...status.conflicts])modal.contentEl.createEl('p',{text:item});modal.contentEl.createEl('p',{text:'This check cannot confirm that Drive has uploaded every file or that another Mac has received it. Check Drive Desktop before switching devices.'});new Setting(modal.contentEl).addButton(c=>c.setButtonText('Create local backup').onClick(()=>this.plugin.run(()=>this.backup()))).addButton(c=>c.setButtonText('Close').onClick(()=>modal.close()));};modal.open();}
};
