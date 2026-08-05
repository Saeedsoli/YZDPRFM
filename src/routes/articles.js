/**
 * عطر یزد | مسیرهای مجله (مقالات)
 * ---------------------------------
 * نخستین ماژول جداشده از `server.js`.
 *
 * ── الگوی تفکیک ──
 * همه مسیرها داخل یک closure در `server.js` بودند و به هفت متغیر
 * محلی وابسته‌اند: `sendJSON`، `sendBody`، `who`، `logAudit`،
 * `can`، `requireAdmin`، `parsed`.
 *
 * پس نمی‌شد فقط متن را جابه‌جا کرد. هر ماژول یک شیء `ctx` می‌گیرد
 * که همان زمینه را در بر دارد، و یک `Promise<boolean>` برمی‌گرداند:
 *
 *   true  → مسیر رسیدگی شد، سرور کار دیگری نکند
 *   false → این ماژول مسئولش نیست، ادامه بده
 *
 * ── چرا مقالات اول ──
 * کم‌خطرترین بخش است: نه پول جابه‌جا می‌کند، نه موجودی، نه
 * احراز هویت. اگر الگو ایراد داشته باشد، اینجا بی‌ضررترین جای
 * ممکن برای کشفش است.
 *
 * مسیرهای پرداخت و ثبت سفارش **عمداً** در `server.js` ماندند تا
 * وقتی این الگو با آزمون واقعی تأیید شود.
 */

'use strict';

/**
 * @param {object} ctx زمینه درخواست
 * @param {string} ctx.method    GET/POST/… (HEAD قبلاً به GET نگاشته شده)
 * @param {string} ctx.pathname  مسیر رمزگشایی‌شده
 * @param {object} ctx.parsed    خروجی url.parse با query
 * @param {object} ctx.req       درخواست خام (برای parseBody)
 * @param {object} ctx.res       پاسخ خام (برای CSV و استریم)
 * @param {Function} ctx.sendJSON
 * @param {Function} ctx.can      بررسی مجوز — خودش ۴۰۳ می‌فرستد
 * @param {Function} ctx.parseBody
 * @param {object} ctx.db
 * @param {Function} ctx.appLog
 * @param {Function} ctx.slugify
 * @returns {Promise<boolean>} آیا مسیر رسیدگی شد؟
 */
async function handle(ctx) {
  const { method, pathname, parsed, req, sendJSON, can,
          parseBody, db, appLog, slugify } = ctx;

  // ═══════════ فهرست مقالات ═══════════
  if (method === 'GET' && pathname === '/api/articles') {
    const cat = parsed.query.category;
    const rows = (cat && cat !== 'all')
      /* `id` شکننده تساوی است: مقاله‌های اولیه تاریخ یکسان
         دارند و بدون آن ترتیب بین اجراها عوض می‌شد — یعنی
         «مقاله شاخص» صفحه مجله ثابت نبود و preload سمت سرور
         به تصویر دیگری می‌خورد. */
      ? db.prepare('SELECT * FROM articles WHERE category=? ORDER BY created_at DESC, id').all(cat)
      : db.prepare('SELECT * FROM articles ORDER BY created_at DESC, id').all();
    sendJSON(200, { total: rows.length, articles: rows });
    return true;
  }

  // ═══════════ یک مقاله ═══════════
  if (method === 'GET' && pathname.startsWith('/api/articles/')) {
    const key = pathname.replace('/api/articles/', '');
    const row = db.prepare('SELECT * FROM articles WHERE id=? OR slug=?').get(key, key);
    row ? sendJSON(200, row) : sendJSON(404, { error: 'مقاله یافت نشد' });
    return true;
  }

  // ═══════════ انتشار مقاله ═══════════
  if (method === 'POST' && pathname === '/api/articles') {
    if (!can('content.write')) return true;
    const b = await parseBody(req);
    if (!b.title) { sendJSON(400, { error: 'عنوان مقاله الزامی است.' }); return true; }
    const id = `ART-${Date.now().toString(36).toUpperCase()}`;

    // نشانی یکتا از روی عنوان
    let slug = slugify(b.slug || b.title);
    if (db.prepare('SELECT 1 FROM articles WHERE slug=?').get(slug)) {
      slug = `${slug}-${id.slice(-4).toLowerCase()}`;
    }

    db.prepare(`
      INSERT INTO articles (id,title,slug,category,category_label,read_time,cover_image,excerpt,content,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(id, b.title, slug, b.category || 'guide',
           b.category_label || 'راهنمای تخصصی', b.read_time || '۴ دقیقه',
           b.cover_image || '/images/ingredients_banner.jpg',
           b.excerpt || '', b.content || '', new Date().toISOString());
    appLog('INFO', 'admin', 'مقاله جدید', { id, slug });
    sendJSON(201, { message: 'مقاله منتشر شد.', id, slug });
    return true;
  }

  // ═══════════ ویرایش مقاله ═══════════
  if (method === 'PUT' && pathname.startsWith('/api/articles/')) {
    if (!can('content.write')) return true;
    const id = pathname.replace('/api/articles/', '');
    const b = await parseBody(req);
    const cur = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
    if (!cur) { sendJSON(404, { error: 'مقاله یافت نشد' }); return true; }
    // slug تنها در صورت درخواست صریح تغییر می‌کند تا لینک‌های
    // ایندکس‌شده در گوگل نشکنند
    const slug = b.slug ? slugify(b.slug) : cur.slug;

    db.prepare(`
      UPDATE articles SET title=?, slug=?, category=?, category_label=?,
        read_time=?, cover_image=?, excerpt=?, content=? WHERE id=?
    `).run(b.title ?? cur.title, slug, b.category ?? cur.category,
           b.category_label ?? cur.category_label, b.read_time ?? cur.read_time,
           b.cover_image ?? cur.cover_image, b.excerpt ?? cur.excerpt,
           b.content ?? cur.content, id);

    appLog('INFO', 'admin', 'ویرایش مقاله', { id });
    sendJSON(200, { message: 'مقاله بروزرسانی شد.', slug });
    return true;
  }

  // ═══════════ حذف مقاله ═══════════
  if (method === 'DELETE' && pathname.startsWith('/api/articles/')) {
    if (!can('content.delete')) return true;
    const id = pathname.replace('/api/articles/', '');
    const r = db.prepare('DELETE FROM articles WHERE id=?').run(id);
    r.changes
      ? sendJSON(200, { message: 'مقاله حذف شد.' })
      : sendJSON(404, { error: 'مقاله یافت نشد' });
    return true;
  }

  return false;   // این ماژول مسئول این مسیر نیست
}

module.exports = { handle };
