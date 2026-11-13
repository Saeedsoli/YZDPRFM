'use strict';

const DEFAULT_PERCENT = { EDP: 35, SAMPLE: 35, BODY_SPLASH: 11 };
const KEY = 'essence_inventory_schema_v2';
const EPSILON = 0.001;

const DDL = [
  `CREATE TABLE IF NOT EXISTS essence_inventory (
     product_id       TEXT PRIMARY KEY,
     ml_on_hand       REAL NOT NULL CHECK(ml_on_hand >= 0),
     percent_override REAL CHECK(percent_override IS NULL OR (percent_override > 0 AND percent_override <= 100)),
     use_count        INTEGER NOT NULL DEFAULT 1 CHECK(use_count IN (0,1)),
     use_essence      INTEGER NOT NULL DEFAULT 1 CHECK(use_essence IN (0,1)),
     updated_at       TEXT NOT NULL,
     updated_by       TEXT,
     FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
   )`,
  `CREATE TABLE IF NOT EXISTS essence_type_percent (
     type    TEXT PRIMARY KEY,
     percent REAL NOT NULL CHECK(percent > 0 AND percent <= 100)
   )`,
  `CREATE TABLE IF NOT EXISTS essence_reservations (
     order_id   TEXT NOT NULL,
     product_id TEXT NOT NULL,
     ml         REAL NOT NULL CHECK(ml > 0),
     released   INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1)),
     created_at TEXT NOT NULL,
     PRIMARY KEY (order_id, product_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_essence_res_product ON essence_reservations(product_id, released)`
];

function ready(db) {
  const names = ['essence_inventory', 'essence_type_percent', 'essence_reservations'];
  const have = new Set(db.prepare(
    "SELECT name FROM sqlite_master WHERE type IN ('table','index')").all().map(r => r.name));
  const marker = db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
  if (!names.every(n => have.has(n)) || marker?.value !== '1') return false;
  const cols = new Set(db.prepare('PRAGMA table_info(essence_inventory)').all().map(c => c.name));
  return cols.has('use_count') && cols.has('use_essence');
}

function install(db) {
  return db.transaction(() => {
    const marker = db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
    if (marker?.value === '1' && ready(db)) return { reason: 'already_installed' };
    const existing = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='essence_inventory'").get();
    for (const sql of DDL) db.exec(sql);
    if (existing) {

      const cols = new Set(db.prepare('PRAGMA table_info(essence_inventory)').all().map(c => c.name));
      if (!cols.has('use_count'))
        db.exec('ALTER TABLE essence_inventory ADD COLUMN use_count INTEGER NOT NULL DEFAULT 1');
      if (!cols.has('use_essence'))
        db.exec('ALTER TABLE essence_inventory ADD COLUMN use_essence INTEGER NOT NULL DEFAULT 1');
      db.prepare('DELETE FROM settings WHERE key=?').run('essence_inventory_schema_v1');
    }
    const seed = db.prepare('INSERT OR IGNORE INTO essence_type_percent(type,percent) VALUES(?,?)');
    for (const [type, percent] of Object.entries(DEFAULT_PERCENT)) seed.run(type, percent);
    db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(KEY, '1');
    return { created: true };
  })();
}

function typePercents(db) {
  const rows = db.prepare('SELECT type, percent FROM essence_type_percent').all();
  const map = { ...DEFAULT_PERCENT };
  for (const row of rows) map[row.type] = Number(row.percent);
  return map;
}

function percentFor(db, productId, type) {
  const override = db.prepare('SELECT percent_override FROM essence_inventory WHERE product_id=?').get(productId);
  if (override && override.percent_override != null &&
      Number.isFinite(Number(override.percent_override))) return Number(override.percent_override);
  return typePercents(db)[type] ?? null;
}

function mlPerUnit(db, productId, type, volumeMl) {
  const percent = percentFor(db, productId, type);
  const volume = Number(volumeMl);
  if (!Number.isFinite(percent) || !Number.isFinite(volume) || volume <= 0) return null;
  return volume * percent / 100;
}

function policyFor(db, productId) {
  const row = db.prepare('SELECT use_count, use_essence FROM essence_inventory WHERE product_id=?').get(productId);
  if (!row) return { tracked: false, use_count: true, use_essence: false };
  return { tracked: true, use_count: row.use_count === 1, use_essence: row.use_essence === 1 };
}

function tracked(db, productId) {
  return !!db.prepare('SELECT 1 FROM essence_inventory WHERE product_id=?').get(productId);
}

function mlAvailable(db, productId) {
  const row = db.prepare('SELECT ml_on_hand FROM essence_inventory WHERE product_id=?').get(productId);
  return row ? Number(row.ml_on_hand) : null;
}

function maxUnits(db, productId, type, volumeMl) {
  const available = mlAvailable(db, productId);
  const perUnit = mlPerUnit(db, productId, type, volumeMl);
  if (available == null || perUnit == null || perUnit <= 0) return null;
  return Math.floor((available + EPSILON) / perUnit);
}

function requireTransaction(db) {
  if (!db.inTransaction) throw Error('Essence reservation requires a transaction');
}

