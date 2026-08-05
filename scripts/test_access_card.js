#!/usr/bin/env node
/**
 * آزمون «کارت دسترسی من» و ابزار بازسازی ایندکس.
 *
 * چه چیزی سنجیده می‌شود:
 *   ۱) کارمند فهرست دقیق مجوزهایش را می‌بیند، نه فقط یک عدد
 *   ۲) کارهایی که **نمی‌تواند** هم نشان داده می‌شوند
 *   ۳) شرح نقش برمی‌گردد
 *   ۴) نقش‌های مختلف دید متفاوت می‌گیرند
 *   ۵) هیچ داده حساسی (هش رمز) نشت نمی‌کند
 *   ۶) بازسازی ایندکس فقط با مجوز نگهداشت
 *   ۷) سیم‌کشی رابط
 *
 * چرا این آزمون لازم است:
 *   پیش‌تر پنل فقط می‌گفت «۳۴ مجوز». کارمند نمی‌دانست کدام کارها
 *   از او برمی‌آید و کدام نه — و وقتی به دیوار می‌خورد، نمی‌فهمید
 *   اشتباه کرده یا سیستم خراب است.
 *
 * اجرا: node scripts/test_access_card.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { makeStaff } = require('./lib/test_staff');

const ROOT = path.dirname(__dirname);
const PORT = process.env.PORT || 3000;
const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

function api(p, opt = {}, token) {
  return new Promise(res => {
    const body = opt.body || null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: opt.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      }
    }, x => {
      let b = '';
      x.on('data', c => b += c);
      x.on('end', () => {
        let json = null;
        try { json = JSON.parse(b); } catch {}
        res({ status: x.statusCode, json: json || {}, raw: b });
      });
    });
    req.on('error', () => res({ status: 0, json: {}, raw: '' }));
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  console.log('\n  آزمون کارت دسترسی کارمند\n');

  const health = await api('/api/health');
  if (health.status !== 200) {
    console.log(r('\n  سرور بالا نیست.\n'));
    process.exit(1);
  }

  const own = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const OT = own.json.token;
  if (!OT) { console.log(r('  ورود مدیر ناموفق.\n')); process.exit(1); }

  // ══ ۱) دید مدیر کل ══
  console.log(d('  مدیر کل'));

  const o = await api('/api/admin/me/activity?days=7', {}, OT);
  const op = o.json.profile || {};
  const oa = o.json.access || {};

  add('کارت دسترسی برمی‌گردد', !!oa.granted && Array.isArray(oa.granted));
  add('شرح نقش برمی‌گردد', !!op.role_description,
      (op.role_description || '').slice(0, 44));
  add('شمار کل مجوزها برمی‌گردد', op.total_permissions === 34,
      `${op.permission_count} از ${op.total_permissions}`);
  add('مدیر کل همه مجوزها را دارد',
      op.permission_count === op.total_permissions);
  add('مدیر کل هیچ مورد ممنوعی ندارد', (oa.denied || []).length === 0);

  const flat = (oa.granted || []).flatMap(x => x.items);
  add('مجوزها گروه‌بندی شده‌اند', (oa.granted || []).length === 10,
      `${(oa.granted || []).length} گروه`);
  add('هر مجوز برچسب فارسی دارد',
      flat.every(i => i.label && i.label.length > 2), `${flat.length} مجوز`);
  add('مجوزهای خطرناک علامت دارند',
      flat.some(i => i.danger === true),
      `${flat.filter(i => i.danger).length} خطرناک`);
  add('راهنمای مجوز برمی‌گردد',
      flat.some(i => i.hint && i.hint.length > 5));

  // ══ ۲) دید نقش محدود ══
  console.log(d('\n  انباردار'));

  const wh = await makeStaff(api, OT, 'access-card-wh', 'warehouse');
  if (!wh.token) {
    add('ساخت انباردار آزمایشی', false, wh.error || 'توکن نگرفت');
  } else {
    const w = await api('/api/admin/me/activity?days=7', {}, wh.token);
    const wp = w.json.profile || {};
    const wa = w.json.access || {};

    add('انباردار کارت دسترسی می‌بیند', !!wa.granted);
    add('انباردار مجوز کمتری دارد',
        wp.permission_count < 34 && wp.permission_count > 0,
        `${wp.permission_count} از ${wp.total_permissions}`);
    add('موارد ممنوع نشان داده می‌شوند', (wa.denied || []).length > 0,
        `${(wa.denied || []).flatMap(x => x.items).length} مورد ممنوع`);

    const gk = (wa.granted || []).flatMap(x => x.items).map(i => i.key);
    const dk = (wa.denied || []).flatMap(x => x.items).map(i => i.key);

    add('مجوز واقعی در فهرست مجاز است', gk.includes('products.stock'));
    add('مجوز نداشته در فهرست ممنوع است', dk.includes('reports.sales'),
        'گزارش فروش');
    add('مجاز و ممنوع هم‌پوشانی ندارند',
        !gk.some(k => dk.includes(k)));
    add('جمع مجاز و ممنوع برابر کل است',
        gk.length + dk.length === 34, `${gk.length}+${dk.length}`);

    add('شرح نقش انباردار درست است',
        /قیمت/.test(wp.role_description || ''),
        (wp.role_description || '').slice(0, 40));

    // ══ ۳) نشت نکردن ══
    console.log(d('\n  امنیت'));

    add('هش رمز نشت نمی‌کند',
        !/pass_hash|pass_salt/.test(w.raw));
    add('مجوز کارمند دیگر دیده نمی‌شود',
        wp.username === wh.nid, wp.username);

    const rx = await api('/api/admin/reindex', { method: 'POST', body: '{}' },
      wh.token);
    add('انباردار نمی‌تواند ایندکس بازسازی کند', rx.status === 403,
        `status ${rx.status}`);
  }

  // ══ ۴) نقش دیگر برای مقایسه ══
  console.log(d('\n  محتوانویس'));

  const ed = await makeStaff(api, OT, 'access-card-ed', 'editor');
  if (ed.token) {
    const e = await api('/api/admin/me/activity?days=7', {}, ed.token);
    const ea = e.json.access || {};
    const ek = (ea.granted || []).flatMap(x => x.items).map(i => i.key);
    add('محتوانویس دسترسی متفاوت دارد',
        ek.includes('content.write') && !ek.includes('products.stock'),
        `${ek.length} مجوز`);
    const edk = (ea.denied || []).flatMap(x => x.items).map(i => i.key);
    add('نبود دسترسی سفارش صریح اعلام می‌شود',
        edk.includes('orders.view'));
  }

  // ══ ۵) بازسازی ایندکس ══
  console.log(d('\n  بازسازی ایندکس'));

  const rx = await api('/api/admin/reindex', { method: 'POST', body: '{}' }, OT);
  add('مدیر می‌تواند ایندکس بازسازی کند', rx.status === 200,
      rx.json.message);
  add('شمار محصول گزارش می‌شود', rx.json.products > 2000,
      `${rx.json.products} محصول`);
  add('شمار نُت گزارش می‌شود', rx.json.note_rows > 10000,
      `${rx.json.note_rows} ردیف`);

  /* بازسازی نباید داده را خراب کند — همان تعداد باید بماند */
  const after = await api('/api/notes?min=40&limit=5');
  add('پس از بازسازی، فیلتر نُت سالم است',
      (after.json.notes || []).length === 5);
  const chk = (after.json.notes || [])[0];
  if (chk) {
    const pr = await api('/api/products?note=' +
      encodeURIComponent(chk.note) + '&limit=1');
    add('شمار نُت پس از بازسازی درست است',
        pr.json.total === chk.count, `${chk.note}: ${pr.json.total}`);
  }

  const noAuth = await api('/api/admin/reindex', { method: 'POST', body: '{}' });
  add('بدون ورود ۴۰۱ می‌دهد', noAuth.status === 401);

  // ══ ۶) سیم‌کشی رابط ══
  console.log(d('\n  سیم‌کشی رابط'));

  const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
  add('بخش کارت دسترسی در پنل هست', /id="accessCard"/.test(adm));
  add('موارد مجاز رندر می‌شوند', /access\.granted/.test(adm));
  add('موارد ممنوع رندر می‌شوند', /access\.denied/.test(adm));
  add('شرح نقش نمایش داده می‌شود', /role_description/.test(adm));
  add('مجوز خطرناک متمایز است', /perm-danger|\.danger/.test(adm));
  add('دکمه بازسازی ایندکس هست', /reindex/.test(adm));
  add('محتوا پیش از درج فرار داده می‌شود',
      /esc\(i\.label\)|esc\(p\.role_description\)/.test(adm));

  // پاک‌سازی
  for (const s of [wh, ed]) {
    if (s && s.id) await api(`/api/admin/staff/${s.id}`, { method: 'DELETE' }, OT);
  }

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  کارت دسترسی درست کار می‌کند.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
