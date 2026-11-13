#!/usr/bin/env node

'use strict';

const { _internals, PROVIDER } = require('../src/sms');
const { looksSuccessful, readPanelValue, PANEL_ERRORS, formBody } = _internals;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const h = s => `\x1b[1m${s}\x1b[0m`;

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

const mk = (value, retStatus = 1, status = 200) => ({
  status,
  body: JSON.stringify({ Value: String(value), RetStatus: retStatus,
                         StrRetStatus: retStatus === 1 ? 'Ok' : 'Error' }),
  json: { Value: String(value), RetStatus: retStatus,
          StrRetStatus: retStatus === 1 ? 'Ok' : 'Error' }
});

(async () => {
  console.log();
  console.log(h('  آزمون تفسیر پاسخ سرویس پیامک'));
  console.log(d('  ─────────────────────────────────────────────'));

  console.log();
  console.log(h('  ۱) ارسال موفق'));

  const okRes = looksSuccessful(mk('1234567890123456'));
  add('شناسه ۱۶ رقمی موفق است', okRes.ok === true, 'recId');
  add('شناسه ۱۰ رقمی موفق است', looksSuccessful(mk('1234567890')).ok === true);

  const v = readPanelValue('987654321098765');
  add('شناسه ارسال برگردانده می‌شود', v.ok && v.recId === '987654321098765');

  console.log();
  console.log(h('  ۲) کدهای خطا — همه باید ناموفق باشند'));

  let allFail = true, allTranslated = true;
  const missed = [];
  for (const code of Object.keys(PANEL_ERRORS)) {
    const res = looksSuccessful(mk(code));
    if (res.ok) { allFail = false; missed.push(code); }
    if (!res.message || /^\d/.test(res.message)) allTranslated = false;
  }
  add(`هر ${Object.keys(PANEL_ERRORS).length} کد خطا ناموفق است`,
      allFail, missed.length ? `جا افتاد: ${missed.join(', ')}` : '');
  add('هر کد پیام فارسی دارد', allTranslated, 'مدیر عدد خام نمی‌بیند');

  const cases = [
    ['0',    'نام کاربری یا کلید'],
    ['2',    'اعتبار'],
    ['5',    'فرستنده'],
    ['35',   'لیست سیاه'],
    ['-110', 'ApiKey'],
    ['-109', 'IP']
  ];
  cases.forEach(([code, expect]) => {
    const res = looksSuccessful(mk(code));
    add(`کد ${code} → پیام درست`,
        !res.ok && (res.message || '').includes(expect),
        (res.message || '').slice(0, 52));
  });

  console.log();
  console.log(h('  ۳) تله — خطا با HTTP 200'));

  const trap = looksSuccessful(mk('0', 1, 200));
  add('کد خطای ۰ با HTTP 200 ناموفق است', trap.ok === false,
      'نسخه پیشین این را موفق می‌شمرد');

  add('کد ۳۵ مثبت است ولی خطاست',
      looksSuccessful(mk('35')).ok === false,
      'معیار طول عدد است نه علامت');

  const retFail = looksSuccessful(mk('123', 0, 200));
  add('‏RetStatus=0 ناموفق است', retFail.ok === false);

  console.log();
  console.log(h('  ۴) پاسخ غیرمنتظره — محافظه‌کارانه'));

  const html = { status: 200, body: '<html>خطای سرور</html>', json: null };
  add('پاسخ HTML ناموفق است', looksSuccessful(html).ok === false,
      'در تردید، ناموفق');

  add('پاسخ خالی ناموفق است',
      looksSuccessful({ status: 200, body: '', json: null }).ok === false);

  add('‏HTTP 500 ناموفق است',
      looksSuccessful({ status: 500, body: '', json: null }).ok === false);

  const plain = looksSuccessful({ status: 200, body: '  2  ', json: null });
  add('پاسخ متنیِ کد خطا هم تفسیر می‌شود',
      plain.ok === false && /اعتبار/.test(plain.message || ''),
      (plain.message || '').slice(0, 40));

  const plainOk = looksSuccessful({ status: 200, body: '1234567890123', json: null });
  add('پاسخ متنیِ شناسه موفق است', plainOk.ok === true);

  console.log();
  console.log(h('  ۵) قالب بدنه درخواست'));

  const body = formBody({ username: 'u', password: 'k', to: '09121110000',
                          from: '5000', text: 'سلام دنیا', empty: '' });
  add('قالب form-urlencoded است', body.includes('&') && !body.startsWith('{'),
      'این سرویس JSON نمی‌پذیرد');
  add('فیلد خالی حذف می‌شود', !body.includes('empty='));
  add('متن فارسی کدگذاری می‌شود', /%D8|%DB/.test(body));
  add('همه فیلدهای لازم هست',
      ['username', 'password', 'to', 'from', 'text'].every(k => body.includes(k + '=')));

  console.log();
  console.log(h('  ۶) سازگاری با کاوه‌نگار'));

  const kav = { status: 200, json: { return: { status: 200, message: 'ok' } }, body: '' };
  add('پاسخ موفق کاوه‌نگار شناخته می‌شود', looksSuccessful(kav).ok === true);
  const kavBad = { status: 200, json: { return: { status: 418, message: 'خطا' } }, body: '' };
  add('پاسخ ناموفق کاوه‌نگار شناخته می‌شود', looksSuccessful(kavBad).ok === false);

  console.log();
  console.log(h('  ۷) پیکربندی فعلی'));

  add('حالت فعلی console است', PROVIDER === 'console',
      `SMS_PROVIDER=${PROVIDER} — پیامک واقعی ارسال نمی‌شود`);

  const failed = checks.filter(x => !x).length;
  console.log();
  console.log(failed === 0
    ? g(`  تفسیر پاسخ سرویس پیامک درست است.  ${checks.length}/${checks.length}\n`)
    : r(`  ${failed} بررسی ناموفق از ${checks.length}.\n`));

  console.log(d('  توجه: این آزمون منطق را می‌سنجد، نه اتصال واقعی.'));
  console.log(d('  تأیید نهایی نیازمند یک پیامک واقعی است.\n'));
  process.exit(failed === 0 ? 0 : 1);
})();