function reserveItem(db, orderId, itemRow) {
  requireTransaction(db);
  const { product_id: productId, type, volume_ml: volumeMl, quantity } = itemRow;
  const policy = policyFor(db, productId);
  if (!policy.tracked) return { tracked: false, ml: 0 };
  if (!Number.isInteger(quantity) || quantity < 1)
    throw Object.assign(Error('Invalid quantity'), { code: 'CART_CHANGED' });
  const perUnit = mlPerUnit(db, productId, type, volumeMl);
  if (policy.use_essence && perUnit == null)
    throw Object.assign(Error('Essence consumption unknown'), { code: 'CART_CHANGED' });

  const stockRow = db.prepare(`SELECT v.stock FROM variants v WHERE v.product_id=? AND v.type=? AND v.volume_ml=?`)
    .get(productId, type, volumeMl);
  const onHand = policy.use_count && stockRow ? Math.max(0, Number(stockRow.stock) || 0) : 0;
  const fromCount = Math.min(quantity, onHand);
  const fromEssenceUnits = quantity - fromCount;
  let ml = 0;
  if (fromEssenceUnits > 0) {
    if (!policy.use_essence) throw Object.assign(Error('Not enough stock'), { code: 'CART_CHANGED' });
    ml = perUnit * fromEssenceUnits;
    const take = db.prepare(
      'UPDATE essence_inventory SET ml_on_hand = ml_on_hand - ?, updated_at = ? WHERE product_id=? AND ml_on_hand >= ?');
    if (take.run(ml, new Date().toISOString(), productId, ml - EPSILON).changes !== 1) {
      throw Object.assign(Error('Not enough essence'), { code: 'CART_CHANGED' });
    }
    db.prepare(`INSERT INTO essence_reservations(order_id, product_id, ml, released, created_at)
                VALUES(?,?,?,0,?)
                ON CONFLICT(order_id, product_id) DO UPDATE SET ml = ml + excluded.ml`).run(
      orderId, productId, ml, new Date().toISOString());
  }
  return { tracked: true, ml, from_count: fromCount, from_essence: fromEssenceUnits };
}

function sellableCapacity(db, productId, type, volumeMl) {
  const policy = policyFor(db, productId);
  if (!policy.tracked) return null;
  const row = db.prepare(`SELECT v.stock FROM variants v WHERE v.product_id=? AND v.type=? AND v.volume_ml=?`)
    .get(productId, type, volumeMl);
  const count = policy.use_count && row ? Math.max(0, Number(row.stock) || 0) : 0;
  const essence = policy.use_essence ? (maxUnits(db, productId, type, volumeMl) ?? 0) : 0;
  return { count, essence, total: count + essence };
}

function releaseOrder(db, orderId) {
  requireTransaction(db);
  const rows = db.prepare('SELECT product_id, ml FROM essence_reservations WHERE order_id=? AND released=0').all(orderId);
  for (const row of rows) {
    db.prepare('UPDATE essence_inventory SET ml_on_hand = ml_on_hand + ?, updated_at=? WHERE product_id=?')
      .run(row.ml, new Date().toISOString(), row.product_id);
  }
  db.prepare('UPDATE essence_reservations SET released=1 WHERE order_id=? AND released=0').run(orderId);
  return { released: rows.length, ml: rows.reduce((sum, r) => sum + r.ml, 0) };
}

function snapshot(db, productId) {
  const row = db.prepare('SELECT * FROM essence_inventory WHERE product_id=?').get(productId);
  if (!row) return { tracked: false };
  const percents = typePercents(db);
  return {
    tracked: true,
    ml_on_hand: Number(row.ml_on_hand),
    percent_override: row.percent_override == null ? null : Number(row.percent_override),
    use_count: row.use_count === 1,
    use_essence: row.use_essence === 1,
    percents,
    updated_at: row.updated_at
  };
}

function setStock(db, productId, ml, actor, percentOverride, options = {}) {
  const value = Number(ml);
  if (!Number.isFinite(value) || value < 0) throw Error('INVALID_ML');
  const override = percentOverride === null || percentOverride === undefined || percentOverride === ''
    ? null : Number(percentOverride);
  if (override !== null && (!Number.isFinite(override) || override <= 0 || override > 100)) throw Error('INVALID_PERCENT');
  const useCount = options.use_count === undefined ? 1 : (options.use_count ? 1 : 0);
  const useEssence = options.use_essence === undefined ? 1 : (options.use_essence ? 1 : 0);
  if (!useCount && !useEssence) throw Error('NO_STOCK_SOURCE');
  return db.transaction(() => {
    db.prepare(`INSERT INTO essence_inventory(product_id, ml_on_hand, percent_override, use_count, use_essence, updated_at, updated_by)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(product_id) DO UPDATE SET
                  ml_on_hand = excluded.ml_on_hand,
                  percent_override = excluded.percent_override,
                  use_count = excluded.use_count,
                  use_essence = excluded.use_essence,
                  updated_at = excluded.updated_at,
                  updated_by = excluded.updated_by`)
      .run(productId, value, override, useCount, useEssence, new Date().toISOString(), actor || null);
    return snapshot(db, productId);
  })();
}

function setTypePercent(db, type, percent) {
  const value = Number(percent);
  if (!Number.isFinite(value) || value <= 0 || value > 100) throw Error('INVALID_PERCENT');
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_PERCENT, type)) throw Error('INVALID_TYPE');
  db.prepare('INSERT INTO essence_type_percent(type,percent) VALUES(?,?) ' +
             'ON CONFLICT(type) DO UPDATE SET percent=excluded.percent').run(type, value);
  return typePercents(db);
}

module.exports = {
  KEY, DEFAULT_PERCENT, ready, install, typePercents, percentFor, mlPerUnit,
  tracked, mlAvailable, maxUnits, policyFor, sellableCapacity,
  reserveItem, releaseOrder, snapshot, setStock, setTypePercent
};
