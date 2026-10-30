'use strict';
// Isolated DB integration test: no live customer/store data are touched.
const assert = require('assert/strict');
const { mkdtempSync, rmSync } = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = mkdtempSync(path.join(os.tmpdir(), 'yazd-supplement-test-'));
const env = { ...process.env, DB_PATH: path.join(dir, 'test.db'), BACKUP_DISABLED: '1' };
function run(code) {
  const r = spawnSync(process.execPath, ['-e', code], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8', timeout: 120000 });
  if (r.status !== 0) throw new Error(`Child failed: ${r.stderr}\n${r.stdout}`);
  return r.stdout;
}
try {
  run(`const assert=require('assert/strict');const {db}=require('./src/db');
    const id='SUP-ATKINSONS-OUD-SAVE-THE-KING';
    const p=db.prepare('select * from products where id=?').get(id);
    assert(p);assert.equal(p.slug,'atkinsons-oud-save-the-king');
    assert.equal(p.supply_mode,'UNAVAILABLE');
    assert.equal(db.prepare('select count(*) n from variants where product_id=?').get(id).n,0);
    assert(JSON.parse(p.notes_top).includes('آکورد چای ارل‌گری و ترنج'));
    db.prepare('update products set name_fa=? where id=?').run('اصلاح مدیر',id);`);
  run(`const assert=require('assert/strict');const {db}=require('./src/db');
    const id='SUP-ATKINSONS-OUD-SAVE-THE-KING';
    assert.equal(db.prepare('select count(*) n from products where id=?').get(id).n,1);
    assert.equal(db.prepare('select name_fa from products where id=?').get(id).name_fa,'اصلاح مدیر');`);
  console.log('PASS: isolated initial seed, unavailable, no sellable variants, source notes, restart and preserved edits');
} finally { rmSync(dir, { recursive: true, force: true }); }
