// Keep imported citation keys usable without changing a paper's primary key.
function entriesFor(bib,aliases=[]){
 const header=String(bib).match(/^(\s*@\w+\s*\{\s*)([^,\s]+)(\s*,)/);
 if(!header)throw Error('Invalid saved BibTeX entry.');
 if(!Array.isArray(aliases))throw Error('Citation aliases must be a list of saved keys.');
 const keys=[header[2]];
 for(const alias of aliases){if(typeof alias!=='string'||!alias||!/^[A-Za-z0-9_:./+-]+$/.test(alias))throw Error('Invalid imported citation alias; review this paper metadata.');if(!keys.includes(alias))keys.push(alias);}
 return keys.map(key=>({key,bib:key===header[2]?bib:String(bib).replace(/^(\s*@\w+\s*\{\s*)[^,\s]+(\s*,)/,(_,start,end)=>start+key+end)}));
}
module.exports={entriesFor};
