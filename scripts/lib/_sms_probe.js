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

    out = { threw: true, message: e.message };
  }

  console.log(`__RESULT__${JSON.stringify(out)}__END__`);
})();
