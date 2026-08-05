#!/usr/bin/env node
/**
 * آزمون ماژول بازاریابی — گام ۳ تفکیک.
 *
 * چرا تمرکز روی این دو محور:
 *   تخفیف **مستقیم روی پرداختی مشتری** اثر می‌گذارد. دو محافظ
 *   باید سالم بمانند:
 *
 *   ۱) **اعتبارسنجی** — درصد بیش از ۱۰۰، تاریخ نامعتبر، دامنه
 *      ناشناخته باید رد شوند. یک جشنواره با درصد اشتباه یعنی
 *      فروش زیر قیمت تمام‌شده.
 *
 *   ۲) **باطل کردن کش** — `activeCampaigns()` پنج ثانیه کش دارد.
 *      اگر `bustCampaignCache()` پس از تغییر صدا زده نشود،
 *      جشنواره تازه تا پنج ثانیه اعمال نمی‌شود و مشتری قیمت
 *      قدیم می‌بیند. این باگ **بی‌صداست**.
 *
 * اجرا: node scripts/test_admin_marketing.js
 */
'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const { db } = require('../src/db');
const { makeStaff } = require('./lib/test_staff');

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

const CODE = 'TESTG3' + Math.random().toString(36).slice(2, 5).toUpperCase();

(async () => {
  console.log('\n  آزمون بازاریابی — گام ۳ تفکیک\n');

  if ((await api('/api/health')).status !== 200) {
    console.log(r('  سرور بالا نیست.\n')); process.exit(1);
  }
  db.prepare("DELETE FROM rate_limits WHERE bucket LIKE 'login%'").run();

  const own = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  const OT = own.json.token;
  if (!OT) { console.log(r('  ورود مدیر ناموفق.\n')); process.exit(1); }

  // ══ ۱) دسترس‌پذیری ══
  console.log(d('  دسترس‌پذیری مسیرها'));

  for (const [p, label] of [
    ['/api/admin/coupons',   'کوپن'],
    ['/api/admin/campaigns', 'جشنواره'],
    ['/api/admin/notices',   'اعلان']
  ]) {
    const res = await api(p, {}, OT);
    add(`GET ${p}`, res.status === 200, `${label}`);
  }

  // ══ ۲) چرخه کامل کوپن ══
  console.log(d('\n  چرخه کوپن'));

  const mk = await api('/api/admin/coupons', {
    method: 'POST',
    /* `type` الزامی است: PERCENT | FIXED | FREE_SHIPPING.
       نخستین اجرای آزمون بدون آن ۴۰۰ گرفت — قرارداد سرور درست
       بود، انتظار آزمون غلط. */
    /* قرارداد واقعی: `type` + `value` (نه `percent`).
       دو بار انتظار آزمون غلط بود و کد سرور درست — یادآوری
       اینکه ماژول تازه باید با API واقعی سنجیده شود نه با حدس. */
    body: JSON.stringify({ code: CODE, type: 'PERCENT', value: 15,
                           max_uses: 5, min_order: 1000000 })
  }, OT);
  add('ساخت کوپن', mk.status === 201 || mk.status === 200,
      `status ${mk.status}`);

  const dbC = db.prepare('SELECT * FROM coupons WHERE code=?').get(CODE);
  add('کوپن در دیتابیس ثبت شد', !!dbC, dbC ? `${dbC.percent}٪` : '');

  const upd = await api(`/api/admin/coupons/${CODE}`, {
    method: 'PUT', body: JSON.stringify({ active: 0 })
  }, OT);
  add('غیرفعال کردن کوپن', upd.status === 200);
  const dbC2 = db.prepare('SELECT active FROM coupons WHERE code=?').get(CODE);
  add('غیرفعالی واقعاً ذخیره شد', dbC2 && dbC2.active === 0);

  /* کوپن غیرفعال نباید در تسویه پذیرفته شود — مرز مالی */
  const val = await api('/api/coupons/validate', {
    method: 'POST', body: JSON.stringify({ code: CODE, subtotal: 2000000 })
  });
  add('🔴 کوپن غیرفعال در تسویه رد می‌شود',
      val.status >= 400 || val.json.valid === false,
      `status ${val.status}`);

  const del = await api(`/api/admin/coupons/${CODE}`, { method: 'DELETE' }, OT);
  add('حذف کوپن', del.status === 200);
  add('حذف واقعاً انجام شد',
      !db.prepare('SELECT 1 FROM coupons WHERE code=?').get(CODE));

  // ══ ۳) اعتبارسنجی — محافظ مالی اول ══
  console.log(d('\n  اعتبارسنجی مالی'));

  const T = 'PERCENT';
  const bads = [
    [{ code: 'BAD1', type: T, value: 150 },       'درصد بیش از ۱۰۰'],
    [{ code: 'BAD2', type: T, value: -5 },        'درصد منفی'],
    [{ code: 'BAD3', type: T, value: 0 },         'درصد صفر'],
    [{ code: '',     type: T, value: 10 },        'کد خالی'],
    [{ code: 'BAD4', type: 'HACK', value: 10 },   'نوع ناشناخته'],
    [{ code: 'BAD5', type: T, value: 10, expires_at: 'دیروز' }, 'تاریخ نامعتبر'],
    [{ code: 'BAD6', type: T, value: 10, starts_at: '2099-01-01',
       expires_at: '2020-01-01' },                'شروع بعد از پایان']
  ];
  let allRejected = true;
  for (const [payload, label] of bads) {
    const res = await api('/api/admin/coupons', {
      method: 'POST', body: JSON.stringify(payload)
    }, OT);
    if (res.status < 400) {
      allRejected = false;
      console.log(d(`      ${label} → پذیرفته شد (${res.status})`));
      if (payload.code) db.prepare('DELETE FROM coupons WHERE code=?').run(payload.code);
    }
  }
  add('🔴 کوپن نامعتبر رد می‌شود', allRejected, `${bads.length} حالت`);

  const badCamp = await api('/api/admin/campaigns', {
    method: 'POST', body: JSON.stringify({ title: 'خطا', percent: 200 })
  }, OT);
  add('🔴 جشنواره با درصد نامعتبر رد می‌شود', badCamp.status >= 400,
      `status ${badCamp.status}`);

  // ══ ۴) باطل کردن کش — محافظ مالی دوم ══
  console.log(d('\n  باطل کردن کش جشنواره'));

  /* این مهم‌ترین بررسی این ماژول است.
     `activeCampaigns()` پنج ثانیه کش دارد. اگر تفکیک،
     `bustCampaignCache()` را از دست بدهد، جشنواره تازه تا پنج
     ثانیه روی قیمت اعمال نمی‌شود — و هیچ خطایی هم نمی‌دهد. */
  const before = await api('/api/campaigns');
  const nBefore = (before.json.campaigns || []).length;

  const camp = await api('/api/admin/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      title: 'آزمون گام ۳', percent: 10, scope: 'ALL',
      starts_at: '2020-01-01', ends_at: '2099-12-31', active: 1
    })
  }, OT);
  add('ساخت جشنواره', camp.status === 201 || camp.status === 200,
      `status ${camp.status}`);

  const campId = camp.json.campaign?.id ||
    db.prepare("SELECT id FROM campaigns WHERE title='آزمون گام ۳' ORDER BY id DESC").get()?.id;

  /* بلافاصله — بدون صبر — باید دیده شود */
  const after = await api('/api/campaigns');
  const nAfter = (after.json.campaigns || []).length;
  add('🔴 جشنواره تازه بی‌درنگ فعال می‌شود', nAfter > nBefore,
      `${nBefore} → ${nAfter}`);

  /* اثر واقعی روی قیمت محصول */
  const prod = await api('/api/products?limit=1');
  const p1 = (prod.json.products || [])[0];
  add('درصد جشنواره روی محصول اعمال شد',
      p1 && p1.campaign_percent === 10,
      p1 ? `${p1.campaign_percent}٪` : 'محصولی نیامد');

  if (campId) {
    const upd2 = await api(`/api/admin/campaigns/${campId}`, {
      method: 'PUT', body: JSON.stringify({ active: 0 })
    }, OT);
    add('غیرفعال کردن جشنواره', upd2.status === 200);

    const after2 = await api('/api/campaigns');
    add('🔴 غیرفعالی بی‌درنگ اعمال می‌شود',
        (after2.json.campaigns || []).length === nBefore,
        `${(after2.json.campaigns || []).length} فعال`);

    const delC = await api(`/api/admin/campaigns/${campId}`, { method: 'DELETE' }, OT);
    add('حذف جشنواره', delC.status === 200);
  }

  // ══ ۵) اعلان ══
  console.log(d('\n  نوار اعلان'));

  const nt = await api('/api/admin/notices', {
    method: 'POST',
    body: JSON.stringify({ text: 'آزمون گام ۳ — اعلان', tone: 'gold', active: 1 })
  }, OT);
  add('ساخت اعلان', nt.status === 201 || nt.status === 200);

  const ntId = nt.json.notice?.id ||
    db.prepare("SELECT id FROM notices ORDER BY id DESC LIMIT 1").get()?.id;

  const pub = await api('/api/notice');
  add('اعلان در سایت دیده می‌شود',
      pub.status === 200 && !!pub.json.notice,
      pub.json.notice ? String(pub.json.notice.text).slice(0, 26) : 'خالی');

  if (ntId) {
    await api(`/api/admin/notices/${ntId}`, { method: 'DELETE' }, OT);
    add('حذف اعلان',
        !db.prepare('SELECT 1 FROM notices WHERE id=?').get(ntId));
  }

  // ══ ۶) کنترل دسترسی ══
  console.log(d('\n  کنترل دسترسی'));

  for (const p of ['/api/admin/coupons', '/api/admin/campaigns', '/api/admin/notices']) {
    const res = await api(p);
    if (res.status !== 401) add(`${p} بدون ورود ۴۰۱`, false, `status ${res.status}`);
  }
  add('بدون ورود ۴۰۱ می‌دهند', true);

  const wh = await makeStaff(api, OT, 'split-step3-wh', 'warehouse');
  if (!wh.token) {
    add('ساخت انباردار آزمایشی', false, wh.error || 'توکن نگرفت');
  } else {
    const noView = await api('/api/admin/coupons', {}, wh.token);
    add('🔴 انباردار کوپن‌ها را نمی‌بیند', noView.status === 403,
        `status ${noView.status}`);

    const noMake = await api('/api/admin/coupons', {
      method: 'POST', body: JSON.stringify({ code: 'HACK1', percent: 90 })
    }, wh.token);
    add('🔴 انباردار کوپن نمی‌سازد', noMake.status === 403,
        `status ${noMake.status}`);
    add('پاسخ ۴۰۳ کامل است', !!noMake.json.error,
        (noMake.json.error || '').slice(0, 38));
    db.prepare("DELETE FROM coupons WHERE code='HACK1'").run();

    if (wh.id) await api(`/api/admin/staff/${wh.id}`, { method: 'DELETE' }, OT);
  }

  // ══ ۷) مسیرهای همسایه ══
  console.log(d('\n  مسیرهای همسایه'));

  let nOk = true;
  for (const [p, want] of [
    ['/api/health', 200], ['/api/products?limit=2', 200],
    ['/api/orders?limit=2', 200], ['/api/admin/low-stock', 200],
    /* `coupons/public` بدون پارامتر `code` عمداً ۴۰۰ می‌دهد —
       رفتار درست است، نه خطا. */
    ['/api/coupons/public?code=NAKOJA', 404], ['/api/campaigns', 200],
    ['/api/admin/reviews', 200]
  ]) {
    const res = await api(p, {}, OT);
    if (res.status !== want) { nOk = false; console.log(d(`      ${p} → ${res.status}`)); }
  }
  add('مسیرهای مجاور دست‌نخورده‌اند', nOk);

  // ══ ۸) ساختار ══
  console.log(d('\n  ساختار'));

  const ROOT = path.dirname(__dirname);
  const mod = fs.readFileSync(path.join(ROOT, 'src/routes/admin-marketing.js'), 'utf8');
  const srv = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');

  add('قرارداد handle درست است',
      /async function handle\(ctx\)/.test(mod) && /module\.exports = \{ handle \}/.test(mod));
  add('sendJSON پوششی دارد', /const sendJSON = \(code, data\) => \{ ctx\.sendJSON/.test(mod));
  add('هیچ can بدون return true نمانده', !/!can\('[^']+'\)\) return;/.test(mod));
  add('bustCampaignCache منتقل شد', /bustCampaignCache\(\)/.test(mod));
  add('server.js ماژول را صدا می‌زند', /routeAdminMarketing\.handle\(/.test(srv));
  add('مسیرهای عمومی کوپن در server.js ماندند',
      /pathname === '\/api\/coupons\/validate'/.test(srv) &&
      /pathname === '\/api\/campaigns'/.test(srv));

  const n = srv.split('\n').length;
  add('server.js کوچک‌تر شد', n < 3600, `${n} خط`);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  بازاریابی سالم است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));
  process.exit(failed === 0 ? 0 : 1);
})();
