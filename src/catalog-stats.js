'use strict';

const { publicVariantSql } = require('./variant-visibility');

function countPublicInStockProducts(db) {
  return db.prepare(`
    SELECT COUNT(DISTINCT p.id) AS c
    FROM products p JOIN variants v ON v.product_id=p.id
    WHERE p.supply_mode IN ('IN_STOCK','MADE_TO_ORDER')
      AND v.stock>0 AND v.price_toman>0 AND ${publicVariantSql('v')}
  `).get().c;
}

module.exports = { countPublicInStockProducts };
