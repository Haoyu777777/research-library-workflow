const {Menu,setIcon}=require('obsidian');

// Pointer dismissal happens before click. Remember a second press on the
// trigger so Obsidian's outside-click dismissal cannot immediately reopen it.
module.exports=class ActionMenus {
 constructor(plugin){this.plugin=plugin;this.active=null;this.suppressed=null;this.documents=new Map();plugin.register(()=>{this.close();for(const remove of this.documents.values())remove();this.documents.clear();});}
 watch(doc){if(this.documents.has(doc))return;const down=event=>{this.suppressed=null;if(event.button!==0)return;const current=this.active;if(current&&current.button.contains(event.target)){this.suppressed=current.button;this.close();}},cancel=()=>{this.suppressed=null;},up=event=>{if(this.suppressed&&!this.suppressed.contains(event.target))this.suppressed=null;},key=event=>{this.suppressed=null;const current=this.active;if(current&&event.key==='Escape'){event.preventDefault?.();event.stopImmediatePropagation?.();this.close();current.button.focus?.();}};
 doc.addEventListener('pointerdown',down,true);doc.addEventListener('pointercancel',cancel,true);doc.addEventListener('pointerup',up,true);doc.addEventListener('keydown',key,true);this.documents.set(doc,()=>{doc.removeEventListener('pointerdown',down,true);doc.removeEventListener('pointercancel',cancel,true);doc.removeEventListener('pointerup',up,true);doc.removeEventListener('keydown',key,true);});}
 close(){const current=this.active;if(!current)return;this.active=null;current.button.setAttribute('aria-expanded','false');current.observer?.disconnect();current.menu.hide();}
 create(el,items,label){const button=el.createEl('button',{cls:'research-button research-more-button',attr:{type:'button','aria-label':label,'aria-haspopup':'menu','aria-expanded':'false',title:label}}),doc=button.ownerDocument;this.watch(doc);button.createSpan({text:'More'});setIcon(button.createSpan({cls:'research-button-icon'}),'chevron-down');button.addEventListener('click',()=>{
  if(this.suppressed===button){this.suppressed=null;return;}
  if(this.active?.button===button){this.close();return;}
  this.close();const menu=new Menu();menu.setUseNativeMenu(false);menu.dom?.addClass('research-action-menu');const current={button,menu};this.active=current;
  menu.onHide(()=>{button.setAttribute('aria-expanded','false');current.observer?.disconnect();if(this.active===current)this.active=null;});
  for(const item of items){if(item.separator){menu.addSeparator();continue;}menu.addItem(entry=>{entry.setTitle(item.title);if(item.icon)entry.setIcon(item.icon);if(item.warning)entry.dom?.addClass('research-destructive-action');entry.onClick(()=>{this.close();this.plugin.run(item.action);});});}
  const rect=button.getBoundingClientRect();button.setAttribute('aria-expanded','true');menu.showAtPosition({x:rect.left,y:rect.bottom+4},doc);
  const Observer=doc.defaultView?.MutationObserver;if(Observer){current.observer=new Observer(()=>{if(!button.isConnected&&this.active===current)this.close();});current.observer.observe(doc.body,{childList:true,subtree:true});}
 });return button;}
};
