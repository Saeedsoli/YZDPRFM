'use strict';
const assert = require('assert');
const Database = require('better-sqlite3');
const catalog = require('../src/routes/admin-catalog');
const db = new Database(':memory:');
db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY, slug TEXT, name_fa TEXT, name_en TEXT, brand_fa TEXT, brand_en TEXT, search_blob TEXT, supply_mode TEXT);
CREATE TABLE variants(sku TEXT PRIMARY KEY, product_id TEXT, type TEXT, type_label TEXT, volume_ml INTEGER, stock INTEGER, price_toman INTEGER);`);
const addProduct = db.prepare('INSERT INTO products VALUES(?,?,?,?,?,?,?,?)');
const addVariant = db.prepare('INSERT INTO variants VALUES(?,?,?,?,?,?,?)');
addProduct.run('a','a','الف','Alpha','برند','Brand','الف alpha برند','MADE_TO_ORDER');
addProduct.run('b','b','ب','Beta','برند','Brand','ب beta برند','IN_STOCK');
addProduct.run('c','c','پ','Gamma','برند','Brand','پ gamma برند','UNAVAILABLE');
addVariant.run('a-30','a','EDP','پرفیوم',30,0,1000);
addVariant.run('a-50','a','EDP','پرفیوم',50,4,1000);
addVariant.run('a-99','a','EDP','پرفیوم',100,8,0);
addVariant.run('b-5','b','SAMPLE','سمپل',5,3,1000);
addVariant.run('c-30','c','EDP','پرفیوم',30,7,1000);
addVariant.run('hidden','a','HAIR_MIST','عطر مو',50,9,1000);
for (let i=0;i<31;i++) addVariant.run('bulk-'+String(i).padStart(2,'0'),'b','BODY_SPLASH','بادی‌اسپلش',120,i,1000);
async function run(query={},allowed=true) {
 let out;
 await catalog.handle({method:'GET',pathname:'/api/admin/inventory',parsed:{query},db,normalizeFa:s=>s.toLowerCase(),can:p=>{assert.equal(p,'products.view'); if (!allowed) out={code:403}; return allowed;},sendJSON:(code,data)=>{out={code,data};}});
 return out;
}
(async()=>{
 const before=db.prepare('SELECT SUM(stock) n FROM variants').get().n;
 assert.equal((await run({},false)).code,403);
 let r=(await run({q:'a-30'})).data; assert.equal(r.total,1); assert.equal(r.items[0].availability,'MADE_TO_ORDER');
 r=(await run({q:'a-99'})).data; assert.equal(r.items[0].availability,'UNAVAILABLE');
 r=(await run({q:'c-30'})).data; assert.equal(r.items[0].availability,'UNAVAILABLE');
 r=(await run({q:'hidden'})).data; assert.equal(r.total,0);
 r=(await run({q:'%'})).data; assert.equal(r.total,0);
 r=(await run({type:'BODY_SPLASH',sort:'stock_down'})).data; assert.equal(r.total,31); assert.equal(r.items.length,30); assert.equal(r.items[0].stock,30);
 r=(await run({type:'BODY_SPLASH',sort:'stock_down',page:'2'})).data; assert.equal(r.items.length,1); assert.equal(r.items[0].stock,0);
 r=(await run({status:'MADE_TO_ORDER'})).data; assert.equal(r.total,1);
 r=(await run({status:'IN_STOCK',type:'SAMPLE'})).data; assert.equal(r.total,1);
 assert.equal(db.prepare('SELECT SUM(stock) n FROM variants').get().n,before);
 db.close(); console.log('PASS: inventory RBAC, states, hidden variants, search escaping, filters, sorting, pagination, read-only');
})().catch(e=>{console.error(e);process.exit(1)});
