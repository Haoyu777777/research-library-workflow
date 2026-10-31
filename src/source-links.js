// Result notes keep a source capture, while native PDF object IDs can change
// during Undo. Resolve against the current annotation and live PDF marker.
function matches(result,record){const m=record?.m;return !!m&&['research-annotation','imported-annotation'].includes(m.type)&&m.source_pdf===result.source_pdf&&m.source_sha256===result.source_sha256&&Number(m.source_page)===Number(result.source_page)&&(!result.excerpt_image||m.excerpt_image===result.excerpt_image);}
function resolve(result,records,state,original){
 if(!result.source_annotation&&!result.excerpt_image)return {link:original,status:'unchanged'};
 const page=result.source_pdf+'#page='+result.source_page,eligible=records.filter(record=>matches(result,record)),exact=eligible.find(record=>record.path===result.source_annotation),options=exact?[exact]:eligible;
 if(options.length!==1)return {link:page,status:options.length>1?'ambiguous':'missing'};
 const record=options[0],m=record.m,nm=m.pdf_annotation_nm||m.annotation_external_id,markers=(state.annotations||[]).filter(a=>a.page===Number(result.source_page)&&(nm?a.nm===nm:a.id===String(m.annotation_id)));
 if(markers.length!==1)return {link:page,status:markers.length>1?'ambiguous':'missing'};
 return {link:page+'&annotation='+encodeURIComponent(markers[0].id),status:'linked',annotation:record.path,marker:markers[0].id};
}
module.exports={matches,resolve};
