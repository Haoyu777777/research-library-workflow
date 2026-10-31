// Bibliographic data remains separate from reading state, IDs and PDF identity.
const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).replace(/<[^>]+>/g,' ').replace(/\\(?:mathbb|mathrm|mathcal|mathsf|mathbf|operatorname|text)\s*/g,'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const names = list => (list || []).map(a => typeof a==='string'?a:a.literal || [a.given,a.family].filter(Boolean).join(' '));
function sameWork(local, candidate) {
 if (norm(local.title).length<16 || norm(local.title)!==norm(candidate.title)) return false;
 const a=names(local.author), b=names(candidate.author);
 if(!a.length || !b.length)return false;
 return a.every(name=>b.some(other=>{
  if(norm(name)===norm(other))return true;
  const tokens=s=>clean(s).toLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').match(/[\p{L}]{2,}/gu)||[];
  const x=tokens(name),y=tokens(other);
  return x.length>1&&y.length>1&&x.every(t=>y.includes(t));
 }));
}
function fromCSL(c, source) {
 const first=v=>Array.isArray(v)?v[0]:v;
 const valid=v=>{const d=v?.['date-parts']?.[0];return Array.isArray(d)&&/^\d{4}$/.test(String(d[0]||''))?d:undefined;};
 const print=valid(c['published-print']),online=valid(c['published-online']),issued=valid(c.issued)||valid(c.published),date=print||issued||online||[];
 const bibliographyDates={...(print?{print}:{}),...(online?{online}:{}),...(issued?{issued}:{}),selected:print?'journal-print':issued?'issued':online?'online':'unknown'};
 const rawTitle=clean(first(c.title)),title=/<\/?[a-z][^>]*>|&(?:amp|lt|gt|quot|apos|#\d+);/i.test(rawTitle)?clean(new DOMParser().parseFromString(rawTitle,'text/html').body.textContent):rawTitle;
 return {title,author:c.author||[],year:String(date[0]||''),journal:first(c['container-title']),volume:c.volume,issue:c.issue,pages:c.page,publisher:c.publisher,isbn:first(c.ISBN),issn:first(c.ISSN),doi:c.DOI,url:c.URL||(c.DOI?'https://doi.org/'+c.DOI:undefined),metadataSource:source,yearKind:'publication',bibliographyDates};
}
function fromRecord(m) {
 return {title:m.title,author:m.author||[],year:String(m.issued?.['date-parts']?.[0]?.[0]||m.year||''),edition:m.pdf_version,yearKind:m.year_kind||'unknown',recordKind:m.record_kind||'reading',journal:m['container-title'],volume:m.volume,issue:m.issue,pages:m.page,publisher:m.publisher,isbn:m.ISBN,issn:m.ISSN,doi:m.DOI,url:m.URL,arxivId:m.arxiv_id,metadataSource:m.metadata_source,bibliographyEvidence:m.bibliography_evidence,bibtexType:m.bibtex_type,bibtexExtras:m.bibtex_extras,bibliographyDates:m.bibliography_dates};
}
function fields(meta) {
 const m={bibliography_version:1,bibliography_coverage:meta.title&&meta.author?.length&&meta.year&&(meta.doi||meta.arxivId||meta.url)?'source-linked':'partial'};
 for(const [a,b]of [['journal','container-title'],['volume','volume'],['issue','issue'],['pages','page'],['publisher','publisher'],['isbn','ISBN'],['issn','ISSN'],['doi','DOI'],['url','URL'],['arxivId','arxiv_id']])if(meta[a])m[b]=meta[a];
 if(meta.bibliographyEvidence)m.bibliography_evidence=meta.bibliographyEvidence;if(meta.bibliographyDates)m.bibliography_dates=meta.bibliographyDates;if(meta.bibtexType)m.bibtex_type=meta.bibtexType;if(meta.bibtexExtras)m.bibtex_extras=meta.bibtexExtras;
 return m;
}
function pageInfo(html,url) {
 const doc=new DOMParser().parseFromString(html,'text/html'),meta=n=>clean(doc.querySelector('meta[name="'+n+'"],meta[property="'+n+'"]')?.getAttribute('content'));
 const objects=[];const visit=o=>{if(!o||typeof o!=='object')return;if(Array.isArray(o)){o.forEach(visit);return;}objects.push(o);if(o['@graph'])visit(o['@graph']);};
 for(const s of doc.querySelectorAll('script[type="application/ld+json"]'))try{visit(JSON.parse(s.textContent));}catch{}
 const heading=doc.querySelector('h1')?.textContent||meta('og:title'),sameURL=v=>{try{return new URL(typeof v==='object'?v?.['@id']:v,url).pathname===new URL(url).pathname;}catch{return false;}};
 const article=objects.find(o=>o.datePublished&&(sameURL(o.url)||sameURL(o.mainEntityOfPage)||norm(heading)&&norm(o.headline)===norm(heading)))||{};
 let date=meta('citation_publication_date')||meta('citation_date')||meta('article:published_time')||article.datePublished||'';
 if(!date){const main=doc.querySelector('main,article'),text=main?.textContent?.slice(0,1200)||'';date=text.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+(?:19|20)\d{2}/)?.[0]||'';if(!date&&main?.querySelectorAll('time[datetime]').length===1)date=main.querySelector('time[datetime]').getAttribute('datetime');}
 const year=String(date).match(/\b(?:19|20)\d{2}\b/)?.[0]||'';
 const links=[...doc.querySelectorAll('a[href]')].map(a=>{try{return new URL(a.getAttribute('href'),url).href;}catch{return '';}}).filter(u=>/^https:\/\//.test(u)&&/\.pdf(?:[?#]|$)/i.test(u));
 const pdf=meta('citation_pdf_url');if(pdf)try{links.unshift(new URL(pdf,url).href);}catch{}
 return {title:meta('citation_title')||article.headline||meta('og:title'),year,date:String(date),pdfLinks:[...new Set(links)]};
}
const owned=new Set(['title','author','year','journal','volume','number','pages','publisher','isbn','issn','doi','url','eprint','archiveprefix']);
function cached(bib) {
 const header=String(bib).match(/^\s*@(\w+)\s*\{[^,]+,/);if(!header)return {extras:{}};
 let i=header[0].length;const extras={};
 while(i<bib.length){while(/[\s,]/.test(bib[i]||'')&&i<bib.length)i++;const field=bib.slice(i).match(/^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/);if(!field)break;i+=field[0].length;const start=i;let depth=0,quoted=false,escaped=false;
  while(i<bib.length){const c=bib[i];if(escaped){escaped=false;i++;continue;}if(c==='\\'){escaped=true;i++;continue;}if(c==='"'&&depth===0)quoted=!quoted;if(!quoted){if(c==='{')depth++;if(c==='}'){if(depth===0)break;depth--;}if(c===','&&depth===0)break;}i++;}
  const value=bib.slice(start,i).trim();if(!owned.has(field[1].toLowerCase())&&value)extras[field[1]]=value;if(bib[i]==='}')break;
 }
 return {type:header[1].toLowerCase(),extras};
}
module.exports={owned,cached,clean,norm,names,sameWork,fromCSL,fromRecord,fields,pageInfo};
