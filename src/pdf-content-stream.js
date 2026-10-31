const {inflateSync}=require('zlib');

// Fingerprint the page content without rewriting or repairing its bytes.
module.exports=function contentStream(stream,context){
  let bytes=stream.getContents(),filter=String(stream.dict?.get(context.obj('Filter')) || '');
  if(filter==='/FlateDecode'||filter==='[ /FlateDecode ]'){
    try{bytes=inflateSync(bytes);filter='';}
    catch(error){
      // Some readable legacy PDFs omit the end of a Flate stream. PDF.js
      // accepts these, while Node's strict inflater raises Z_BUF_ERROR.
      // Keep the filter and hash the original encoded bytes, just as for an
      // unsupported filter. Never hash a partially decoded prefix: a change
      // anywhere in the original stream must still change its fingerprint.
      if(error.code!=='Z_BUF_ERROR')throw error;
    }
  }
  return {bytes,filter,token:!filter&&bytes.length<32?Buffer.from(bytes).toString('latin1').trim():null};
};
