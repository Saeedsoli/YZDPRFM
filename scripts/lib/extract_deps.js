'use strict';

const IGNORE = new Set([

  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
  'break', 'continue', 'return', 'function', 'const', 'let', 'var',
  'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'this',
  'try', 'catch', 'finally', 'throw', 'await', 'async', 'yield',
  'class', 'extends', 'super', 'void', 'null', 'true', 'false',
  'undefined', 'NaN', 'Infinity',

  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'Promise',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'BigInt', 'Proxy',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI', 'console',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'process', 'Buffer', 'require', 'module', 'exports', '__dirname',
  '__filename', 'globalThis', 'structuredClone', 'queueMicrotask'
]);

function identifiers(src) {
  const out = new Set();
  let i = 0;
  const n = src.length;
  let prevMeaningful = '';

  const isIdStart = c => /[A-Za-z_$]/.test(c);
  const isIdPart  = c => /[A-Za-z0-9_$]/.test(c);

  while (i < n) {
    const c = src[i];

    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const q = c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      prevMeaningful = q;
      continue;
    }

    if (c === '`') {
      i++;
      let depth = 0;
      let expr = '';
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`' && depth === 0) { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          depth = 1; i += 2; expr = '';
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (!depth) break; }
            expr += src[i]; i++;
          }
          i++;
          for (const id of identifiers(expr)) out.add(id);
          continue;
        }
        i++;
      }
      prevMeaningful = '`';
      continue;
    }

    if (isIdStart(c)) {
      let j = i;
      while (j < n && isIdPart(src[j])) j++;
      const word = src.slice(i, j);

      const isProp = prevMeaningful === '.';

      let k = j;
      while (k < n && /\s/.test(src[k])) k++;
      const followedByColon = src[k] === ':' && src[k + 1] !== ':';
      const isObjKey = followedByColon &&
                       (prevMeaningful === '{' || prevMeaningful === ',');

      if (!isProp && !isObjKey && !IGNORE.has(word)) out.add(word);

      i = j;
      prevMeaningful = word;
      continue;
    }

    if (/\s/.test(c)) { i++; continue; }

    prevMeaningful = c;
    i++;
  }
  return out;
}

function declared(src) {
  const out = new Set();
  const patterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\b(?:const|let|var)\s*\{([^}]+)\}/g,
    /\b(?:const|let|var)\s*\[([^\]]+)\]/g,
    /\bfunction\s+([A-Za-z_$][\w$]*)/g,
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
    /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(src)) !== null) {
      for (const part of m[1].split(',')) {
        const name = part.split(':').pop().split('=')[0].trim()
                         .replace(/^\.\.\./, '');
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.add(name);
      }
    }
  }
  return out;
}

function externalDeps(block, available) {
  const used = identifiers(block);
  const local = declared(block);
  const avail = available ? new Set(available) : null;

  const deps = [...used]
    .filter(x => !local.has(x))
    .filter(x => (avail ? avail.has(x) : true));

  return deps.sort();
}

module.exports = { identifiers, declared, externalDeps, IGNORE };
