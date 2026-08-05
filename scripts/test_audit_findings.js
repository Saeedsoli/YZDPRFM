#!/usr/bin/env node
/**
 * آزمون یافته‌های ممیزی مستقل (مرداد ۱۴۰۵).
 *
 * پس‌زمینه: پس از تفکیک `server.js`، کد با «چشم تازه» بازخوانی
 * شد — نه به‌عنوان نویسنده‌اش بلکه کسی که دنبال ایراد است.
 * سه یافته واقعی درآمد که هیچ آزمون موجودی نمی‌گرفتشان.
 *
 * ── یافته ۱ 🔴 نشت هش رمز ──
 * `getStaff()` با `{...s}` همه ستون‌ها را برمی‌گرداند شامل
 * `pass_hash` و `pass_salt`. سه مسیر مدیریتی خروجی‌اش را مستقیم
 * در پاسخ JSON می‌گذاشتند. با آزمون واقعی تأیید شد که هش scrypt
 * و salt به بیرون می‌رفتند.
 *
 * ── یافته ۲ 🟡 مسیرهای عمومی بدون محدودیت نرخ ──
 * `/api/track`، `/api/tickets` و `/api/stock-alert` هر سه به
 * دیتابیس می‌نویسند و بدون احراز هویت‌اند. اندازه‌گیری: ۴۰
 * درخواست به `/api/track` در ۳۳۷ میلی‌ثانیه، همه پذیرفته.
 *
 * ── یافته ۳ 🔴 خطای بلعیده‌شده ──
 * هنگام رفع یافته ۲ معلوم شد `ip` در هر بلوک محلی تعریف شده و
 * در بلوک‌های دیگر `ReferenceError` می‌دهد — خطایی که در
 * `catch` بلعیده می‌شد و کاربر پاسخ ۲۰۰ می‌گرفت.
 *
 * اجرا: node scripts/test_audit_findings.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4905;
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

function clearLimits() {
  const db = new Database(DB);
  db.prepare('DELETE FROM rate_limits').run();
  db.close();
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
  }).then(async x => {
    const text = await x.text();
    let body = {};
    try { body = JSON.parse(text); } catch {}
    return { status: x.status, text, body };
  });

(async () => {
  console.log('\n  آزمون یافته‌های ممیزی مستقل\n');
  clearLimits();
  const srv = await boot();

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    clearLimits();
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('یافته‌های ممیزی رفع شده‌اند.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
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

    // ═════════════════════════════════════════
    console.log('\n  ── یافته ۱: نشت هش رمز ──');

    const SECRETS = ['pass_hash', 'pass_salt'];

    {
      /* حیاتی‌ترین بررسی: هش رمز نباید در هیچ پاسخی باشد.
         اگر لو برود، مهاجم می‌تواند آفلاین حمله فرهنگ‌لغت بزند
         بدون اینکه محدودیت نرخ ورود مانعش شود. */
      const res = await api('/api/admin/me/profile', {
        method: 'PUT', body: JSON.stringify({ display_name: 'مدیر کل' })
      }, TOK);
      add('PUT /api/admin/me/profile پاسخ می‌دهد', res.status === 200);
      for (const k of SECRETS) {
        add(`«${k}» در پاسخ profile نیست`, !res.text.includes(k));
      }
      add('اطلاعات مفید همچنان برمی‌گردد',
        !!res.body.staff?.username && Array.isArray(res.body.staff?.permissions));
    }

    {
      /* همه مسیرهای مدیریتی که کارمند برمی‌گردانند */
      for (const p of ['/api/admin/whoami', '/api/admin/me',
        '/api/admin/staff', '/api/admin/me/activity']) {
        const res = await api(p, {}, TOK);
        add(`${p} بدون هش`,
          !SECRETS.some(k => res.text.includes(k)), `status ${res.status}`);
      }
    }

    {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'db.js'), 'utf8');
      add('تابع publicStaff تعریف شده', /function publicStaff/.test(src));
      /* فهرست سفید است نه سیاه: ستون تازه‌ای که روزی اضافه شود
         خودبه‌خود بیرون نمی‌رود. */
      const fn = src.slice(src.indexOf('function publicStaff'),
                           src.indexOf('function publicCustomer'));
      add('publicStaff فهرست سفید است، نه حذف فیلد',
        !/delete |omit\(/.test(fn) && /id: s\.id/.test(fn));
      add('publicStaff هیچ فیلد رمزی برنمی‌گرداند',
        !SECRETS.some(k => fn.includes(k)));

      const rbac = fs.readFileSync(path.join(ROOT, 'src/routes/rbac.js'), 'utf8');
      const srv2 = fs.readFileSync(path.join(ROOT, 'src/server.js'), 'utf8');
      /* هیچ‌جا نباید `getStaff()` خام در پاسخ برود */
      add('rbac از publicStaff استفاده می‌کند',
        !/staff: getStaff\(/.test(rbac) && /publicStaff\(getStaff\(/.test(rbac));
      add('server از publicStaff استفاده می‌کند',
        !/staff: getStaff\(/.test(srv2));
    }

    // ═════════════════════════════════════════
    console.log('\n  ── یافته ۲: محدودیت نرخ مسیرهای عمومی ──');

    {
      clearLimits();
      /* سقف ۱۲۰ در دقیقه. یک بازدید عادی ۵ تا ۱۰ رویداد می‌سازد،
         پس کاربر واقعی هرگز نمی‌خورد. */
      let ok = 0, throttled = 0;
      for (let i = 0; i < 140; i++) {
        const res = await api('/api/track', {
          method: 'POST', body: JSON.stringify({ kind: 'view', target: 'YZD-0001' })
        });
        res.body.throttled ? throttled++ : ok++;
      }
      add('/api/track پس از سقف محدود می‌شود', throttled > 0,
        `${ok} پذیرفته · ${throttled} محدود`);
      add('سقف دقیقاً ۱۲۰ است', ok === 120, `${ok}`);
      /* تحلیل نباید تجربه کاربر را خراب کند: بی‌صدا رد می‌شود
         نه با خطای ۴۲۹ که صفحه را بشکند. */
      const after = await api('/api/track', {
        method: 'POST', body: JSON.stringify({ kind: 'view', target: 'x' })
      });
      add('محدودیت track بی‌صدا است (۲۰۰ نه ۴۲۹)', after.status === 200);
    }

    {
      clearLimits();
      let normal = 0, limited = 0;
      for (let i = 0; i < 10; i++) {
        const res = await api('/api/tickets', {
          method: 'POST',
          body: JSON.stringify({
            order_id: 'FAKE-X', volume_ml: 30, used_under_2ml: true,
            description: 'متن آزمایشی به اندازه کافی طولانی برای عبور'
          })
        });
        res.status === 429 ? limited++ : normal++;
      }
      add('/api/tickets پس از ۵ بار محدود می‌شود',
        limited > 0 && normal === 5, `${normal} عادی · ${limited} محدود`);
    }

    {
      clearLimits();
      let normal = 0, limited = 0;
      for (let i = 0; i < 14; i++) {
        const res = await api('/api/stock-alert', {
          method: 'POST',
          body: JSON.stringify({ sku: 'YZD-0001-EDP-030', mobile: '09121234567' })
        });
        res.status === 429 ? limited++ : normal++;
      }
      add('/api/stock-alert پس از ۱۰ بار محدود می‌شود',
        limited > 0 && normal === 10, `${normal} عادی · ${limited} محدود`);
    }

    // ═════════════════════════════════════════
    console.log('\n  ── یافته ۳: خطای بلعیده‌شده ──');

    {
      const src = fs.readFileSync(path.join(ROOT, 'src', 'server.js'), 'utf8');
      /* `reqIP` یک بار در سطح درخواست تعریف می‌شود.
         پیش‌تر هر بلوک `const ip = clientIP(req)` خودش را داشت و
         بلوک‌های دیگر به آن دسترسی نداشتند. */
      add('reqIP در سطح درخواست تعریف شده',
        /const reqIP = clientIP\(req\)/.test(src));
      /* از گام ۸ تفکیک، `track` و `alert` در
         `src/routes/engagement.js` زندگی می‌کنند و `reqIP` را از
         `ctx` می‌گیرند. ضمانت عوض نشده — محل کد عوض شده.
         این بررسی هر دو فایل را می‌خواند تا با جابه‌جایی بعدی هم
         دروغ نگوید. */
      const eng = fs.readFileSync(
        path.join(ROOT, 'src', 'routes', 'engagement.js'), 'utf8');
      const all = src + '\n' + eng;
      add('محدودیت‌های تازه از reqIP استفاده می‌کنند',
        /track:\$\{reqIP\}/.test(all) && /alert:\$\{reqIP\}/.test(all));
      add('ماژول engagement تعریف محلی ip نمی‌سازد',
        !/const ip = clientIP\(req\)/.test(eng),
        'reqIP از ctx می‌آید');

      /* نگهبان: هیچ‌جا نباید از `ip` استفاده شود جایی که تعریف
         نشده. بررسی ساده: تعداد تعریف‌های محلی نباید صفر شود
         (بلوک‌های قدیمی هنوز خودشان تعریف می‌کنند) ولی مسیرهای
         تازه باید reqIP بگیرند. */
      clearLimits();
      const res = await api('/api/track', {
        method: 'POST', body: JSON.stringify({ kind: 'view', target: 'YZD-0001' })
      });
      add('مسیر track بدون خطای داخلی کار می‌کند',
        res.status === 200 && !res.body.throttled);

      const db = new Database(DB);
      const errs = db.prepare(`
        SELECT COUNT(*) c FROM app_logs
        WHERE level='ERROR' AND message LIKE '%is not defined%'
          AND logged_at >= datetime('now','-2 minutes')
      `).get().c;
      db.close();
      add('هیچ ReferenceError تازه‌ای ثبت نشده', errs === 0, `${errs} خطا`);
    }

    // ═════════════════════════════════════════
    console.log('\n  ── کاربر واقعی آسیب نمی‌بیند ──');

    {
      clearLimits();
      /* سناریوی یک بازدید عادی: چند رویداد تحلیل، یک بررسی سبد.
         هیچ‌کدام نباید محدود شود. */
      let blocked = 0;
      for (let i = 0; i < 12; i++) {
        const res = await api('/api/track', {
          method: 'POST', body: JSON.stringify({ kind: 'view', target: 'YZD-000' + (i % 9) })
        });
        if (res.body.throttled) blocked++;
      }
      add('بازدید عادی (۱۲ رویداد) محدود نمی‌شود', blocked === 0, `${blocked} مسدود`);

      const cart = await api('/api/cart/sync', {
        method: 'POST', body: JSON.stringify({ skus: ['YZD-0001-EDP-030'] })
      });
      add('مسیرهای خواندنی دست‌نخورده‌اند', cart.status === 200);
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
