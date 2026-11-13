'use strict';

const fs = require('fs');
const path = require('path');

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}

function resolvePublicFile(root, name) {
  const candidate = path.resolve(root, name);
  if (!within(path.resolve(root), candidate)) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(candidate);
    if (!within(realRoot, realFile) || !fs.statSync(realFile).isFile()) return null;
    return realFile;
  } catch (err) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(err.code)) return null;
    throw err;
  }
}
module.exports = { resolvePublicFile };
