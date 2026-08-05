#!/usr/bin/env node
/**
 * آزمون دعوت‌نامه نظر — مشتریان ۱۲ سال فروش حضوری.
 *
 * چرا این آزمون مهم است: دعوت‌نامه یک **کلید دسترسی** است. هر
 * ضعفی در آن یعنی کسی می‌تواند نظر جعلی با نشان «تأییدشده» ثبت
 * کند — یعنی همان سازوکاری که قرار بود اعتماد بسازد، تبدیل به
 * ابزار فریب می‌شود. ضرر اینجا اعتبار برند است، نه پول.
 *
 * پوشش:
 *   • ساخت دعوت‌نامه فقط با مجوز reviews.invite
 *   • توکن تصادفی، ۳۲ نویسه، غیرقابل حدس
 *   • مشتری بدون حساب کاربری می‌تواند نظر بدهد
 *   • یک‌بارمصرف بودن — حتی زیر درخواست همزمان
 *   • توکن جعلی، منقضی و دستکاری‌شده رد می‌شود
 *   • نظر با منشأ INVITED ثبت و نشان جدا می‌گیرد
 *   • نظر تا تأیید مدیر منتشر نمی‌شود
 *   • دعوت تکراری دوباره ساخته نمی‌شود
 *   • شماره مشتری هرگز کامل لو نمی‌رود
 *   • صفحه /review/:token سرو می‌شود و noindex است
 *
 * اجرا: node scripts/test_review_invites.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4462;
const BASE = `http://127.0.0.1:${PORT}`;

const g = s => `\x1b[32m${s}\x1b[0m`;
const r = s => `\x1b[31m${s}\x1b[0m`;
const d = s => `\x1b[2m${s}\x1b[0m`;
const sleep = ms => new Promise(res => setTimeout(res, ms));

const checks = [];
const add = (label, ok, note) => {
  console.log(`  ${ok ? g('✓') : r('✗')} ${label}${note ? d('  — ' + note) : ''}`);
  checks.push(ok);
};

const MOB = '09120009911';       // شماره آزمایشی
const MOB2 = '09120009922';

function cleanup() {
  /* اگر جدول هنوز ساخته نشده (اولین اجرا پیش از بالا آمدن سرور)،
     پاک‌سازی نباید کل آزمون را بترکاند. */
  const db = new Database(DB);
  const has = n => !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
  try {
    if (has('review_invites'))
      db.prepare('DELETE FROM review_invites WHERE mobile IN (?,?)').run(MOB, MOB2);
    db.prepare('DELETE FROM reviews WHERE mobile IN (?,?)').run(MOB, MOB2);
    db.prepare('DELETE FROM rate_limits').run();
  } finally { db.close(); }
}

async function boot() {
  const proc = spawn('node', ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, BACKUP_DISABLED: '1', PORT: String(PORT), DB_PATH: DB },
    stdio: 'ignore'
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return proc; } catch {}
    await sleep(400);
  }
  return proc;
}

const api = (p, opt = {}, tok = null) =>
  fetch(BASE + p, {
    ...opt,
    headers: {
      'Content-Type': 'application/json',
      ...(tok ? { Authorization: 'Bearer ' + tok } : {}),
      ...(opt.headers || {})
    }
  }).then(async x => ({ status: x.status, body: await x.json().catch(() => ({})) }));

