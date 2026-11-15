'use strict';
const assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {countPublicInStockProducts}=require('../src/catalog-stats');
const db=new Database(':memory:');
db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,supply_mode TEXT NOT NULL);
CREATE TABLE variants(sku TEXT PRIMARY KEY,product_id TEXT NOT NULL,type TEXT NOT NULL,volume_ml INTEGER,stock INTEGER NOT NULL,price_toman INTEGER NOT NULL);`);
const product=db.prepare('INSERT INTO products VALUES(?,?)');
const variant=db.prepare('INSERT INTO variants VALUES(?,?,?,?,?,?)');
function add(id,mode,type='EDP',volume=50,stock=1,price=1000){
 product.run(id,mode);variant.run(id+'-v',id,type,volume,stock,price);
}
add('mto-stock','MADE_TO_ORDER','EDP',50,4,1000);
add('instock','IN_STOCK','EDP',30,2,1000);
add('mto-zero','MADE_TO_ORDER','EDP',50,0,1000);
add('unavailable','UNAVAILABLE','EDP',50,5,1000);
add('no-price','IN_STOCK','EDP',50,8,0);
add('hidden-hair','MADE_TO_ORDER','HAIR_MIST',50,9,1000);
add('hidden-sample','MADE_TO_ORDER','SAMPLE',10,3,1000);
add('hidden-splash','MADE_TO_ORDER','BODY_SPLASH',100,3,1000);
add('public-sample','MADE_TO_ORDER','SAMPLE',5,2,1000);
add('public-splash','IN_STOCK','BODY_SPLASH',120,1,1000);
assert.equal(countPublicInStockProducts(db),4);
db.prepare("UPDATE variants SET stock=0 WHERE sku='mto-stock-v'").run();
assert.equal(countPublicInStockProducts(db),3,'count reflects a stock change immediately');
db.close();
console.log('PASS in-stock stats count only publicly visible, priced, orderable products and refresh live stock');
