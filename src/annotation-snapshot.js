// Store the annotation's PDF object graph, including appearance streams and its
// popup. Rebuilding that graph lets Undo survive PDF object renumbering and
// garbage collection without restoring an older copy of the whole paper.
module.exports={
  capture(page,root){
    const context=page.node.context,objects={};
    const encode=value=>{
      if(value==null)return {kind:'null'};
      if(typeof value.objectNumber==='number'){
        const id=String(value);if(!(id in objects)){objects[id]=null;objects[id]=encode(context.lookup(value));}
        return {kind:'ref',id};
      }
      if(value.asNumber)return {kind:'number',value:value.asNumber()};
      if(value.asBoolean)return {kind:'boolean',value:value.asBoolean()};
      if(String(value).startsWith('/'))return {kind:'name',value:value.decodeText()};
      if(value.asBytes)return {kind:'string',hex:Buffer.from(value.asBytes()).toString('hex')};
      if(value.asArray)return {kind:'array',values:value.asArray().map(encode)};
      if(value.dict&&value.getContents)return {kind:'stream',dict:encode(value.dict),bytes:Buffer.from(value.getContents()).toString('base64')};
      if(value.entries){
        const type=String(value.get(context.obj('Type')) || '');
        if(type==='/Page')return {kind:'page'};
        if(type==='/Pages')throw new Error('Cannot safely save this annotation for Undo.');
        const annotation=type==='/Annot'||value.has(context.obj('Subtype'))&&value.has(context.obj('Rect'));
        return {kind:'dict',entries:value.entries().filter(([key])=>!annotation||String(key)!=='/P').map(([key,item])=>[key.decodeText(),encode(item)])};
      }
      if(String(value)==='null')return {kind:'null'};
      throw new Error('Cannot safely save this PDF annotation for Undo.');
    };
    return {root:encode(root),objects};
  },
  restore(page,snapshot,hexString){
    const context=page.node.context,refs=new Map(Object.keys(snapshot.objects).map(id=>[id,context.nextRef()]));
    const decode=value=>{
      switch(value.kind){
        case 'ref':if(!refs.has(value.id))throw new Error('Incomplete annotation recovery data.');return refs.get(value.id);
        case 'number':case 'boolean':return context.obj(value.value);
        case 'null':return context.obj(null);
        case 'string':return hexString.of(value.hex);
        case 'name':return context.obj(value.value);
        case 'page':return page.ref;
        case 'array':return context.obj(value.values.map(decode));
        case 'dict':{const dict=context.obj({});for(const [key,item] of value.entries)dict.set(context.obj(key),decode(item));return dict;}
        case 'stream':return context.stream(Buffer.from(value.bytes,'base64'),decode(value.dict));
        default:throw new Error('Unknown annotation recovery data.');
      }
    };
    for(const [id,value] of Object.entries(snapshot.objects))context.assign(refs.get(id),decode(value));
    const root=decode(snapshot.root),ref=typeof root.objectNumber==='number'?root:context.register(root),dict=context.lookup(ref);
    dict.set(context.obj('P'),page.ref);page.node.addAnnot(ref);
    const popup=dict.get(context.obj('Popup'));
    if(popup){const popupDict=context.lookup(popup);popupDict.set(context.obj('P'),page.ref);page.node.addAnnot(popup);}
    return {ref,dict,id:`${ref.objectNumber}R${ref.generationNumber?ref.generationNumber:''}`};
  }
};
