'use strict';

const assert = require('assert');
const Database = require('better-sqlite3');
const essence = require('../src/essence-inventory');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE products(id TEXT PRIMARY KEY, slug TEXT);
  CREATE TABLE variants(sku TEXT PRIMARY KEY, product_id TEXT, type TEXT, volume_ml INTEGER, price_toman INTEGER, stock INTEGER);
`);
db.prepare('INSERT INTO products VALUES(?,?)').run('P1', 'alpha');
db.prepare('INSERT INTO products VALUES(?,?)').run('P2', 'beta');
db.prepare('INSERT INTO variants VALUES(?,?,?,?,?,?)').run('S-EDP-50', 'P1', 'EDP', 50, 1000000, 0);
db.prepare('INSERT INTO variants VALUES(?,?,?,?,?,?)').run('S-SMP-5', 'P1', 'SAMPLE', 5, 100000, 0);
db.prepare('INSERT INTO variants VALUES(?,?,?,?,?,?)').run('S-BDY-120', 'P1', 'BODY_SPLASH', 120, 800000, 0);
db.prepare('INSERT INTO variants VALUES(?,?,?,?,?,?)').run('S-EDP-30', 'P2', 'EDP', 30, 500000, 0);

assert.equal(essence.ready(db), false);
essence.install(db);
assert.equal(essence.ready(db), true);
assert.equal(essence.install(db).reason, 'already_installed');
assert.deepEqual(essence.typePercents(db), { EDP: 35, SAMPLE: 35, BODY_SPLASH: 11 });

assert.equal(essence.mlPerUnit(db, 'P1', 'EDP', 50), 17.5);
assert.equal(essence.mlPerUnit(db, 'P1', 'SAMPLE', 5), 1.75);
assert.equal(essence.mlPerUnit(db, 'P1', 'BODY_SPLASH', 120), 13.2);
assert.equal(essence.mlPerUnit(db, 'P1', 'UNKNOWN', 50), null);

essence.setStock(db, 'P1', 100, 'owner');
assert.equal(essence.mlAvailable(db, 'P1'), 100);
assert.equal(essence.maxUnits(db, 'P1', 'EDP', 50), 5);
assert.equal(essence.maxUnits(db, 'P1', 'SAMPLE', 5), 57);
assert.equal(essence.maxUnits(db, 'P1', 'BODY_SPLASH', 120), 7);

const reserve = db.transaction((orderId, product, type, volume, qty) => essence.reserveItem(db, orderId,
  { product_id: product, type, volume_ml: volume, quantity: qty }));

reserve('ORD-1', 'P1', 'EDP', 50, 2);
assert.equal(essence.mlAvailable(db, 'P1'), 65);
assert.throws(() => reserve('ORD-2', 'P1', 'BODY_SPLASH', 120, 6), /Not enough essence/);
assert.equal(essence.mlAvailable(db, 'P1'), 65, 'رد شدن سفارش نباید چیزی کم کند');

assert.equal(essence.tracked(db, 'P2'), false);
assert.deepEqual(reserve('ORD-3', 'P2', 'EDP', 30, 99), { tracked: false, ml: 0 });

const released = db.transaction(() => essence.releaseOrder(db, 'ORD-1'))();
assert.equal(released.released, 1);
assert.equal(Math.round(essence.mlAvailable(db, 'P1') * 100) / 100, 100);
const again = db.transaction(() => essence.releaseOrder(db, 'ORD-1'))();
assert.equal(again.released, 0, 'آزادسازی دوباره اثر ندارد');
assert.equal(essence.mlAvailable(db, 'P1'), 100);

essence.setStock(db, 'P1', 100, 'owner', 40);
assert.equal(essence.percentFor(db, 'P1', 'EDP'), 40);
assert.equal(essence.mlPerUnit(db, 'P1', 'EDP', 50), 20);
assert.equal(essence.maxUnits(db, 'P1', 'EDP', 50), 5);
assert.equal(essence.percentFor(db, 'P2', 'EDP'), 35, 'محصول دیگر درصد پیش‌فرض را دارد');

essence.setTypePercent(db, 'EDP', 30);
assert.equal(essence.percentFor(db, 'P1', 'EDP'), 40, 'درصد اختصاصی محصول دست‌نخورده می‌ماند');
db.prepare('DELETE FROM essence_inventory WHERE product_id=?').run('P1');
assert.equal(essence.percentFor(db, 'P1', 'EDP'), 30);

assert.throws(() => essence.setStock(db, 'P1', -1, 'x'), /INVALID_ML/);
assert.throws(() => essence.setStock(db, 'P1', 10, 'x', 0), /INVALID_PERCENT/);
assert.throws(() => essence.setTypePercent(db, 'EDP', 101), /INVALID_PERCENT/);
assert.throws(() => essence.setTypePercent(db, 'HAIR_MIST', 10), /INVALID_TYPE/);

essence.setTypePercent(db, 'EDP', 35);
essence.setStock(db, 'P1', 17.5, 'owner');
reserve('ORD-4', 'P1', 'EDP', 50, 1);
assert.equal(Math.round(essence.mlAvailable(db, 'P1')), 0);
assert.equal(essence.maxUnits(db, 'P1', 'EDP', 50), 0);

db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(3, 'S-EDP-50');
essence.setStock(db, 'P1', 100, 'owner', null, { use_count: true, use_essence: true });
let cap = essence.sellableCapacity(db, 'P1', 'EDP', 50);
assert.deepEqual({ count: cap.count, essence: cap.essence, total: cap.total }, { count: 3, essence: 5, total: 8 });

const split = db.transaction(() => essence.reserveItem(db, 'ORD-5',
  { product_id: 'P1', type: 'EDP', volume_ml: 50, quantity: 5 }))();
assert.equal(split.from_count, 3);
assert.equal(split.from_essence, 2);
assert.equal(split.ml, 35);
assert.equal(essence.mlAvailable(db, 'P1'), 65);

essence.setStock(db, 'P1', 100, 'owner', null, { use_count: false, use_essence: true });
cap = essence.sellableCapacity(db, 'P1', 'EDP', 50);
assert.equal(cap.count, 0);
assert.equal(cap.total, 5);
const onlyEssence = db.transaction(() => essence.reserveItem(db, 'ORD-6',
  { product_id: 'P1', type: 'EDP', volume_ml: 50, quantity: 2 }))();
assert.equal(onlyEssence.from_count, 0);
assert.equal(onlyEssence.from_essence, 2);

essence.setStock(db, 'P1', 100, 'owner', null, { use_count: true, use_essence: false });
const beforeMl = essence.mlAvailable(db, 'P1');
const onlyCount = db.transaction(() => essence.reserveItem(db, 'ORD-7',
  { product_id: 'P1', type: 'EDP', volume_ml: 50, quantity: 3 }))();
assert.equal(onlyCount.ml, 0);
assert.equal(essence.mlAvailable(db, 'P1'), beforeMl);
assert.throws(() => db.transaction(() => essence.reserveItem(db, 'ORD-8',
  { product_id: 'P1', type: 'EDP', volume_ml: 50, quantity: 4 }))(), /Not enough stock/);

assert.throws(() => essence.setStock(db, 'P1', 10, 'x', null, { use_count: false, use_essence: false }),
  /NO_STOCK_SOURCE/);

essence.setStock(db, 'P1', 100, 'owner', null, { use_count: true, use_essence: true });
db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(3, 'S-EDP-50');
db.transaction(() => essence.reserveItem(db, 'ORD-9',
  { product_id: 'P1', type: 'EDP', volume_ml: 50, quantity: 5 }))();
assert.equal(Math.round(essence.mlAvailable(db, 'P1')), 65);
db.transaction(() => essence.releaseOrder(db, 'ORD-9'))();
assert.equal(Math.round(essence.mlAvailable(db, 'P1')), 100);

db.close();
console.log('PASS: essence inventory — install, consumption, caps, dual-source priority, reserve, release, overrides, validation');
