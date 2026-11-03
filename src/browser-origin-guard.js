'use strict';
// CORS governs reading responses, not whether a browser can submit a form.
// Mutating API requests with browser-origin metadata must be same-origin.
// Non-browser API clients without Origin/Fetch-Metadata remain supported and
// must still satisfy endpoint authentication. Payment callback is GET, not
// an unsafe API mutation, so provider redirects remain unaffected.
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
 // A browser explicitly identifying cross-site traffic must not mutate APIs.
 if(fetchSite==='cross-site')return false;
 const origin=headers.origin;
 if(origin===undefined){
  // A same-site sibling is not the same origin. Older non-browser clients have
  // neither header and remain compatible; these headers are not auth tokens.
  return fetchSite!=='same-site';
 }
 const got=cleanOrigin(origin);if(!got)return false;
 const expected=new Set();
 // Production is TLS-terminated at the platform proxy. Never accept forwarded
 // protocol or host headers from the request as evidence of origin.
 const scheme=production?'https:':req.socket?.encrypted?'https:':'http:';
 const host=headers.host;
 if(typeof host==='string'&&host){const local=cleanOrigin(`${scheme}//${host}`);if(local)expected.add(local);}
 if(production){const canonical=cleanOrigin(siteUrl);if(canonical&&canonical.startsWith('https://'))expected.add(canonical);}
 return expected.has(got);
}
module.exports={allowed,cleanOrigin};
