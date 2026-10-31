'use strict';
// Historical SKUs are never offered for sale; this view is only for order/report joins.
function ensureVariantHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS variant_archive (
    sku TEXT PRIMARY KEY, product_id TEXT NOT NULL, type TEXT NOT NULL, type_label TEXT,
    volume_ml INTEGER, price_toman INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
    price_usd REAL, archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE VIEW IF NOT EXISTS order_variant_history AS
    SELECT sku, product_id, type, type_label, volume_ml FROM variants
    UNION ALL
    SELECT a.sku, a.product_id, a.type, a.type_label, a.volume_ml FROM variant_archive a
      WHERE NOT EXISTS (SELECT 1 FROM variants v WHERE v.sku=a.sku);`);
}
// This explicit one-time maintenance operation requires a backup at the caller.
function retireSampleThree(db) {
  return db.transaction(()=>{
    const conflict=db.prepare(`SELECT v.sku FROM variants v JOIN variant_archive a ON a.sku=v.sku
      WHERE v.type='SAMPLE' AND v.volume_ml=3 AND
      (a.product_id<>v.product_id OR a.type<>v.type OR a.volume_ml<>v.volume_ml) LIMIT 1`).get();
    if(conflict) throw new Error('Historical SKU collision: '+conflict.sku);
    const alerts=db.prepare(`SELECT COUNT(*) n FROM stock_alerts a JOIN variants v ON v.sku=a.sku
      WHERE v.type='SAMPLE' AND v.volume_ml=3 AND a.notified=0`).get().n;
    const archived=db.prepare(`INSERT OR IGNORE INTO variant_archive
      (sku,product_id,type,type_label,volume_ml,price_toman,stock,price_usd)
      SELECT v.sku,v.product_id,v.type,v.type_label,v.volume_ml,v.price_toman,v.stock,v.price_usd
      FROM variants v WHERE v.type='SAMPLE' AND v.volume_ml=3 AND
      (v.stock>0 OR EXISTS(SELECT 1 FROM order_items i WHERE i.sku=v.sku))`).run().changes;
    const removed=db.prepare("DELETE FROM variants WHERE type='SAMPLE' AND volume_ml=3").run().changes;
    return {removed,archived,inactive_alerts:alerts};
  })();
}
module.exports={ensureVariantHistory,retireSampleThree};
