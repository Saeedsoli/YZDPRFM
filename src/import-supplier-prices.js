'use strict';

const {priceFromUsdPerKg}=require('./essence-pricing');
const {RATE_KEY}=require('./essence-pricing-store');
const MARKER='supplier_exact_price_import_v1';
function importSupplierPrices(db, dataset) {
  if (!dataset || !Array.isArray(dataset.prices) || !dataset.prices.length) throw new Error('Empty supplier dataset');
  const ids=new Set();
  for(const row of dataset.prices) {
    if (!row || row.status!=='lexical_match_only' || !/^YZD-PROD-\d+$/.test(row.product_id) || ids.has(row.product_id)) throw new Error('Invalid or duplicate supplier match');
    ids.add(row.product_id);
    priceFromUsdPerKg(row.usd_per_kg,'300000','EDP',10);
  }
  return db.transaction(()=>{
    if (db.prepare('SELECT value FROM settings WHERE key=?').get(MARKER)) throw new Error('Supplier price import already applied');
    const rate=db.prepare('SELECT value FROM settings WHERE key=?').get(RATE_KEY)?.value;
    if (!rate) throw new Error('Missing USD exchange rate');
    const get=db.prepare('SELECT id,essence_usd_per_kg FROM products WHERE id=?');
    const setBase=db.prepare('UPDATE products SET essence_usd_per_kg=? WHERE id=?');
    const find=db.prepare('SELECT sku FROM variants WHERE product_id=? AND type=? AND volume_ml=?');
    const insert=db.prepare('INSERT INTO variants(sku,product_id,type,type_label,volume_ml,price_toman,stock,price_usd) VALUES(?,?,?,?,?,?,0,NULL)');
    const setPrice=db.prepare('UPDATE variants SET price_toman=? WHERE sku=?');
    const edps=db.prepare("SELECT sku,volume_ml FROM variants WHERE product_id=? AND type='EDP' AND volume_ml IN (10,30,50,100)");
    let changed=0,created=0,repriced=0;
    for(const row of dataset.prices) {
      const p=get.get(row.product_id);
      if (!p) throw new Error(`Missing product: ${row.product_id}`);
      if (p.essence_usd_per_kg != null) throw new Error(`Product already has an essence price: ${row.product_id}`);

      if (find.get(p.id,'SAMPLE',5) || find.get(p.id,'BODY_SPLASH',120)) throw new Error(`New-volume SKU already exists: ${p.id}`);
      const suffix=p.id.replace(/\D/g,'');
      setBase.run(String(row.usd_per_kg),p.id);
      for(const v of edps.all(p.id)) {
        setPrice.run(priceFromUsdPerKg(row.usd_per_kg,rate,'EDP',v.volume_ml),v.sku);repriced++;
      }
      for (const [type,label,volume,token] of [['SAMPLE','سمپل ۵ میل',5,'SMP'],['BODY_SPLASH','بادی اسپلش دست‌ساز',120,'BS']]) {
        const sku=`YZD-${suffix}-${token}-${String(volume).padStart(3,'0')}`;
        insert.run(sku,p.id,type,label,volume,priceFromUsdPerKg(row.usd_per_kg,rate,type,volume));created++;
      }
      changed++;
    }
    db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run(MARKER,new Date().toISOString());
    return {products:changed,variants_created:created,edp_repriced:repriced,rate_toman:Number(rate)};
  })();
}
module.exports={importSupplierPrices,MARKER};
