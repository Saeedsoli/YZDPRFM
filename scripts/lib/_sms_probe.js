/**
 * کاوشگر ماژول پیامک — برای `test_sms_provider.js`.
 *
 * چرا پروسه جدا لازم است: `sms.js` متغیرهای محیطی را هنگام
 * بارگذاری می‌خواند (`const` در سطح ماژول). این تصمیم درستی است —
 * پیکربندی نباید وسط کار عوض شود — ولی یعنی آزمون نمی‌تواند با
 * تغییر `process.env` رفتار را عوض کند. هر سناریو باید در پروسه
 * تازه اجرا شود.
 *
 * نتیجه بین نشانه‌های `__RESULT__` و `__END__` چاپ می‌شود تا از
 * لاگ‌های خود ماژول (که در حالت console متن پیامک را می‌نویسد)
 * قابل تفکیک باشد.
 */
'use strict';

const sms = require('../../src/sms');

const MODE = process.argv[2] || 'send';
const TEST_MOBILE = '09121234567';

(async () => {
  let out;
  try {
    if (MODE === 'send') {
      out = await sms.send(TEST_MOBILE, 'متن آزمایشی عطر یزد', 'TEST');
    } else if (MODE === 'otp') {
      out = await sms.sendOtp(TEST_MOBILE, '12345');
    } else if (MODE === 'health') {
      out = await sms.testConnection();
    } else {
      out = { error: `حالت ناشناخته: ${MODE}` };
    }
  } catch (e) {
    /* اگر اینجا برسیم یعنی ماژول throw کرده — که نباید بکند.
       ثبتش می‌کنیم تا آزمون بگیردش. */
    out = { threw: true, message: e.message };
  }

  console.log(`__RESULT__${JSON.stringify(out)}__END__`);
})();
