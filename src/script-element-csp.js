'use strict';

const crypto = require('crypto');

// Build allowlisted hashes from the trusted HTML template BEFORE any dynamic
// SEO/catalog data is inserted. CSP3 browsers apply script-src-elem to script
// tags; older browsers fall back to script-src. Event-handler attributes are
// still allowed and must be eliminated separately before a strict CSP.
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
function forTemplate(policy, template) {
  const directive = "script-src-elem 'self'";
  if (typeof policy !== 'string' || !policy.split(';').some(s => s.trim() === directive))
    throw Error('Expected base script-src-elem policy');
  const hashes=scriptHashes(template);
  return policy.split(';').map(part => part.trim() === directive ? ` ${directive}${hashes.length ? ' ' + hashes.join(' ') : ''}` : part).join(';').trim();
}
module.exports={scriptHashes,forTemplate};
