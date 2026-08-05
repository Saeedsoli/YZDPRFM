/**
 * عطر یزد | لایه پرداخت قابل‌تعویض
 * ---------------------------------
 * انتخاب درگاه با متغیر محیطی PAYMENT_GATEWAY:
 *   sandbox   → درگاه آزمایشی داخلی (پیش‌فرض)
 *   zarinpal  → زرین‌پال واقعی
 *
 * برای فعال‌سازی زرین‌پال کافیست دو متغیر ست شود:
 *   PAYMENT_GATEWAY=zarinpal
 *   ZARINPAL_MERCHANT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * هیچ تغییری در کد لازم نیست.
 */

const https = require('https');
const crypto = require('crypto');

const GATEWAY     = (process.env.PAYMENT_GATEWAY || 'sandbox').toLowerCase();
const MERCHANT_ID = process.env.ZARINPAL_MERCHANT_ID || '';
const SITE_URL    = process.env.SITE_URL || 'http://localhost:3000';
// زرین‌پال در حالت تست، ساب‌دامین sandbox دارد
const ZP_SANDBOX  = process.env.ZARINPAL_SANDBOX === 'true';
const ZP_HOST     = ZP_SANDBOX ? 'sandbox.zarinpal.com' : 'payment.zarinpal.com';

function postJSON(host, path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      host, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'application/json'
      },
      timeout: 20000
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('پاسخ نامعتبر از درگاه پرداخت')); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('اتصال به درگاه پرداخت برقرار نشد')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * درخواست پرداخت
 * @returns {{ok:boolean, redirect_url?:string, authority?:string, error?:string}}
 */
