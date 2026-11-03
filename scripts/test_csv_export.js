'use strict';
const assert = require('assert');
const {cell, row} = require('../src/csv-export');
for (const input of ['=2+2','+1','-1','@SUM(A1)','  =2+2','\t=2+2','\rtest','\nordinary']) {
  assert(cell(input).replace(/^"/, '').startsWith("'"), JSON.stringify(input));
}
assert.strictEqual(cell(-42), '-42');
assert.strictEqual(cell('normal فارسی'), 'normal فارسی');
assert.strictEqual(row(['a,"b\r\nc', 'x', 3]), '"a,""b\r\nc",x,3\n');
console.log('PASS CSV quoting, dangerous text neutralization and numeric negatives');
