#!/usr/bin/env node
/**
 * آزمون رندر سمت سرور صفحه مجله.
 *
 * چرا این آزمون: LCP مجله از ۵٬۲۱۶ به ۲٬۸۰۸ میلی‌ثانیه رسید،
 * ولی این دستاورد **شکننده** است. کافی است کسی `coverOf` را در
 * یکی از دو جا عوض کند تا preload به فایل اشتباه بخورد و LCP
 * بدتر از حالت اول شود — دقیقاً همان اتفاقی که یک بار در صفحه
 * محصول افتاد (۶٫۳۵ → ۷٫۱۶ ثانیه).
 *
 * پوشش:
 *   • preload در HTML هست و WebP است
 *   • نشانی preload دقیقاً همان است که مرورگر می‌خواهد
 *   • مقاله شاخص از سمت سرور رندر می‌شود
 *   • `data-slug` با مقاله واقعی می‌خواند
 *   • ترتیب مقالات قطعی است (تاریخ‌های یکسان)
 *   • منطق coverOf در سرور و فرانت یکی مانده
 *   • جاوااسکریپت بلوک آماده را دوباره نمی‌سازد
 *   • فایل تصویر واقعاً وجود دارد
 *
 * اجرا: node scripts/test_journal_lcp.js
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const ROOT = path.dirname(__dirname);
const DB = path.join(ROOT, 'data', 'yazd.db');
const PORT = 4491;
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

(async () => {
  console.log('\n  آزمون رندر سمت سرور صفحه مجله\n');
  const srv = await boot();

  const finish = () => {
    try { srv.kill('SIGKILL'); } catch {}
    const pass = checks.filter(Boolean).length;
    const fail = checks.length - pass;
    console.log(fail
      ? `\n  ${r(`${fail} بررسی ناموفق`)}  ${pass}/${checks.length}\n`
      : `\n  ${g('رندر سمت سرور مجله سالم است.')}  ${pass}/${checks.length}\n`);
    process.exit(fail ? 1 : 0);
  };

  try {
    const html = await fetch(`${BASE}/journal`).then(r => r.text());
    const api = await fetch(`${BASE}/api/articles`).then(r => r.json());
    const first = (api.articles || [])[0];

    add('صفحه مجله سرو می‌شود', html.length > 1000);
    add('API مقاله دارد', !!first, `${(api.articles || []).length} مقاله`);
    if (!first) return finish();

    // ── preload ──
    console.log('\n  ── پیش‌بارگذاری تصویر شاخص ──');

    const pre = html.match(/<link rel="preload" as="image" href="([^"]+)"([^>]*)>/);
    add('تگ preload در HTML هست', !!pre);
    if (!pre) return finish();

    add('نسخه WebP پیش‌بارگذاری می‌شود', /\.webp$/.test(pre[1]), pre[1]);
    add('نوع فایل اعلام شده', /type="image\/webp"/.test(pre[2]));
    add('اولویت بالا دارد', /fetchpriority="high"/.test(pre[2]));

    /* حیاتی‌ترین بررسی: نشانی preload باید **دقیقاً** همان باشد
       که `<picture><source>` می‌خواهد. اگر یکی نباشند، مرورگر
       دو فایل دانلود می‌کند و LCP بدتر از حالت بدون preload
       می‌شود. */
    const srcset = html.match(/<source srcset="([^"]+)" type="image\/webp">/);
    add('تگ source در HTML سمت سرور هست', !!srcset);
    add('نشانی preload با source دقیقاً یکی است',
      srcset && srcset[1] === pre[1], `${pre[1]} ⟷ ${srcset && srcset[1]}`);

    // فایل واقعاً روی دیسک باشد
    const diskPath = path.join(ROOT, 'public', pre[1]);
    add('فایل WebP روی دیسک هست', fs.existsSync(diskPath),
      fs.existsSync(diskPath) ? `${Math.round(fs.statSync(diskPath).size / 1024)}KB` : 'نیست');

    const resp = await fetch(BASE + pre[1]);
    add('تصویر با ۲۰۰ سرو می‌شود', resp.status === 200, `status ${resp.status}`);
    add('نوع MIME درست است',
      (resp.headers.get('content-type') || '').includes('webp'));

    // ── رندر سمت سرور ──
    console.log('\n  ── مقاله شاخص در HTML ──');

    add('بلوک feature خالی نیست',
      !/<div id="feature" style="min-height:54vh"><\/div>/.test(html));
    add('کلاس .feature در HTML هست', /class="feature"/.test(html));
    add('نشان «تازه‌ترین» هست', /tag-new/.test(html));
    add('عنوان مقاله در HTML هست', html.includes(first.title),
      first.title.slice(0, 40));
    add('پیوند مقاله درست است', html.includes(`/journal/${first.slug}`));

    const slugAttr = html.match(/id="feature" data-slug="([^"]+)"/);
    add('data-slug گذاشته شده', !!slugAttr);
    add('data-slug با مقاله اول API یکی است',
      slugAttr && slugAttr[1] === first.slug,
      `${slugAttr && slugAttr[1]} ⟷ ${first.slug}`);

    // ── ترتیب قطعی ──
    console.log('\n  ── ترتیب قطعی مقالات ──');

    {
      /* مقاله‌های اولیه `created_at` یکسان دارند. بدون شکننده
         تساوی، ترتیب بین اجراها عوض می‌شود و سرور تصویری را
         preload می‌کند که فرانت نمی‌خواهد. */
      const db = new Database(DB);
      const same = db.prepare(`
        SELECT COUNT(*) c FROM articles
        WHERE created_at = (SELECT created_at FROM articles ORDER BY created_at DESC LIMIT 1)
      `).get().c;
      db.close();

      const runs = [];
      for (let i = 0; i < 4; i++) {
        const a = await fetch(`${BASE}/api/articles`).then(r => r.json());
        runs.push(a.articles[0].slug);
      }
      add('ترتیب API بین اجراها ثابت است',
        new Set(runs).size === 1,
        `${same} مقاله با تاریخ یکسان · ${[...new Set(runs)].join(', ')}`);

      const h2 = await fetch(`${BASE}/journal`).then(r => r.text());
      const s2 = h2.match(/data-slug="([^"]+)"/);
      add('HTML سمت سرور هم همان مقاله را می‌دهد',
        s2 && s2[1] === runs[0]);
    }

    // ── هم‌خوانی منطق ──
    console.log('\n  ── هم‌خوانی سرور و فرانت ──');

    {
      const seoSrc = fs.readFileSync(path.join(ROOT, 'src/seo.js'), 'utf8');
      const jSrc = fs.readFileSync(path.join(ROOT, 'public/journal.html'), 'utf8');

      /* هر دو باید همان سه تصویر پیش‌فرض دسته را داشته باشند.
         اگر یکی عوض شود و دیگری نه، preload به فایل اشتباه
         می‌خورد — سکوت کامل، فقط LCP بدتر می‌شود. */
      for (const img of ['family-citrus.jpg', 'scene-signature.jpg',
        'family-ambery-oriental.jpg']) {
        add(`تصویر پیش‌فرض «${img}» در هر دو هست`,
          seoSrc.includes(img) && jSrc.includes(img));
      }
      add('شرط /images/products در هر دو یکسان است',
        seoSrc.includes("startsWith('/images/products')")
        && jSrc.includes("startsWith('/images/products')"));

      add('فرانت بلوک آماده را دوباره نمی‌سازد',
        /box\.dataset\.slug === a\.slug/.test(jSrc));
      add('فرانت پس از ساخت data-slug را می‌گذارد',
        /box\.dataset\.slug = a\.slug/.test(jSrc));
    }

    // ── به تعویق افتادن کارهای غیرضروری ──
    console.log('\n  ── مسیر بحرانی ──');

    {
      const app = fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8');
      add('تابع whenIdle تعریف شده', /function whenIdle/.test(app));
      add('نوار اعلان به تعویق افتاده', /whenIdle\(loadNotice\)/.test(app));
      add('بررسی ورود به تعویق افتاده',
        /whenIdle\(async \(\) => \{[\s\S]*?YazdAuth\.check/.test(app));
      add('سقف زمانی برای دستگاه پرمشغله هست', /timeout = 2000/.test(app));
    }

    // ── جداکننده دوطرفه ──
    console.log('\n  ── جداکننده در RTL ──');

    {
      const css = fs.readFileSync(path.join(ROOT, 'public/assets/theme.css'), 'utf8');
      add('کلاس .sep در CSS هست', /\.sep\s*\{/.test(css));
      add('جداکننده با ::before ساخته می‌شود، نه در متن',
        /\.sep::before\s*\{\s*content:/.test(css));
      add('نقطه‌وسط در متن مجله نمانده',
        !/' · ' \+ a\.read_time/.test(
          fs.readFileSync(path.join(ROOT, 'public/journal.html'), 'utf8')));
      add('HTML سرور از span.sep استفاده می‌کند',
        /<span class="sep"><\/span>/.test(html));
    }

    // ── بدون افت در صفحات دیگر ──
    console.log('\n  ── صفحات دیگر آسیب ندیده‌اند ──');

    for (const [p, label] of [['/', 'خانه'], ['/perfume/creed-aventus', 'محصول'],
      [`/journal/${first.slug}`, 'مقاله']]) {
      const res = await fetch(BASE + p);
      const t = await res.text();
      add(`${label} سالم سرو می‌شود`, res.status === 200 && t.length > 1000,
        `status ${res.status}`);
    }

    {
      const prod = await fetch(`${BASE}/perfume/creed-aventus`).then(r => r.text());
      add('preload صفحه محصول دست‌نخورده مانده',
        /<link rel="preload" as="image"[^>]*fetchpriority="high"/.test(prod));
    }

  } catch (e) {
    add('اجرای آزمون بدون خطای غیرمنتظره', false, e.message);
  }

  finish();
})();
