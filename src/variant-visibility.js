'use strict';
// Legacy rows are kept for historical orders, not presented or sold to customers.
function isPublicVariant(type, volume) {
  if (type === 'HAIR_MIST') return false;
  if (type === 'SAMPLE') return Number(volume) === 5;
  if (type === 'BODY_SPLASH') return Number(volume) === 120;
  return true;
}
function publicVariantSql(alias) {
  if (!/^[a-z][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  return `(${alias}.type != 'HAIR_MIST' AND (${alias}.type != 'SAMPLE' OR ${alias}.volume_ml = 5) AND (${alias}.type != 'BODY_SPLASH' OR ${alias}.volume_ml = 120))`;
}
module.exports = { isPublicVariant, publicVariantSql };
