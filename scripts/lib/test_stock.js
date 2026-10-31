/**
 * کمک‌کننده مشترک آزمون‌ها برای موجودی.
 *
 * چرا لازم شد: از تیر ۱۴۰۵ موجودی همه کالاها صفر است (خواسته
 * مالک — کالا تا وقتی انبار تأییدش نکند نباید فروخته شود). ولی
 * آزمون‌های سفارش و پرداخت به کالای موجود نیاز دارند.
 *
 * راه اشتباه: موجودی تولید را بالا نگه داریم تا آزمون‌ها کار کنند.
 * راه درست: هر آزمون موجودی موقتِ خودش را بسازد و در پایان
 * برگرداند. این‌طور آزمون به داده تولید وابسته نیست و اگر روزی
 * موجودی واقعی وارد شد، چیزی خراب نمی‌کند.
 *
 * استفاده:
 *   const { withStock } = require('./lib/test_stock');
 *   const t = withStock(DB_PATH, 6, 500);   // ۶ واریانت با موجودی ۵۰۰
 *   ...
 *   t.restore();                            // برگرداندن به حالت اول
 */
'use strict';

const Database = require('better-sqlite3');
const { publicVariantSql } = require('../../src/variant-visibility');

/**
 * به چند واریانت موجودی موقت می‌دهد.
 *
 * @param {string} dbPath   مسیر دیتابیس
 * @param {number} count    چند واریانت
 * @param {number} qty      موجودی هر کدام
 * @param {string} [type]   محدود به یک نوع (مثلاً 'EDP')
 * @returns {{skus:string[], restore:Function}}
 */
function withStock(dbPath, count = 6, qty = 500, type = null) {
  const db = new Database(dbPath);

  // A sellable test fixture needs both stock and product supply status. Never
  // select retired variants or zero-priced rows, which checkout rightly rejects.
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
    /** موجودی را دقیقاً به مقدار پیشین برمی‌گرداند */
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
