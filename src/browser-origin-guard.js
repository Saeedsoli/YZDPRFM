'use strict';

const UNSAFE=new Set(['POST','PUT','PATCH','DELETE']);
function cleanOrigin(value){
 if(typeof value!=='string'||!value||value==='null')return null;
 try{
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null;
  return u.origin;
 }catch{return null;}
}
function allowed(req,pathname,{production=false,siteUrl=''}={}){
 if(!UNSAFE.has(String(req.method||'').toUpperCase())||!pathname.startsWith('/api/'))return true;
 const headers=req.headers||{},fetchSite=String(headers['sec-fetch-site']||'').trim().toLowerCase();

 if(fetchSite==='cross-site')return false;
 const origin=headers.origin;
 if(origin===undefined){

  return fetchSite!=='same-site';
 }
 const got=cleanOrigin(origin);if(!got)return false;
 const expected=new Set();

 const scheme=production?'https:':req.socket?.encrypted?'https:':'http:';
 const host=headers.host;
 if(typeof host==='string'&&host){const local=cleanOrigin(`${scheme}//${host}`);if(local)expected.add(local);}
 if(production){const canonical=cleanOrigin(siteUrl);if(canonical&&canonical.startsWith('https://'))expected.add(canonical);}
 return expected.has(got);
}
module.exports={allowed,cleanOrigin};
