'use strict';
const a=require('assert/strict'),D=require('better-sqlite3'),f=require('../src/hugo-versus-name');
const db=new D(':memory:');db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT);CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT,brand_en TEXT,name_en TEXT,name_fa TEXT,search_blob TEXT);INSERT INTO products VALUES('YZD-PROD-1801','hugo-boss-hugo-man','Hugo Boss','HUGO BOSS - Hugo Man','نام مدیر','x');");
a.equal(f.apply(db).updated,0);a.equal(db.prepare('select name_fa from products').get().name_fa,'نام مدیر');a.equal(f.apply(db).reason,'already_applied');db.close();console.log('PASS Hugo name preserves owner edits and replay');
