const MARKER='research-library-workflow';
function availability({platform,files,ready,pdfAvailable,pdfCompatible}){
 if(platform!=='darwin')return {ok:false,reason:'This alpha supports macOS. Windows, Linux and mobile have not been validated.'};
 if(!pdfAvailable)return {ok:false,reason:'Install and enable PDF++ from Obsidian Community plugins, then retry setup. This plugin does not install other plugins.'};
 if(!pdfCompatible)return {ok:false,reason:'This PDF++ version does not expose the required annotation interface. Keep your files unchanged and report the version shown below.'};
 if(!ready&&files.length)return {ok:false,reason:'Use a new empty vault for this alpha. Existing collections are not migrated or overwritten.'};
 return {ok:true};
}
module.exports={MARKER,availability};
