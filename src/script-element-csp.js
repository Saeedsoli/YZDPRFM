'use strict';

const crypto = require('crypto');

// Build allowlisted hashes from the trusted HTML template BEFORE any dynamic
// SEO/catalog data is inserted. CSP3 browsers apply script-src-elem to script
// tags; older browsers fall back to script-src. Selected templates with no
// inline event handlers may opt into strict event and CSP2 fallback rules.
function scriptHashes(template) {
  const hashes = new Set();
  const tags = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  for (const match of template.matchAll(tags)) {
    if (/(?:^|\s)src\s*=/i.test(match[1])) continue;
    const content = match[2].replace(/\r\n?/g, '\n');
    hashes.add("'sha256-" + crypto.createHash('sha256').update(content,'utf8').digest('base64') + "'");
  }
  return [...hashes];
}
function forTemplate(policy, template, options = {}) {
  const directive = "script-src-elem 'self'";
  if (typeof policy !== 'string' || !policy.split(';').some(s => s.trim() === directive))
    throw Error('Expected base script-src-elem policy');
  const hashes=scriptHashes(template);
  if (options.disallowInlineHandlers && (!policy.split(';').some(s => s.trim() === "script-src 'self' 'unsafe-inline'") ||
      !policy.split(';').some(s => s.trim() === "script-src-attr 'unsafe-inline'")))
    throw Error('Expected inline fallback policy');
  return policy.split(';').map(part => {
    const current=part.trim(), hashList=hashes.length ? ' ' + hashes.join(' ') : '';
    if(current===directive)return ` ${directive}${hashList}`;
    // Account has no inline event attributes: use the same trusted hashes in
    // script-src too, so CSP2 can enforce it instead of the unsafe fallback.
    if(options.disallowInlineHandlers && current==="script-src 'self' 'unsafe-inline'")return ` script-src 'self'${hashList}`;
    if(options.disallowInlineHandlers && current==="script-src-attr 'unsafe-inline'")return " script-src-attr 'none'";
    return part;
  }).join(';').trim();
}
module.exports={scriptHashes,forTemplate};
