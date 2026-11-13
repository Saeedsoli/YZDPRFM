'use strict';

const crypto = require('crypto');
const net = require('net');

const KINDS = new Set([
  'view',
  'search',
  'add_cart',
  'wishlist',
  'checkout',
  'purchase',
  'quiz'
]);

function containsContact(value) {
  const raw=String(value || '').replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)))
    .replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw) || /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(raw)) return true;
  if(raw.split(/[\s,;\[\]()]+/).some(x=>net.isIP(x)!==0))return true;
  const compact=raw.replace(/[\s\-_.()+\u200c\u200d\u200e\u200f]/g,'');
  return /(?:^|\D)(?:0?9\d{9}|(?:0098|98)9\d{9})(?!\d)/.test(compact);
}
function safeMeta(kind,meta) {
  if(!meta || typeof meta!=='object' || Array.isArray(meta))return null;
  const allowed={search:['results','relaxed'],add_cart:['qty'],checkout:['items','units'],purchase:['qty'],quiz:[],view:[],wishlist:[]}[kind] || [];
  const result={};
  for(const key of allowed){
    const v=meta[key];
    if(key==='relaxed' && typeof v==='boolean')result[key]=v;
    else if(key!=='relaxed' && Number.isSafeInteger(v) && v>=0 && v<=1000000)result[key]=v;
  }
  return Object.keys(result).length ? JSON.stringify(result) : null;
}

const PAID = "('PAID','PROCESSING','SHIPPED','DELIVERED')";

let saltDay = '';
let salt = '';

function todaySalt() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== saltDay) {
    saltDay = today;
    salt = crypto.randomBytes(16).toString('hex');
  }
  return salt;
}

function visitorHash(ip, ua) {
  return crypto.createHash('sha256')
    .update(`${ip}|${ua}|${todaySalt()}`)
    .digest('hex')
    .slice(0, 16);
}

