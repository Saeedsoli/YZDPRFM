'use strict';

// CSV quoting preserves the table structure; quoting alone does not prevent a
// spreadsheet from interpreting a cell as a formula. Prefix dangerous text
// with an apostrophe. Genuine numeric values (including negatives) stay numeric.
// Spreadsheet import/save behaviour varies; CSV is not a typed spreadsheet.
function cell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value !== 'number' && (/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(s) || /^[\t\r\n]/.test(s))) {
    s = "'" + s;
  }
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function row(values) { return values.map(cell).join(',') + '\n'; }
module.exports = { cell, row };
