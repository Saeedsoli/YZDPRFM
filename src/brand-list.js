'use strict';

const QUERY = `
  SELECT brand_fa, brand_en, COUNT(*) AS count
  FROM products
  WHERE brand_fa IS NOT NULL AND TRIM(brand_fa) != '' AND supply_mode != 'UNAVAILABLE'
  GROUP BY brand_fa, brand_en
  ORDER BY count DESC, brand_fa
`;

function listBrands(db) {
  return db.prepare(QUERY).all();
}

module.exports = { listBrands };