function build(db, appLog, resolveClientIP = req => req?.socket?.remoteAddress || 'unknown') {

  const insert = db.prepare(
    'INSERT INTO events (kind, target, meta, visitor) VALUES (?,?,?,?)'
  );

  function track(kind, target, meta, req) {
    try {
      if (!KINDS.has(kind)) return false;

      const ip = resolveClientIP(req);
      const ua = String(req?.headers?.['user-agent'] || '').slice(0, 120);

      if (/bot|crawler|spider|slurp|bingpreview|headless/i.test(ua)) return false;

      const targetText=target ? String(target).slice(0,120) : null;
      if(targetText && containsContact(targetText))return false;
      insert.run(kind, targetText, safeMeta(kind,meta), visitorHash(ip, ua));
      return true;
    } catch {
      return false;
    }
  }

  function bestsellers(days = 90, limit = 8) {
    return db.prepare(`
      SELECT p.id, p.slug, p.name_fa, p.name_en, p.brand_fa, p.gender,
             p.family_fa, p.family_slug, p.image_url,
             SUM(i.quantity) AS sold,
             (SELECT MIN(price_toman) FROM variants v WHERE v.product_id = p.id) AS min_price,
             /* ویترین هم باید وضعیت موجودی را بگوید.
                بدون این، کارت‌های صفحه اصلی «مشاهده و خرید»
                می‌نوشتند در حالی که کالا موجود نبود — همان
                یافته‌ای که ممیزی جعبه‌سیاه در کاتالوگ گرفت،
                اینجا از قلم افتاده بود. */
             EXISTS (SELECT 1 FROM variants v2
                     WHERE v2.product_id = p.id AND v2.stock > 0) AS in_stock
      FROM order_items i
      JOIN orders   o ON o.order_id = i.order_id
      JOIN order_variant_history v ON v.sku      = i.sku
      JOIN products p ON p.id       = v.product_id
      WHERE o.status IN ${PAID}
        AND o.created_at >= datetime('now', ?)
      GROUP BY p.id
      ORDER BY sold DESC, p.id
      LIMIT ?
    `).all(`-${parseInt(days)} days`, limit);
  }

  function mostWanted(limit = 8) {
    return db.prepare(`
      SELECT p.id, p.slug, p.name_fa, p.name_en, p.brand_fa, p.gender,
             p.family_fa, p.family_slug, p.image_url,
             COUNT(*) AS saves,
             (SELECT MIN(price_toman) FROM variants v WHERE v.product_id = p.id) AS min_price,
             /* ویترین هم باید وضعیت موجودی را بگوید.
                بدون این، کارت‌های صفحه اصلی «مشاهده و خرید»
                می‌نوشتند در حالی که کالا موجود نبود — همان
                یافته‌ای که ممیزی جعبه‌سیاه در کاتالوگ گرفت،
                اینجا از قلم افتاده بود. */
             EXISTS (SELECT 1 FROM variants v2
                     WHERE v2.product_id = p.id AND v2.stock > 0) AS in_stock
      FROM wishlist w
      JOIN products p ON p.id = w.product_id
      GROUP BY p.id
      ORDER BY saves DESC, p.id
      LIMIT ?
    `).all(limit);
  }

  function trending(days = 7, limit = 8) {
    return db.prepare(`
      SELECT p.id, p.slug, p.name_fa, p.name_en, p.brand_fa, p.gender,
             p.family_fa, p.family_slug, p.image_url,
             COUNT(DISTINCT e.visitor) AS viewers,
             (SELECT MIN(price_toman) FROM variants v WHERE v.product_id = p.id) AS min_price,
             /* ویترین هم باید وضعیت موجودی را بگوید.
                بدون این، کارت‌های صفحه اصلی «مشاهده و خرید»
                می‌نوشتند در حالی که کالا موجود نبود — همان
                یافته‌ای که ممیزی جعبه‌سیاه در کاتالوگ گرفت،
                اینجا از قلم افتاده بود. */
             EXISTS (SELECT 1 FROM variants v2
                     WHERE v2.product_id = p.id AND v2.stock > 0) AS in_stock
      FROM events e
      JOIN products p ON p.id = e.target
      WHERE e.kind = 'view'
        AND e.at >= datetime('now', ?)
      GROUP BY p.id
      ORDER BY viewers DESC, p.id
      LIMIT ?
    `).all(`-${parseInt(days)} days`, limit);
  }

  function fallbackPicks(limit = 8) {

    return db.prepare(`
      WITH one_per_brand AS (
        SELECT p.*,
               ROW_NUMBER() OVER (PARTITION BY p.brand_fa ORDER BY p.id) AS rn
        FROM products p
      ),
      spread AS (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY family_slug ORDER BY id) AS fam_rank
        FROM one_per_brand WHERE rn = 1
      )
      SELECT id, slug, name_fa, name_en, brand_fa, gender,
             family_fa, family_slug, image_url,
             (SELECT MIN(price_toman) FROM variants v WHERE v.product_id = spread.id) AS min_price,
             EXISTS (SELECT 1 FROM variants v2
                     WHERE v2.product_id = spread.id AND v2.stock > 0) AS in_stock
      FROM spread
      ORDER BY fam_rank, id
      LIMIT ?
    `).all(limit);
  }

  const SEASON_FA = {
    spring: 'بهار', summer: 'تابستان', autumn: 'پاییز', winter: 'زمستان'
  };

  function seasonNow(date = new Date()) {
    const md = (date.getMonth() + 1) * 100 + date.getDate();
    if (md >= 321 && md <= 621)  return 'spring';
    if (md >= 622 && md <= 922)  return 'summer';
    if (md >= 923 && md <= 1221) return 'autumn';
    return 'winter';
  }

  function weekSeed(date = new Date()) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 1);
    const days = Math.floor((date.getTime() - start) / 86400000);
    return date.getUTCFullYear() * 100 + Math.floor(days / 7);
  }

  function stableHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  }

  function seasonalPicks(limit = 8, date = new Date()) {
    const key = seasonNow(date);
    const fa = SEASON_FA[key];

    const rows = db.prepare(`
      WITH matched AS (
        SELECT p.id, p.slug, p.name_fa, p.name_en, p.brand_fa, p.gender,
               p.family_fa, p.family_slug, p.image_url, p.season,
               CASE WHEN p.season LIKE '%' || ? || '%' THEN 2
                    WHEN p.season = 'چهارفصل'          THEN 1
                    ELSE 0 END AS season_rank,
               (SELECT COALESCE(SUM(v.stock), 0) FROM variants v
                 WHERE v.product_id = p.id) AS total_stock,
               (SELECT MIN(v.price_toman) FROM variants v
                 WHERE v.product_id = p.id) AS min_price
        FROM products p
      ),
      ranked AS (
        /* یکی از هر «برند × خانواده».
           نسخه اول فقط بر اساس برند تفکیک می‌کرد و چون درون هر
           برند بر اساس id مرتب می‌شد، تقریباً همیشه به یک عطر گلی
           می‌رسید — ۲۶۱ گزینه آروماتیک و ۲۶۱ چوبیِ مناسب تابستان
           همان‌جا دور ریخته می‌شدند و بعد قاعده تنوع ماده خام
           نداشت. فیلتر برند داشت قاعده تنوع را گرسنه نگه می‌داشت.

           حالا هر برند می‌تواند در هر خانواده یک نماینده داشته
           باشد؛ محدودیت «تبلیغ یک برند نشود» در مرحله چیدن
           نهایی اعمال می‌شود که دید کامل دارد. */
        SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY brand_fa, family_slug
                    ORDER BY season_rank DESC, id
                  ) AS rn
        FROM matched WHERE season_rank > 0
      )
      SELECT * FROM ranked WHERE rn = 1
    `).all(fa);

    if (!rows.length) return { season: key, season_fa: fa, items: [] };

    const seed = weekSeed(date);
    const sorted = rows
      .map(r => ({ ...r, _r: stableHash(`${r.id}|${seed}`) }))
      .sort((a, b) =>
        (b.total_stock > 0) - (a.total_stock > 0) ||
        b.season_rank - a.season_rank ||
        a._r - b._r);

    const byFamily = new Map();
    for (const r of sorted) {
      const f = r.family_slug || '—';
      if (!byFamily.has(f)) byFamily.set(f, []);
      byFamily.get(f).push(r);
    }

    const picked = [];
    const usedBrands = new Set();
    const queues = [...byFamily.values()];
    const cursor = new Array(queues.length).fill(0);

    let guard = 0;
    while (picked.length < limit && guard++ < 200) {
      let addedThisRound = 0;
      for (let i = 0; i < queues.length && picked.length < limit; i++) {
        const q = queues[i];
        while (cursor[i] < q.length && usedBrands.has(q[cursor[i]].brand_fa)) {
          cursor[i]++;
        }
        if (cursor[i] >= q.length) continue;
        const r = q[cursor[i]++];
        const { _r, season_rank, total_stock, ...clean } = r;
        picked.push({ ...clean, in_stock: total_stock > 0 });
        if (r.brand_fa) usedBrands.add(r.brand_fa);
        addedThisRound++;
      }
      if (!addedThisRound) break;
    }

    return { season: key, season_fa: fa, items: picked };
  }

  function refreshTrending() {
    const put = db.prepare(`
      INSERT INTO trending (slot, payload, updated_at)
      VALUES (?,?,datetime('now'))
      ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload,
                                      updated_at=excluded.updated_at
    `);

    let best = bestsellers(90, 8);
    const usedFallback = best.length < 4;
    if (usedFallback) best = fallbackPicks(8);

    let hot = trending(7, 8);
    if (hot.length < 4) hot = [];

    const wanted = mostWanted(8);
    const seasonal = seasonalPicks(8);

    put.run('bestsellers', JSON.stringify({ items: best, fallback: usedFallback }));
    put.run('most_wanted', JSON.stringify({ items: wanted }));
    put.run('trending',    JSON.stringify({ items: hot }));
    put.run('seasonal',    JSON.stringify(seasonal));

    return {
      bestsellers: best.length, most_wanted: wanted.length,
      trending: hot.length, seasonal: seasonal.items.length
    };
  }

  function getTrending(slot) {
    const row = db.prepare('SELECT payload FROM trending WHERE slot=?').get(slot);
    if (!row) {
      refreshTrending();
      const again = db.prepare('SELECT payload FROM trending WHERE slot=?').get(slot);
      return again ? JSON.parse(again.payload) : { items: [] };
    }
    try { return JSON.parse(row.payload); } catch { return { items: [] }; }
  }

  function trafficSummary(days = 30) {
    const since = `-${parseInt(days)} days`;

    const totals = db.prepare(`
      SELECT COUNT(*) events,
             COUNT(DISTINCT visitor) visitors
      FROM events WHERE at >= datetime('now', ?)
    `).get(since);

    const byKind = db.prepare(`
      SELECT kind, COUNT(*) n, COUNT(DISTINCT visitor) people
      FROM events WHERE at >= datetime('now', ?)
      GROUP BY kind ORDER BY n DESC
    `).all(since);

    const k = Object.fromEntries(byKind.map(r => [r.kind, r]));
    const views     = k.view?.n      || 0;
    const carts     = k.add_cart?.n  || 0;
    const checkouts = k.checkout?.n  || 0;
    const buys      = k.purchase?.n  || 0;

    const funnel = {
      view: views,
      add_cart: carts,
      checkout: checkouts,
      purchase: buys,
      view_to_cart:     views ? +(carts / views * 100).toFixed(1) : 0,
      cart_to_checkout: carts ? +(checkouts / carts * 100).toFixed(1) : 0,
      checkout_to_buy:  checkouts ? +(buys / checkouts * 100).toFixed(1) : 0,
      overall:          views ? +(buys / views * 100).toFixed(2) : 0
    };

    return { days: parseInt(days), ...totals, by_kind: byKind, funnel };
  }

  function daily(days = 30) {
    return db.prepare(`
      SELECT date(at,'+03:30') day,
             COUNT(DISTINCT visitor) visitors,
             SUM(CASE WHEN kind='view'     THEN 1 ELSE 0 END) views,
             SUM(CASE WHEN kind='add_cart' THEN 1 ELSE 0 END) carts,
             SUM(CASE WHEN kind='purchase' THEN 1 ELSE 0 END) purchases
      FROM events
      WHERE at >= datetime('now', ?)
      GROUP BY day ORDER BY day
    `).all(`-${parseInt(days)} days`);
  }

  function failedSearches(days = 30, limit = 25) {
    return db.prepare(`
      SELECT target term, COUNT(*) n, COUNT(DISTINCT visitor) people
      FROM events
      WHERE kind='search' AND at >= datetime('now', ?)
        AND json_extract(meta,'$.results') = 0
      GROUP BY target ORDER BY n DESC LIMIT ?
    `).all(`-${parseInt(days)} days`, limit);
  }

  function topSearches(days = 30, limit = 25) {
    return db.prepare(`
      SELECT target term, COUNT(*) n, COUNT(DISTINCT visitor) people,
             AVG(COALESCE(json_extract(meta,'$.results'),0)) avg_results
      FROM events
      WHERE kind='search' AND at >= datetime('now', ?)
      GROUP BY target ORDER BY n DESC LIMIT ?
    `).all(`-${parseInt(days)} days`, limit);
  }

  function highViewLowSale(days = 30, limit = 15) {
    return db.prepare(`
      SELECT p.id, p.slug, p.name_fa, p.brand_fa,
             COUNT(DISTINCT e.visitor) viewers,
             COALESCE((
               SELECT SUM(i.quantity) FROM order_items i
               JOIN orders o  ON o.order_id = i.order_id
               JOIN order_variant_history v ON v.sku     = i.sku
               WHERE v.product_id = p.id AND o.status IN ${PAID}
                 AND o.created_at >= datetime('now', ?)
             ),0) sold
      FROM events e
      JOIN products p ON p.id = e.target
      WHERE e.kind='view' AND e.at >= datetime('now', ?)
      GROUP BY p.id
      HAVING viewers >= 5
      ORDER BY (sold * 1.0 / viewers) ASC, viewers DESC
      LIMIT ?
    `).all(`-${parseInt(days)} days`, `-${parseInt(days)} days`, limit);
  }

  function dashboard(days = 30) {
    return {
      traffic:  trafficSummary(days),
      daily:    daily(days),
      top_searches:    topSearches(days, 15),
      failed_searches: failedSearches(days, 15),
      high_view_low_sale: highViewLowSale(days, 10),
      bestsellers: bestsellers(days, 10),
      most_wanted: mostWanted(10)
    };
  }

  function purge(days) {
    const keep = parseInt(days || process.env.ANALYTICS_KEEP_DAYS) || 180;
    const r = db.prepare(
      "DELETE FROM events WHERE at < datetime('now', ?)"
    ).run(`-${keep} days`);
    if (r.changes && appLog) {
      appLog('INFO', 'analytics', `${r.changes} رویداد قدیمی پاک شد`);
    }
    return r.changes;
  }

  return {
    track, KINDS,
    bestsellers, mostWanted, trending, fallbackPicks,
    seasonalPicks, seasonNow, weekSeed,
    refreshTrending, getTrending,
    trafficSummary, daily, topSearches, failedSearches,
    highViewLowSale, dashboard, purge
  };
}

module.exports = { build, KINDS, containsContact, safeMeta };
