#!/usr/bin/env node
/**
 * آزمون حساب مشتری و کارمند.
 *
 * پوشش هشت خواسته:
 *   ۱) فرم سفارش: نام و نام خانوادگی جدا، کد پستی الزامی، ایمیل
 *   ۲) ثبت‌نام مشتری: نام، موبایل، رمز ۸ نویسه‌ای
 *   ۳) نام کاربری مشتری = شماره موبایل
 *   ۴) بازیابی رمز با پیامک
 *   ۵) نام کاربری کارمند = کد ملی
 *   ۶) فرم کارمند: نام، خانوادگی، نقش، کد ملی، موبایل
 *   ۷) رمز موقت تصادفی و مستقل از شماره موبایل
 *   ۸) پیامک اطلاع‌رسانی به کارمند
 *
 * اجرا: node scripts/test_accounts.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const Database = require('better-sqlite3');
const { withStock } = require('./lib/test_stock');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4431;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const TEST_MOBILE = '09190001122';
const TEST_NID = '9990001122';

function cleanup() {
  const db = new Database(DB);
  db.prepare('DELETE FROM customers WHERE mobile=?').run(TEST_MOBILE);
  const st = db.prepare('SELECT id FROM staff WHERE username=?').get(TEST_NID);
  if (st) {
    db.prepare("DELETE FROM sessions WHERE kind='ADMIN' AND subject=?").run(String(st.id));
    db.prepare('DELETE FROM audit_log WHERE staff_id=?').run(st.id);
    db.prepare('DELETE FROM staff WHERE id=?').run(st.id);
  }
  db.prepare("DELETE FROM sessions WHERE kind='CUSTOMER' AND subject=?").run(TEST_MOBILE);
  db.prepare('DELETE FROM otp_codes WHERE mobile=?').run(TEST_MOBILE);
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
}

let logBuf = '';
async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB }
  });
  proc.stdout.on('data', c => { logBuf += c.toString(); });
  proc.stderr.on('data', c => { logBuf += c.toString(); });
  for (let i = 0; i < 45; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

const api = (p, opt = {}, token = null) =>
  fetch(BASE + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opt.headers || {})
    }
  }).then(async res => ({ status: res.status, json: await res.json().catch(() => ({})) }));

(async () => {
  console.log('\n  آزمون حساب مشتری و کارمند\n');
  cleanup();
  const srv = await boot();
  const db = new Database(DB);
  const stockLease = withStock(DB, 1, 20, 'EDP');

  const checks = [];
  const add = (label, ok, note) => {
    console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
    checks.push(ok);
  };
  const finish = (aborted) => {
    try { srv.kill('SIGKILL'); } catch {}
    try { db.close(); } catch {}
    try { stockLease.restore(); } catch {}
    cleanup();
    const failed = checks.filter(x => !x).length;
    console.log();
    if (aborted) { console.log(r('  آزمون نیمه‌کاره رها شد.\n')); process.exit(1); }
    console.log(failed === 0
      ? g('  حساب‌ها سالم‌اند.\n')
      : r(`  ${failed} بررسی ناموفق.\n`));
    process.exit(failed === 0 ? 0 : 1);
  };

  // ══ ۲+۳) ثبت‌نام مشتری ══
  console.log(d('  ثبت‌نام مشتری'));

  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'سارا', last_name: 'کریمی',
      mobile: TEST_MOBILE, password: 'MyPass12345'
    })
  });
  add('ثبت‌نام موفق است', reg.status === 201, `کد ${reg.status}`);
  add('توکن ورود برمی‌گردد', !!reg.json.token);
  add('نام کاربری همان موبایل است',
      reg.json.customer?.mobile === TEST_MOBILE, reg.json.customer?.mobile);
  add('هش رمز در پاسخ لو نمی‌رود',
      !JSON.stringify(reg.json).match(/pass_hash|pass_salt/));

  const shortPw = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'x', mobile: '09190002233', password: '123' })
  });
  add('رمز کمتر از ۸ نویسه رد می‌شود', shortPw.status === 400, `کد ${shortPw.status}`);

  const noName = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ mobile: '09190003344', password: 'GoodPass123' })
  });
  add('نام خالی رد می‌شود', noName.status === 400);

  const badMobile = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'رضا', mobile: '12345', password: 'GoodPass123' })
  });
  add('موبایل نامعتبر رد می‌شود', badMobile.status === 400);

  const dup = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'دیگری', mobile: TEST_MOBILE, password: 'OtherPass123'
    })
  });
  add('موبایل تکراری رد می‌شود', dup.status === 409, `کد ${dup.status}`);

  /* نام خانوادگی اختیاری است — نباید سد راه ثبت‌نام شود.
     محدودیت نرخ ثبت‌نام (۵ بار در نیم ساعت) پیش از این بررسی
     پر می‌شود، پس پاکش می‌کنیم — هدف اینجا سنجش قاعده است نه
     محدودیت نرخ که جدا آزمون دارد. */
  db.prepare('DELETE FROM rate_limits').run();
  const noLast = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'مینا', mobile: '09190009988', password: 'MinaPass123'
    })
  });
  add('نام خانوادگی اختیاری است', noLast.status === 201, `کد ${noLast.status}`);
  db.prepare('DELETE FROM customers WHERE mobile=?').run('09190009988');

  // ══ ورود با رمز ══
  console.log(d('\n  ورود مشتری'));

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ mobile: TEST_MOBILE, password: 'MyPass12345' })
  });
  add('ورود با موبایل و رمز', login.status === 200 && !!login.json.token);

  const wrongPw = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ mobile: TEST_MOBILE, password: 'WrongPass123' })
  });
  add('رمز نادرست رد می‌شود', wrongPw.status === 401);

  const unknown = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ mobile: '09199998877', password: 'Whatever123' })
  });
  /* پیام «حساب نیست» و «رمز غلط» باید یکسان باشد، وگرنه مهاجم
     می‌فهمد چه شماره‌هایی ثبت شده‌اند. */
  add('پیام خطا شماره‌های ثبت‌شده را لو نمی‌دهد',
      unknown.json.error === wrongPw.json.error, unknown.json.error);

  // ══ ۴) بازیابی رمز ══
  console.log(d('\n  بازیابی رمز با پیامک'));

  logBuf = '';
  const forgot = await api('/api/auth/forgot-password', {
    method: 'POST', body: JSON.stringify({ mobile: TEST_MOBILE })
  });
  add('درخواست بازیابی پذیرفته می‌شود', forgot.status === 200);

  const ghost = await api('/api/auth/forgot-password', {
    method: 'POST', body: JSON.stringify({ mobile: '09199997766' })
  });
  add('پاسخ برای شماره ناموجود یکسان است',
      ghost.json.message === forgot.json.message);

  await sleep(500);
  const codeMatch = logBuf.match(/کد ورود:\s*(\d{5})/);
  const code = codeMatch ? codeMatch[1] : null;
  add('کد بازیابی تولید شد', !!code, code || 'در لاگ نبود');

  if (code) {
    const badCode = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        mobile: TEST_MOBILE, code: '00000', new_password: 'NewPass9999'
      })
    });
    add('کد نادرست رد می‌شود', badCode.status === 400);

    const reset = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        mobile: TEST_MOBILE, code, new_password: 'NewPass9999'
      })
    });
    add('رمز با کد درست عوض می‌شود', reset.status === 200, reset.json.error || '');

    const newLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ mobile: TEST_MOBILE, password: 'NewPass9999' })
    });
    add('ورود با رمز تازه ممکن است', newLogin.status === 200);

    const oldLogin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ mobile: TEST_MOBILE, password: 'MyPass12345' })
    });
    add('رمز قدیمی دیگر کار نمی‌کند', oldLogin.status === 401);
  }

  // ══ ۵ تا ۸) کارمند ══
  console.log(d('\n  ساخت کارمند'));

  const ol = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME || 'owner',
      password: process.env.ADMIN_PASSWORD || 'yazd1404'
    })
  });
  if (!ol.json.token) { console.error(r('  ورود مدیر ناموفق')); return finish(true); }
  const OWNER = ol.json.token;

  logBuf = '';
  const staffMobile = '09195556677';
  const mk = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'مهدی', last_name: 'رضایی',
      national_id: TEST_NID, mobile: staffMobile, role_key: 'warehouse'
    })
  }, OWNER);

  add('کارمند با کد ملی ساخته می‌شود', mk.status === 201,
      mk.json.error || `کد ${mk.status}`);
  add('نام کاربری همان کد ملی است',
      mk.json.staff?.username === TEST_NID, mk.json.staff?.username);
  add('نام کامل از دو فیلد ساخته می‌شود',
      mk.json.staff?.display_name === 'مهدی رضایی', mk.json.staff?.display_name);

  /* ۷) رمز تصادفی یک‌بار به مدیر داده می‌شود، نه در لاگ یا پیامک. */
  const expectedPw = mk.json.temp_password;
  add('رمز موقت تصادفی و مستقل از شماره است',
      typeof expectedPw === 'string' && expectedPw.length >= 20 && expectedPw !== staffMobile.replace(/^0+/, ''));
  const phoneGuess = await api('/api/admin/login', {
    method: 'POST', body: JSON.stringify({ username: TEST_NID, password: staffMobile.replace(/^0+/, '') })
  });
  add('شماره موبایل رمز ورود نیست', phoneGuess.status === 401);
  const staffLogin = await api('/api/admin/login', {
    method: 'POST', body: JSON.stringify({ username: TEST_NID, password: expectedPw })
  });
  add('ورود با رمز موقت ممکن است', staffLogin.status === 200);
  add('کارمند باید رمز را عوض کند', staffLogin.json.user?.must_change === true);
  await sleep(400);
  add('حالت console ارسال واقعی ادعا نمی‌کند', mk.json.sms_sent === false);
  add('رمز موقت در لاگ چاپ نمی‌شود', !!expectedPw && !logBuf.includes(expectedPw));
  add('اطلاعات ورود به پیامک لاگ‌شده نمی‌رود', !/حساب کارمندی/.test(logBuf));

  // اعتبارسنجی ورودی
  console.log(d('\n  اعتبارسنجی فرم کارمند'));

  const shortNid = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'a', last_name: 'b', national_id: '123',
      mobile: '09195550000', role_key: 'support'
    })
  }, OWNER);
  add('کد ملی کمتر از ۱۰ رقم رد می‌شود', shortNid.status === 400);

  const dupNid = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'علی', last_name: 'احمدی', national_id: TEST_NID,
      mobile: '09195551111', role_key: 'support'
    })
  }, OWNER);
  add('کد ملی تکراری رد می‌شود', dupNid.status === 409);

  const noLastName = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'علی', national_id: '8880001122',
      mobile: '09195552222', role_key: 'support'
    })
  }, OWNER);
  add('نام خانوادگی کارمند الزامی است', noLastName.status === 400);

  const noMobile = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'علی', last_name: 'احمدی', national_id: '8880002233',
      role_key: 'support'
    })
  }, OWNER);
  add('موبایل کارمند الزامی است', noMobile.status === 400);

  /* ارقام فارسی باید پذیرفته شوند — کاربر ایرانی با کیبورد
     فارسی تایپ می‌کند. */
  const faDigits = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'نرگس', last_name: 'حسینی', national_id: '۷۷۷۰۰۰۱۱۲۲',
      mobile: '09195553333', role_key: 'support'
    })
  }, OWNER);
  add('کد ملی با ارقام فارسی پذیرفته می‌شود', faDigits.status === 201,
      faDigits.json.staff?.username || faDigits.json.error);
  if (faDigits.json.staff) {
    db.prepare('DELETE FROM staff WHERE id=?').run(faDigits.json.staff.id);
  }

  // ══ ۱) فیلدهای سفارش ══
  console.log(d('\n  فیلدهای سفارش'));

  const sku = stockLease.skus[0];
  if (!sku) { add('واریانت آزمایشی', false); return finish(); }

  const order = await api('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customer_name: 'سارا کریمی', first_name: 'سارا', last_name: 'کریمی',
      email: 'sara@example.com', mobile: TEST_MOBILE,
      province: 'یزد', city: 'یزد', address: 'خیابان کاشانی پلاک ۱۲',
      postal_code: '8916945781',
      items: [{ sku, quantity: 1 }]
    })
  });
  add('سفارش با فیلدهای تفکیک‌شده ثبت می‌شود', order.status === 201 || order.status === 200,
      order.json.error || '');

  if (order.json.order_id) {
    const row = db.prepare(
      'SELECT first_name, last_name, email, postal_code FROM orders WHERE order_id=?'
    ).get(order.json.order_id);
    add('نام و نام خانوادگی جدا ذخیره می‌شوند',
        row.first_name === 'سارا' && row.last_name === 'کریمی',
        `${row.first_name} / ${row.last_name}`);
    add('ایمیل ذخیره می‌شود', row.email === 'sara@example.com', row.email);
    add('کد پستی ذخیره می‌شود', row.postal_code === '8916945781');
  }

  finish();
})();