async function requestPayment({ orderId, amountToman, mobile, description }) {
  if (GATEWAY === 'zarinpal') {
    if (!MERCHANT_ID) {
      return { ok: false, error: 'شناسه پذیرنده زرین‌پال تنظیم نشده است.' };
    }
    try {
      const r = await postJSON(ZP_HOST, '/pg/v4/payment/request.json', {
        merchant_id: MERCHANT_ID,
        amount: amountToman * 10,            // زرین‌پال ریال می‌گیرد
        callback_url: `${SITE_URL}/payment/callback?order=${orderId}`,
        description: description || `سفارش ${orderId} — عطر یزد`,
        metadata: mobile ? { mobile } : undefined
      });

      if (r?.data?.code === 100 && r.data.authority) {
        return {
          ok: true,
          authority: r.data.authority,
          redirect_url: `https://${ZP_HOST}/pg/StartPay/${r.data.authority}`
        };
      }
      const msg = r?.errors?.message || r?.data?.message || 'خطا در ایجاد تراکنش';
      return { ok: false, error: msg };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // درگاه آزمایشی داخلی
  return {
    ok: true,
    authority: 'SBX-' + crypto.randomBytes(8).toString('hex').toUpperCase(),
    redirect_url: `/payment/sandbox?order=${orderId}`
  };
}

/**
 * تأیید پرداخت
 * @returns {{ok:boolean, ref_id?:string, error?:string}}
 */
async function verifyPayment({ authority, amountToman, sandboxResult }) {
  if (GATEWAY === 'zarinpal') {
    try {
      const r = await postJSON(ZP_HOST, '/pg/v4/payment/verify.json', {
        merchant_id: MERCHANT_ID,
        amount: amountToman * 10,
        authority
      });
      // 100 = موفق، 101 = قبلاً تأیید شده
      if (r?.data?.code === 100 || r?.data?.code === 101) {
        return { ok: true, ref_id: String(r.data.ref_id || authority) };
      }
      return { ok: false, error: r?.errors?.message || 'پرداخت تأیید نشد' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // آزمایشی
  if (sandboxResult === 'success') {
    return { ok: true, ref_id: 'SANDBOX-' + crypto.randomBytes(6).toString('hex').toUpperCase() };
  }
  return { ok: false, error: 'پرداخت توسط کاربر لغو شد' };
}

function gatewayName() {
  return GATEWAY === 'zarinpal'
    ? (ZP_SANDBOX ? 'ZARINPAL_SANDBOX' : 'ZARINPAL')
    : 'SANDBOX';
}

function isLive() { return GATEWAY === 'zarinpal' && !!MERCHANT_ID && !ZP_SANDBOX; }

/**
 * بررسی سلامت پیکربندی درگاه — بدون ثبت تراکنش واقعی.
 *
 * چرا این تابع لازم شد: تنها راه فهمیدن اینکه Merchant ID درست
 * است، رفتن مشتری تا صفحه پرداخت بود. اگر شناسه غلط بود، اولین
 * خریدار واقعی با خطا روبه‌رو می‌شد و احتمالاً برنمی‌گشت.
 *
 * روش: یک درخواست پرداخت با کمترین مبلغ مجاز (۱۰۰۰ تومان) ساخته
 * می‌شود. زرین‌پال `authority` می‌دهد ولی چون هیچ‌کس روی لینک
 * نمی‌رود، تراکنشی انجام نمی‌شود و ظرف مدت کوتاهی منقضی می‌گردد.
 * هزینه‌ای ندارد و پولی جابه‌جا نمی‌شود.
 *
 * شناسه پذیرنده هرگز کامل برنمی‌گردد.
 */
async function testConnection() {
  const masked = MERCHANT_ID
    ? '••••••••-••••-••••-••••-' + MERCHANT_ID.slice(-6)
    : null;

  if (GATEWAY !== 'zarinpal') {
    return {
      ok: true, live: false, gateway: 'sandbox',
      merchant_set: !!MERCHANT_ID, merchant_hint: masked,
      message: 'درگاه آزمایشی داخلی — هیچ پرداخت واقعی انجام نمی‌شود.',
      hint: 'برای پرداخت واقعی: PAYMENT_GATEWAY=zarinpal و ZARINPAL_MERCHANT_ID را ست کنید.'
    };
  }

  if (!MERCHANT_ID) {
    return {
      ok: false, live: false, gateway: 'zarinpal',
      merchant_set: false, merchant_hint: null,
      message: 'زرین‌پال انتخاب شده ولی ZARINPAL_MERCHANT_ID خالی است.',
      hint: 'liara env set ZARINPAL_MERCHANT_ID="..." --app yazdperfume'
    };
  }

  /* شناسه پذیرنده زرین‌پال دقیقاً ۳۶ نویسه UUID است. بررسی شکل
     پیش از تماس با شبکه، خطای واضح‌تری می‌دهد تا «کد ۱۰۱ نامعتبر». */
  const shapeOk = /^[0-9a-fA-F-]{36}$/.test(MERCHANT_ID);
  if (!shapeOk) {
    return {
      ok: false, live: false, gateway: 'zarinpal',
      merchant_set: true, merchant_hint: masked,
      message: 'قالب شناسه پذیرنده درست نیست — باید UUID ۳۶ نویسه‌ای باشد.',
      hint: 'نمونه: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
    };
  }

  try {
    const r = await postJSON(ZP_HOST, '/pg/v4/payment/request.json', {
      merchant_id: MERCHANT_ID,
      amount: 10000,                                  // ۱۰۰۰ تومان = کمترین مبلغ
      callback_url: `${SITE_URL}/payment/callback?order=HEALTHCHECK`,
      description: 'بررسی سلامت پیکربندی — عطر یزد'
    });

    if (r?.data?.code === 100) {
      return {
        ok: true, live: !ZP_SANDBOX, gateway: gatewayName(),
        merchant_set: true, merchant_hint: masked,
        message: ZP_SANDBOX
          ? 'اتصال به سندباکس زرین‌پال برقرار است (پرداخت واقعی نیست).'
          : 'اتصال به زرین‌پال برقرار است و شناسه پذیرنده معتبر است.',
        warning: ZP_SANDBOX
          ? 'ZARINPAL_SANDBOX=true است — برای فروش واقعی باید حذف شود.'
          : undefined
      };
    }

    return {
      ok: false, live: false, gateway: gatewayName(),
      merchant_set: true, merchant_hint: masked,
      message: r?.errors?.message || r?.data?.message || 'شناسه پذیرنده پذیرفته نشد.',
      code: r?.errors?.code ?? r?.data?.code ?? null
    };
  } catch (e) {
    return {
      ok: false, live: false, gateway: gatewayName(),
      merchant_set: true, merchant_hint: masked,
      message: `اتصال برقرار نشد: ${e.message}`
    };
  }
}

module.exports = {
  requestPayment, verifyPayment, gatewayName, isLive, testConnection, GATEWAY
};
