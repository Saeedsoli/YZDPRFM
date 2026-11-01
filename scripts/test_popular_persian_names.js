'use strict';
const assert=require('assert/strict'),Database=require('better-sqlite3'),f=require('../src/popular-persian-names');
const m=require('../seed/popular_persian_names_v1.json'),db=new Database(':memory:');
db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT,brand_en TEXT,brand_fa TEXT,name_fa TEXT,search_blob TEXT)');
const ins=db.prepare('insert into products values(?,?,?,?,?,?)');
ins.run(m.brand_items[0].id,m.brand_items[0].slug,'Jean Paul Gaultier','ژان پل گالتیه','مدیر','x');
ins.run(m.brand_items[1].id,m.brand_items[1].slug,'Jean Paul Gaultier','انتخاب مدیر','مدیر','x');
for(const x of m.name_items)if(!db.prepare('select id from products where id=?').get(x.id))ins.run(x.id,x.slug,'x','x',x.id==='YZD-PROD-1707'?'انتخاب مدیر':x.old,'x');
const r=f.apply(db);assert.equal(r.brands,1);assert.equal(db.prepare('select brand_fa from products where id=?').get(m.brand_items[1].id).brand_fa,'انتخاب مدیر');assert.equal(db.prepare('select name_fa from products where id=?').get('YZD-PROD-1707').name_fa,'انتخاب مدیر');assert.equal(f.apply(db).reason,'already_applied');db.close();console.log('PASS Persian names, guarded updates and replay');
