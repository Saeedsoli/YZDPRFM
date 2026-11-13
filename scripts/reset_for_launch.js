#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path');
const args=process.argv.slice(2);
if(args.some(a=>a!=='--dry-run')){
 console.error('حذف گروهی غیرفعال است؛ سفارش‌ها، مشتریان و تاریخچه حفظ می‌شوند.');
 process.exit(2);
}
const file=process.env.DB_PATH||path.join(__dirname,'../data/yazd.db');
if(!fs.existsSync(file)){console.error('دیتابیس موجود نیست؛ گزارشی تولید نشد.');process.exit(1);}
const Database=require('better-sqlite3');
const db=new Database(file,{readonly:true,fileMustExist:true});
try{
 const wanted=['orders','order_items','customers','sessions','reviews','tickets','wishlist','stock_alerts','products','variants'];
 const has=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?");
 console.log('گزارش فقط‌خواندنی؛ هیچ رکوردی پاک یا تغییر داده نمی‌شود.');
 for(const t of wanted)if(has.get(t))console.log(`${t}: ${db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n}`);
}finally{db.close();}
