'use strict';

const crypto = require('crypto');

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

const HANDLER_RE = /\son[a-z][a-z0-9:_-]*\s*=/i;
function hasInlineHandlers(template){ return HANDLER_RE.test(String(template || '')); }
function forTemplate(policy, template, options = {}) {
  const directive = "script-src-elem 'self'";
  const attrDirective = "script-src-attr 'unsafe-inline'";
  const scriptDirective = "script-src 'self' 'unsafe-inline'";
  if (typeof policy !== 'string' || !policy.split(';').some(s => s.trim() === directive))
    throw Error('Expected base script-src-elem policy');
  const parts = policy.split(';');
  if (!parts.some(s => s.trim() === scriptDirective) || !parts.some(s => s.trim() === attrDirective))
    throw Error('Expected base inline fallback policy');
  const disallowInlineHandlers = options.disallowInlineHandlers ?? !hasInlineHandlers(template);
  const hashes = scriptHashes(template);
  const hashList = hashes.length ? ' ' + hashes.join(' ') : '';
  return parts.map(part => {
    const current = part.trim();
    if (current === directive) return ` ${directive}${hashList}`;
    if (current === scriptDirective) return ` script-src 'self'${hashList}`;
    if (current === attrDirective && disallowInlineHandlers) return " script-src-attr 'none'";
    return part;
  }).join(';').trim();
}

module.exports={scriptHashes,forTemplate,hasInlineHandlers};
