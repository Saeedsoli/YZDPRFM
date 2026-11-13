'use strict';

async function handle(ctx) {
  const {
    method, pathname, parsed, req,
    can, parseBody, logAudit, appLog, who, db,
    otp, cleanText, faNum, createReviewInvite, INVITE_TTL_DAYS
  } = ctx;

  const sendJSON = (code, data) => { ctx.sendJSON(code, data); return true; };

  if (method === 'GET' && pathname === '/api/admin/reviews') {
    if (!can('reviews.view')) return true;
    const st = parsed.query.status || 'PENDING';
    const rows = db.prepare(`
      SELECT r.*, p.name_fa, p.brand_fa, p.slug
      FROM reviews r JOIN products p ON p.id = r.product_id
      WHERE r.status=? ORDER BY r.created_at DESC LIMIT 100
    `).all(st);
    const counts = {};
    db.prepare('SELECT status, COUNT(*) c FROM reviews GROUP BY status').all()
      .forEach(r => counts[r.status] = r.c);
    return sendJSON(200, { total: rows.length, counts, reviews: rows });
  }

  if (method === 'GET' && pathname === '/api/admin/review-invites') {
    if (!can('reviews.view')) return true;
    const rows = db.prepare(`
      SELECT i.*, p.name_fa, p.brand_fa, p.slug,
             r.status AS review_status, r.rating AS review_rating
      FROM review_invites i
      JOIN products p ON p.id = i.product_id
      LEFT JOIN reviews r ON r.id = i.review_id
      ORDER BY i.id DESC LIMIT 200
    `).all();

    const now = new Date();
    return sendJSON(200, {
      total: rows.length,
      invites: rows.map(r => ({
        ...r,

        state: r.used_at ? 'USED'
          : new Date(r.expires_at) < now ? 'EXPIRED' : 'OPEN',
        url: `/review/${r.token}`
      }))
    });
  }

  if (method === 'POST' && pathname === '/api/admin/review-invites') {
    if (!can('reviews.invite')) return true;
    const b = await parseBody(req);

    const p = db.prepare('SELECT id, name_fa, brand_fa FROM products WHERE id=? OR slug=?')
      .get(b.product, b.product);
    if (!p) return sendJSON(404, { error: 'محصول یافت نشد.' });

    const mobile = otp.normalizeMobile(b.mobile || '');
    if (!otp.isValidMobile(mobile))
      return sendJSON(400, { error: 'شماره موبایل معتبر وارد کنید (۰۹xxxxxxxxx).' });

    const existing = db.prepare('SELECT status FROM reviews WHERE product_id=? AND mobile=?')
      .get(p.id, mobile);
    if (existing) {
      return sendJSON(409, {
        error: `این شماره قبلاً برای این محصول نظر ثبت کرده است (وضعیت: ${existing.status}).`
      });
    }

    const open = db.prepare(`
      SELECT token, expires_at FROM review_invites
      WHERE product_id=? AND mobile=? AND used_at IS NULL AND expires_at > ?
    `).get(p.id, mobile, new Date().toISOString());
    if (open) {
      return sendJSON(200, {
        message: 'دعوت‌نامه باز برای این مشتری و محصول از قبل وجود دارد.',
        token: open.token, url: `/review/${open.token}`,
        expires_at: open.expires_at, reused: true
      });
    }

    const inv = createReviewInvite(p.id, mobile, cleanText(b.note, 200),
      who?.display_name || who?.username || null);

    logAudit('reviews.invite', {
      target: `${p.brand_fa || ''} ${p.name_fa}`.trim(),
      mobile: mobile.slice(0, 4) + '****' + mobile.slice(-2)
    });

    return sendJSON(201, {
      message: 'دعوت‌نامه ساخته شد.',
      token: inv.token,
      url: `/review/${inv.token}`,
      expires_at: inv.expires_at,

      sms_text: `${p.brand_fa ? p.brand_fa + ' — ' : ''}${p.name_fa}\n`
        + `سلام! اگر این رایحه را از ما گرفته‌اید، خوشحال می‌شویم تجربه‌تان را بنویسید:\n`
        + `${(process.env.SITE_URL || 'https://yazdperfume.ir').replace(/\/$/, '')}/review/${inv.token}\n`
        + `(مهلت: ${faNum(INVITE_TTL_DAYS)} روز) — عطر یزد`
    });
  }

  if (method === 'DELETE' && /^\/api\/admin\/review-invites\/\d+$/.test(pathname)) {
    if (!can('reviews.invite')) return true;
    const id = parseInt(pathname.split('/').pop());

    const r = db.prepare('DELETE FROM review_invites WHERE id=? AND used_at IS NULL').run(id);
    if (!r.changes) {
      return sendJSON(409, {
        error: 'دعوت‌نامه یافت نشد یا قبلاً استفاده شده (سابقه‌اش نگه داشته می‌شود).'
      });
    }
    logAudit('reviews.invite', { target: `حذف دعوت #${id}` });
    return sendJSON(200, { message: 'دعوت‌نامه حذف شد.' });
  }

  if (method === 'PUT' && pathname.startsWith('/api/admin/reviews/')) {
    const id = parseInt(pathname.replace('/api/admin/reviews/', ''));
    const b = await parseBody(req);
    const cur = db.prepare('SELECT * FROM reviews WHERE id=?').get(id);
    if (!cur) return sendJSON(404, { error: 'نظر یافت نشد' });

    const wantsStatus = ['APPROVED', 'REJECTED', 'PENDING'].includes(b.status)
      && b.status !== cur.status;
    const wantsReply = b.admin_reply != null && String(b.admin_reply).trim() !== '';

    if (wantsStatus && !can('reviews.moderate')) return true;
    if (wantsReply && !can('reviews.reply')) return true;
    if (!wantsStatus && !wantsReply) {
      if (!can('reviews.view')) return true;
      return sendJSON(200, { message: 'تغییری اعمال نشد.' });
    }

    const status = ['APPROVED', 'REJECTED', 'PENDING'].includes(b.status)
      ? b.status : cur.status;

    const reply = wantsReply ? cleanText(b.admin_reply, 1000) : null;

    db.prepare('UPDATE reviews SET status=?, admin_reply=COALESCE(?, admin_reply) WHERE id=?')
      .run(status, reply, id);

    appLog('INFO', 'admin', 'بررسی نظر', { id, status });
    logAudit(wantsReply ? 'reviews.reply' : 'reviews.moderate',
             { target: String(id), detail: { status } });
    return sendJSON(200, {
      message: status === 'APPROVED' ? 'نظر منتشر شد.'
             : status === 'REJECTED' ? 'نظر رد شد.' : 'وضعیت تغییر کرد.'
    });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/admin/reviews/')) {
    if (!can('reviews.delete')) return true;
    const id = parseInt(pathname.replace('/api/admin/reviews/', ''));
    const r = db.prepare('DELETE FROM reviews WHERE id=?').run(id);
    return r.changes ? sendJSON(200, { message: 'نظر حذف شد.' })
                     : sendJSON(404, { error: 'نظر یافت نشد' });
  }

  return false;
}

module.exports = { handle };
