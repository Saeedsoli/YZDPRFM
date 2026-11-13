'use strict';

const media = require('../media');

async function handle(ctx) {
  const { method, pathname, parsed, req, sendJSON, can,
          parseBody, db, appLog, slugify } = ctx;

  if (method === 'GET' && pathname === '/api/admin/media') {
    if (!can('content.write')) return true;
    sendJSON(200, {
      uploaded: media.list(),
      stock: media.stockImages(),
      max_mb: Math.round(media.MAX_BYTES / 1024 / 1024)
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/admin/media') {
    if (!can('content.write')) return true;
    let orig = '';
    try { orig = decodeURIComponent(req.headers['x-file-name'] || ''); } catch { orig = ''; }

    const r = await media.saveUpload(req, orig);
    if (!r.ok) { sendJSON(400, { error: r.error }); return true; }

    appLog('INFO', 'admin', 'تصویر مقاله آپلود شد',
           { name: r.name, size: r.size, format: r.format });
    sendJSON(201, { message: 'تصویر آپلود شد.', ...r });
    return true;
  }

  if (method === 'DELETE' && pathname.startsWith('/api/admin/media/')) {
    if (!can('content.delete')) return true;
    const name = decodeURIComponent(pathname.replace('/api/admin/media/', ''));
    const r = media.remove(name);
    if (!r.ok) { sendJSON(404, { error: r.error }); return true; }
    appLog('INFO', 'admin', 'تصویر مقاله حذف شد', { name });
    sendJSON(200, { message: 'تصویر حذف شد.' });
    return true;
  }

  if (method === 'GET' && pathname === '/api/articles') {
    const cat = parsed.query.category;
    const rows = (cat && cat !== 'all')

      ? db.prepare('SELECT * FROM articles WHERE category=? ORDER BY created_at DESC, id').all(cat)
      : db.prepare('SELECT * FROM articles ORDER BY created_at DESC, id').all();
    sendJSON(200, { total: rows.length, articles: rows });
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/articles/')) {
    const key = pathname.replace('/api/articles/', '');
    const row = db.prepare('SELECT * FROM articles WHERE id=? OR slug=?').get(key, key);
    if (!row) { sendJSON(404, { error: 'مقاله یافت نشد' }); return true; }

    let sources = [];
    try {
      const parsed = JSON.parse(row.sources || '[]');
      sources = Array.isArray(parsed)
        ? parsed.filter(x => x && typeof x.label === 'string' &&
            (!x.url || /^https:\/\//i.test(x.url)))
        : [];
    } catch { sources = []; }
    sendJSON(200, { ...row, sources });
    return true;
  }

  if (method === 'POST' && pathname === '/api/articles') {
    if (!can('content.write')) return true;
    const b = await parseBody(req);
    if (!b.title) { sendJSON(400, { error: 'عنوان مقاله الزامی است.' }); return true; }
    const id = `ART-${Date.now().toString(36).toUpperCase()}`;

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

  if (method === 'PUT' && pathname.startsWith('/api/articles/')) {
    if (!can('content.write')) return true;
    const id = pathname.replace('/api/articles/', '');
    const b = await parseBody(req);
    const cur = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
    if (!cur) { sendJSON(404, { error: 'مقاله یافت نشد' }); return true; }

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

  if (method === 'DELETE' && pathname.startsWith('/api/articles/')) {
    if (!can('content.delete')) return true;
    const id = pathname.replace('/api/articles/', '');
    const r = db.prepare('DELETE FROM articles WHERE id=?').run(id);
    r.changes
      ? sendJSON(200, { message: 'مقاله حذف شد.' })
      : sendJSON(404, { error: 'مقاله یافت نشد' });
    return true;
  }

  return false;
}

module.exports = { handle };