(async () => {
  console.log('\n  آزمون دعوت‌نامه نظر — مشتریان فروش حضوری\n');
  cleanup();

  const srv = await boot();

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    cleanup();
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('دعوت‌نامه نظر امن و درست کار می‌کند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    const db = new Database(DB);
    const P = db.prepare('SELECT id, slug, name_fa, brand_fa FROM products LIMIT 1').get();
    const P2 = db.prepare('SELECT id, slug, name_fa FROM products LIMIT 1 OFFSET 1').get();
    db.close();

    const login = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        username: process.env.ADMIN_USERNAME || 'owner',
        password: process.env.ADMIN_PASSWORD || 'yazd1404'
      })
    });
    const TOK = login.body.token;
    add('ورود مدیر', !!TOK);
    if (!TOK) return finish();

    // ─────────────────────────────────────────────
    console.log('\n  ── دسترسی ──');

    {
      const noAuth = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: P.slug, mobile: MOB })
      });
      add('ساخت دعوت بدون ورود ممکن نیست',
        noAuth.status === 401 || noAuth.status === 403, `status ${noAuth.status}`);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── ساخت دعوت‌نامه ──');

    let TOKEN = null;
    {
      const mk = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: P.slug, mobile: MOB, note: 'مشتری قدیمی' })
      }, TOK);
      add('دعوت‌نامه ساخته شد', mk.status === 201, `status ${mk.status} ${mk.body.error || ''}`);
      TOKEN = mk.body.token;

      add('توکن ۳۲ نویسه hex است (غیرقابل حدس)',
        /^[a-f0-9]{32}$/.test(TOKEN || ''), TOKEN);
      add('نشانی صفحه برگردانده می‌شود', mk.body.url === `/review/${TOKEN}`);
      add('متن آماده پیامک تولید می‌شود',
        typeof mk.body.sms_text === 'string' && mk.body.sms_text.includes(TOKEN));
      add('مهلت اعتبار تعیین شده',
        !!mk.body.expires_at && new Date(mk.body.expires_at) > new Date());
    }

    {
      /* دو دعوت پیاپی نباید دو توکن بدهند — مدیر ممکن است دوبار
         کلیک کند و دو پیامک بفرستد که مشتری را گیج می‌کند. */
      const again = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: P.slug, mobile: MOB })
      }, TOK);
      add('دعوت تکراری همان لینک قبلی را برمی‌گرداند',
        again.body.token === TOKEN && again.body.reused === true,
        again.body.reused ? 'reused' : 'توکن تازه ساخت!');
    }

    {
      const badMobile = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: P.slug, mobile: '12345' })
      }, TOK);
      add('شماره نامعتبر رد می‌شود', badMobile.status === 400, `status ${badMobile.status}`);

      const badProduct = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: 'محصول-نامعتبر-xyz', mobile: MOB2 })
      }, TOK);
      add('محصول نامعتبر رد می‌شود', badProduct.status === 404, `status ${badProduct.status}`);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── مشتری لینک را باز می‌کند (بدون حساب کاربری) ──');

    {
      const view = await api(`/api/review-invite/${TOKEN}`);
      add('دعوت‌نامه بدون ورود خوانده می‌شود', view.status === 200, `status ${view.status}`);
      add('نام محصول برگردانده می‌شود', view.body.product?.id === P.id);
      add('شماره ماسک‌شده است — کامل لو نمی‌رود',
        view.body.mobile_masked === '0912****11'
        && !JSON.stringify(view.body).includes(MOB),
        view.body.mobile_masked);
    }

    {
      const fake = await api('/api/review-invite/' + 'f'.repeat(32));
      add('توکن جعلی رد می‌شود', fake.status === 410, `status ${fake.status}`);

      const malformed = await api('/api/review-invite/abc');
      add('توکن بدشکل رد می‌شود', malformed.status === 410, `status ${malformed.status}`);

      /* تلاش برای پیمایش مسیر — نباید فایلی لو برود */
      const trav = await fetch(`${BASE}/api/review-invite/..%2F..%2Fetc%2Fpasswd`);
      add('پیمایش مسیر در توکن بی‌اثر است', trav.status === 410 || trav.status === 404,
        `status ${trav.status}`);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── اعتبارسنجی ورودی نظر ──');

    {
      const noRating = await api('/api/review-invite', {
        method: 'POST',
        body: JSON.stringify({ token: TOKEN, body: 'متن به اندازه کافی طولانی برای عبور' })
      });
      add('نظر بدون امتیاز رد می‌شود', noRating.status === 400, `status ${noRating.status}`);

      const badRating = await api('/api/review-invite', {
        method: 'POST',
        body: JSON.stringify({ token: TOKEN, rating: 9, body: 'متن به اندازه کافی طولانی' })
      });
      add('امتیاز خارج از بازه ۱ تا ۵ رد می‌شود', badRating.status === 400);

      const shortBody = await api('/api/review-invite', {
        method: 'POST',
        body: JSON.stringify({ token: TOKEN, rating: 5, body: 'کم' })
      });
      add('متن کوتاه‌تر از ۱۰ حرف رد می‌شود', shortBody.status === 400);

      /* هیچ‌کدام از تلاش‌های ناموفق نباید دعوت را بسوزاند */
      const still = await api(`/api/review-invite/${TOKEN}`);
      add('دعوت پس از تلاش ناموفق همچنان معتبر است', still.status === 200);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── ثبت نظر ──');

    {
      const XSS = '<img src=x onerror=alert(1)>تجربه من از این عطر بسیار خوب بود';
      const send = await api('/api/review-invite', {
        method: 'POST',
        body: JSON.stringify({
          token: TOKEN, rating: 4,
          display_name: 'رضا م.', title: 'ماندگاری خوب',
          body: XSS, longevity: 4, sillage: 3
        })
      });
      add('نظر ثبت شد', send.status === 201, `status ${send.status} ${send.body.error || ''}`);

      const db2 = new Database(DB);
      const rev = db2.prepare('SELECT * FROM reviews WHERE mobile=?').get(MOB);
      const inv = db2.prepare('SELECT * FROM review_invites WHERE token=?').get(TOKEN);
      db2.close();

      add('منشأ نظر INVITED ثبت شد', rev?.source === 'INVITED', rev?.source);
      add('نشان تأیید گرفت', rev?.verified === 1);
      add('وضعیت PENDING است — بدون تأیید مدیر منتشر نمی‌شود',
        rev?.status === 'PENDING', rev?.status);
      add('امتیاز و ماندگاری درست ذخیره شد',
        rev?.rating === 4 && rev?.longevity === 4 && rev?.sillage === 3);
      add('کد مخرب در متن خنثی شد',
        !/<img|onerror/i.test(rev?.body || ''), (rev?.body || '').slice(0, 40));
      add('دعوت‌نامه مصرف شد', !!inv?.used_at);
      add('نظر به دعوت‌نامه گره خورد', inv?.review_id === rev?.id);
    }

    {
      const reuse = await api('/api/review-invite', {
        method: 'POST',
        body: JSON.stringify({ token: TOKEN, rating: 1, body: 'تلاش برای استفاده دوباره' })
      });
      add('لینک استفاده‌شده دوباره کار نمی‌کند', reuse.status === 410, `status ${reuse.status}`);

      const view = await api(`/api/review-invite/${TOKEN}`);
      add('صفحه لینک مصرف‌شده پیام سپاسگزارانه می‌دهد نه خطا',
        view.status === 410 && view.body.used === true);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── یک‌بارمصرف بودن زیر درخواست همزمان ──');

    {
      /* بدترین حالت: مشتری روی دکمه دوبار می‌زند، یا لینک را در
         دو تب باز می‌کند. بدون اتمی بودن، هر دو از بررسی رد
         می‌شوند و دو نظر ثبت می‌شود. */
      const mk = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: P2.slug, mobile: MOB2 })
      }, TOK);
      const T2 = mk.body.token;

      const results = await Promise.all(Array.from({ length: 8 }, (_, i) =>
        api('/api/review-invite', {
          method: 'POST',
          body: JSON.stringify({
            token: T2, rating: 5,
            body: `تلاش همزمان شماره ${i} با متن به اندازه کافی طولانی`
          })
        })));

      const ok = results.filter(x => x.status === 201).length;
      add('از ۸ درخواست همزمان فقط یکی موفق می‌شود', ok === 1, `${ok} موفق`);

      const db3 = new Database(DB);
      const n = db3.prepare('SELECT COUNT(*) c FROM reviews WHERE mobile=?').get(MOB2).c;
      db3.close();
      add('فقط یک نظر در دیتابیس ثبت شد', n === 1, `${n} نظر`);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── دعوت منقضی ──');

    {
      const mk = await api('/api/admin/review-invites', {
        method: 'POST',
        body: JSON.stringify({ product: P.slug, mobile: MOB2 })
      }, TOK);
      const T3 = mk.body.token;

      const db4 = new Database(DB);
      db4.prepare("UPDATE review_invites SET expires_at='2020-01-01T00:00:00.000Z' WHERE token=?")
        .run(T3);
      db4.close();

      const view = await api(`/api/review-invite/${T3}`);
      add('دعوت منقضی خوانده نمی‌شود', view.status === 410, `status ${view.status}`);

      const send = await api('/api/review-invite', {
        method: 'POST',
        body: JSON.stringify({ token: T3, rating: 5, body: 'متن به اندازه کافی طولانی است' })
      });
      add('با دعوت منقضی نظر ثبت نمی‌شود', send.status === 410);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── نمایش عمومی نظر ──');

    {
      const db5 = new Database(DB);
      const rev = db5.prepare('SELECT id FROM reviews WHERE mobile=?').get(MOB);
      db5.close();

      const before = await api(`/api/reviews/${P.slug}`);
      add('نظر تأییدنشده روی سایت دیده نمی‌شود',
        !(before.body.reviews || []).some(x => x.id === rev.id));

      await api(`/api/admin/reviews/${rev.id}`, {
        method: 'PUT', body: JSON.stringify({ status: 'APPROVED' })
      }, TOK);

      const after = await api(`/api/reviews/${P.slug}`);
      const shown = (after.body.reviews || []).find(x => x.id === rev.id);
      add('پس از تأیید مدیر منتشر می‌شود', !!shown);
      add('منشأ INVITED به فرانت می‌رسد (برای نشان جدا)',
        shown?.source === 'INVITED', shown?.source);
      add('نام نمایشی همان است که مشتری نوشت', shown?.display_name === 'رضا م.');
      add('شماره مشتری در پاسخ عمومی نیست',
        !JSON.stringify(after.body).includes(MOB));
      add('خلاصه امتیاز به‌روز شد', after.body.summary?.count >= 1);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── فهرست مدیریت ──');

    {
      const list = await api('/api/admin/review-invites', {}, TOK);
      add('فهرست دعوت‌نامه‌ها خوانده می‌شود', list.status === 200);
      const mine = (list.body.invites || []).find(x => x.token === TOKEN);
      add('وضعیت محاسبه‌شده درست است', mine?.state === 'USED', mine?.state);
      add('نتیجه نظر به دعوت وصل است', mine?.review_status === 'APPROVED',
        mine?.review_status);

      const used = (list.body.invites || []).find(x => x.state === 'USED');
      const del = await api(`/api/admin/review-invites/${used.id}`, { method: 'DELETE' }, TOK);
      add('دعوت استفاده‌شده حذف نمی‌شود (سابقه حفظ می‌شود)',
        del.status === 409, `status ${del.status}`);
    }

    // ─────────────────────────────────────────────
    console.log('\n  ── صفحه عمومی ──');

    {
      const page = await fetch(`${BASE}/review/${'a'.repeat(32)}`);
      const html = await page.text();
      add('مسیر /review/:token صفحه می‌دهد', page.status === 200, `status ${page.status}`);
      add('صفحه noindex است (لینک شخصی نباید ایندکس شود)',
        /noindex/.test(html));
      add('توکن بدشکل در مسیر ۴۰۴ می‌گیرد',
        (await fetch(`${BASE}/review/xyz`)).status === 404);

      const src = fs.readFileSync(path.join(ROOT, 'public/review-invite.html'), 'utf8');
      add('صفحه فونت و قالب مشترک دارد', /assets\/theme\.css/.test(src));
      add('ارتفاع هدر رزرو شده (بدون CLS)', /hdr-reserve/.test(src));
      add('در RTL از text-align روی بلوک استفاده نمی‌کند',
        /\.ri-intro > \* \{ text-align: center \}/.test(src));
    }

    {
      const prod = fs.readFileSync(path.join(ROOT, 'public/product.html'), 'utf8');
      add('صفحه محصول نشان «خرید حضوری» دارد', /instore-tag/.test(prod));
      add('نشان حضوری از نشان آنلاین جداست',
        /خرید حضوری تأییدشده/.test(prod) && /خرید تأییدشده/.test(prod));

      const adm = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
      add('پنل بخش دعوت‌نامه دارد', /inviteCard/.test(adm) && /makeInvite/.test(adm));
      add('پنل متن آماده پیامک را نشان می‌دهد', /ivCopyText/.test(adm));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
