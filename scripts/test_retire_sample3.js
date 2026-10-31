'use strict';
// Isolated integration coverage: preserve historical sales while retiring sample SKUs.
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-sample3-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
try {
 const code=`
 const assert=require('assert/strict'),{db,hasPurchased}=require('./src/db'),{retireSampleThree}=require('./src/variant-history'),reports=require('./src/reports').build(db);
 const products=db.prepare("select id from products where id like 'YZD-PROD-%' order by id limit 2").all();
 assert.equal(db.prepare("select count(*) n from variants where type='SAMPLE' and volume_ml=3").get().n,0);
 const ins=db.prepare('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)');
 ins.run('OLD-SAMPLE-1',products[0].id,'SAMPLE','قدیمی',3,123000,0);
 ins.run('OLD-SAMPLE-2',products[1].id,'SAMPLE','قدیمی',3,123000,4);
 const old=db.prepare("select sku,product_id from variants where type='SAMPLE' and volume_ml=3 order by sku limit 2").all();assert.equal(old.length,2);
 db.prepare("insert into orders(order_id,customer_name,mobile,province,city,address,subtotal,shipping_fee,total_paid,status,created_at) values(?,?,?,?,?,?,?,?,?,?,datetime('now'))").run('TEST-HISTORY','کاربر','09120001111','یزد','یزد','آزمایش',246000,0,246000,'PAID');
 db.prepare('insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values(?,?,?,?,?,?)').run('TEST-HISTORY',old[0].sku,'سمپل قدیمی',123000,2,246000);
 db.prepare('insert into stock_alerts(sku,mobile) values(?,?)').run(old[0].sku,'09120001111');
 db.prepare('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)').run('NEW-SAMPLE-5',old[0].product_id,'SAMPLE','سمپل ۵ میل',5,200000,0);
 const before={top:reports.topProducts(30),brands:reports.byBrand(30),types:reports.byType(30)};
 assert(hasPurchased('09120001111',old[0].product_id));
 const count=db.prepare("select count(*) n from variants where type='SAMPLE' and volume_ml=3").get().n;
 const result=retireSampleThree(db);assert.equal(result.removed,count);assert.equal(result.archived,2);assert.equal(result.inactive_alerts,1);
 assert.equal(db.prepare("select count(*) n from variants where type='SAMPLE' and volume_ml=3").get().n,0);
 assert.equal(db.prepare('select count(*) n from variant_archive').get().n,2);
 assert(db.prepare("select 1 from variants where sku='NEW-SAMPLE-5'").get());
 assert(hasPurchased('09120001111',old[0].product_id));
 assert.deepEqual({top:reports.topProducts(30),brands:reports.byBrand(30),types:reports.byType(30)},before);
 assert.deepEqual(db.prepare("select unit_price,quantity,line_total from order_items where order_id='TEST-HISTORY'").get(),{unit_price:123000,quantity:2,line_total:246000});
 assert.equal(db.prepare('select count(*) n from order_items i join order_variant_history v on v.sku=i.sku').get().n,1);
 assert.deepEqual(retireSampleThree(db),{removed:0,archived:0,inactive_alerts:0});
 db.prepare('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)').run('COLLISION',old[0].product_id,'SAMPLE','x',3,1,1);
 db.prepare('insert into variant_archive(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)').run('COLLISION',old[1].product_id,'SAMPLE','x',3,1,1);
 assert.throws(()=>retireSampleThree(db),/collision/);assert(db.prepare("select 1 from variants where sku='COLLISION'").get());
 console.log('PASS sample 3 removed from catalog; historical orders, reporting, alerts and conflicts handled safely');`;
 const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);console.log(r.stdout.trim());
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
