'use strict';

const Database = require('better-sqlite3');
const { publicVariantSql } = require('../../src/variant-visibility');

function withStock(dbPath, count = 6, qty = 500, type = null) {
  const db = new Database(dbPath);

  const rows = db.prepare(`
    SELECT v.sku, v.stock, p.id AS product_id, p.supply_mode
    FROM variants v JOIN products p ON p.id=v.product_id
    WHERE ${publicVariantSql('v')} AND v.price_toman>0 ${type ? 'AND v.type = ?' : ''}
    ORDER BY v.rowid LIMIT ?`).all(...(type ? [type, count] : [count]));

  const previous = rows.map(r => ({ sku: r.sku, stock: r.stock }));
  const modes = [...new Map(rows.map(r => [r.product_id, r.supply_mode])).entries()];
  const up = db.prepare('UPDATE variants SET stock=? WHERE sku=?');
  const setMode = db.prepare("UPDATE products SET supply_mode='IN_STOCK' WHERE id=?");
  db.transaction(() => {
    for (const r of rows) up.run(qty, r.sku);
    for (const [id] of modes) setMode.run(id);
  })();
  db.close();

  return {
    skus: rows.map(r => r.sku),

    restore() {
      const d2 = new Database(dbPath);
      const u2 = d2.prepare('UPDATE variants SET stock=? WHERE sku=?');
      const mode2 = d2.prepare('UPDATE products SET supply_mode=? WHERE id=?');
      d2.transaction(() => {
        for (const p of previous) u2.run(p.stock, p.sku);
        for (const [id, mode] of modes) mode2.run(mode, id);
      })();
      d2.close();
    }
  };
}

module.exports = { withStock };
