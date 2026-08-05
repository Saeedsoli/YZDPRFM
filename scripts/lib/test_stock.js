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

  const rows = db.prepare(`
    SELECT sku, stock FROM variants
    ${type ? 'WHERE type = ?' : ''}
    ORDER BY rowid LIMIT ?`).all(...(type ? [type, count] : [count]));

  const previous = rows.map(r => ({ sku: r.sku, stock: r.stock }));
  const up = db.prepare('UPDATE variants SET stock=? WHERE sku=?');
  db.transaction(() => { for (const r of rows) up.run(qty, r.sku); })();
  db.close();

  return {
    skus: rows.map(r => r.sku),
    /** موجودی را دقیقاً به مقدار پیشین برمی‌گرداند */
    restore() {
      const d2 = new Database(dbPath);
      const u2 = d2.prepare('UPDATE variants SET stock=? WHERE sku=?');
      d2.transaction(() => { for (const p of previous) u2.run(p.stock, p.sku); })();
      d2.close();
    }
  };
}

module.exports = { withStock };
