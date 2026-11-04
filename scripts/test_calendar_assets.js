'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.join(__dirname,'..','public');
for(const name of fs.readdirSync(root).filter(x=>x.endsWith('.html'))){
 const text=fs.readFileSync(path.join(root,name),'utf8');
 const core=text.indexOf('<script src="/assets/jalaali-core.js"></script>');
 const app=text.indexOf('<script src="/assets/app.js"></script>');
 const date=text.indexOf('<script src="/assets/persian-date.js"></script>');
 if(app>=0)assert(core>=0&&core<app,name+' lacks calendar core before app');
 if(date>=0)assert(core>=0&&core<date,name+' lacks calendar core before date module');
}
const core=fs.readFileSync(path.join(root,'assets/jalaali-core.js'),'utf8');
assert(core.includes('jalaali-js v1.2.8') && core.includes('MIT License') && core.includes('Copyright (c) 2020 Behrang Norouzinia'));
const j=require('../public/assets/jalaali-core');assert.deepEqual(j.toGregorian(1403,12,30),{gy:2025,gm:3,gd:20});
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');assert(sw.includes("'/assets/jalaali-core.js'"));
console.log('PASS calendar asset load order, offline core, bundled upstream version and license');
