'use strict';

process.env.APPROVED_MTO_AUTOSTART ??= '0';

const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const root=path.join(__dirname,'..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'yazd-stock-fixture-'));
const env={...process.env,DB_PATH:path.join(tmp,'db.sqlite'),BACKUP_DISABLED:'1'};
try {
 const code=`const assert=require('assert/strict'),{db,DB_PATH}=require('./src/db'),{withStock}=require('./scripts/lib/test_stock');
 const before=db.prepare('select v.sku,v.stock,p.supply_mode from variants v join products p on p.id=v.product_id order by v.rowid limit 4').all();
 assert(before.length===4 && before.every(x=>x.supply_mode==='UNAVAILABLE'));
 const lease=withStock(DB_PATH,4,12);assert.equal(lease.skus.length,4);
 for(const sku of lease.skus){const x=db.prepare('select v.stock,p.supply_mode from variants v join products p on p.id=v.product_id where v.sku=?').get(sku);assert.equal(x.stock,12);assert.equal(x.supply_mode,'IN_STOCK');}
 lease.restore();const after=db.prepare('select v.sku,v.stock,p.supply_mode from variants v join products p on p.id=v.product_id order by v.rowid limit 4').all();assert.deepEqual(after,before);
 const first=db.prepare('select product_id from variants where sku=?').get(before[0].sku);
 db.prepare("update products set supply_mode='MADE_TO_ORDER' where id=?").run(first.product_id);
 db.prepare('update variants set stock=7 where sku=?').run(before[0].sku);
 const preexisting=db.prepare('select v.sku,v.stock,p.supply_mode from variants v join products p on p.id=v.product_id order by v.rowid limit 4').all();
 const again=withStock(DB_PATH,4,20);again.restore();const restored=db.prepare('select v.sku,v.stock,p.supply_mode from variants v join products p on p.id=v.product_id order by v.rowid limit 4').all();assert.deepEqual(restored,preexisting);
 console.log('PASS isolated test fixture enables sellable variants temporarily and restores original stock and mixed supply states');`;
 const r=spawnSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error(r.stdout+'\n'+r.stderr);console.log(r.stdout.trim());
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
