'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../public/privacy.html'),'utf8');
assert(!html.includes('رمز عبوری ذخیره نمی‌کنیم'));
for(const text of ['نسخه هش‌شده','ارائه‌دهنده پیامک','درگاه پرداخت','آمار داخلی بازدید و جستجو','تضمین نمی‌کند'])assert(html.includes(text),text);
console.log('PASS privacy page no longer claims passwords or provider processing do not exist');
