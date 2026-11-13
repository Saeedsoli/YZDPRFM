'use strict';

const VALID = {
  gender:      ['MEN', 'WOMEN', 'UNISEX', 'ANY'],
  temperature: ['گرم', 'خنک', 'معتدل', 'ANY'],
  season:      ['بهار و تابستان', 'پاییز و زمستان', 'چهارفصل', 'ANY'],
  occasion:    ['رسمی', 'روزمره', 'عاشقانه', 'ANY'],
  family:      ['شرقی', 'چوبی', 'گلی', 'مرکباتی', 'آروماتیک', 'ANY'],
  budget:      ['low', 'mid', 'high', 'ANY']
};

const KEYS = Object.keys(VALID);

function sanitize(answers) {
  const out = {};
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return out;

  for (const k of KEYS) {
    const v = answers[k];
    if (typeof v !== 'string') continue;
    if (!VALID[k].includes(v)) continue;
    if (v === 'ANY') continue;
    out[k] = v;
  }
  return out;
}

function isMeaningful(clean) {
  return Object.keys(clean || {}).length >= 2;
}

function scoreProduct(row, a) {
  let score = 0, matches = 0;

  if (a.gender) {
    matches++;
    if (row.gender === a.gender) score += 3;
    else if (row.gender === 'UNISEX') score += 1;
  }

  if (a.temperature) {
    matches++;
    const t = row.temperature || '';
    if (t.includes(a.temperature)) score += 2;
    else if (a.temperature === 'معتدل' && (t.includes('گرم') || t.includes('خنک'))) score += 1;
  }

  if (a.season) {
    matches++;
    const s = row.season || '';
    if (s.includes(a.season.replace(' و ', '')) || a.season.includes(s.replace(' و ', ''))) score += 2;
    else if (s === 'چهارفصل') score += 1;
  }

  if (a.occasion) {
    matches++;
    const o = row.occasion || '';
    if (a.occasion === 'رسمی'    && /رسمی|اداری|مجلسی/.test(o)) score += 2;
    else if (a.occasion === 'روزمره'  && /روزمره|کژوال|ورزشی/.test(o)) score += 2;
    else if (a.occasion === 'عاشقانه' && /عاشقانه|شبانه|قرار/.test(o)) score += 2;
    else if (o.includes(a.occasion)) score += 2;
  }

  if (a.family) {
    matches++;
    const f = row.family_fa || '';
    if (f.includes(a.family)) score += 3;
    else if (a.family === 'شرقی'     && /عود|شرقی|تنباکو/.test(f)) score += 2;
    else if (a.family === 'چوبی'     && /چوب|چرم/.test(f)) score += 2;
    else if (a.family === 'گلی'      && /گل|پودر/.test(f)) score += 2;
    else if (a.family === 'مرکباتی'  && /مرکبات|آبزی|میوه/.test(f)) score += 2;
    else if (a.family === 'آروماتیک' && /آروماتیک|فوژه|سبز/.test(f)) score += 2;
  }

  return { score, matches, norm: matches ? score / matches : 0 };
}

function inBudget(minPrice, budget) {
  if (!budget || budget === 'ANY') return true;
  const mp = minPrice || 0;
  if (budget === 'low')  return mp < 2000000;
  if (budget === 'mid')  return mp >= 2000000 && mp < 5000000;
  if (budget === 'high') return mp >= 5000000;
  return true;
}

function describe(clean) {
  const parts = [];
  const G = { MEN: 'مردانه', WOMEN: 'زنانه', UNISEX: 'یونیسکس' };
  if (clean.gender)      parts.push(G[clean.gender] || clean.gender);
  if (clean.family)      parts.push(clean.family);
  if (clean.temperature) parts.push(`طبع ${clean.temperature}`);
  if (clean.season)      parts.push(clean.season);
  if (clean.occasion)    parts.push(clean.occasion);
  return parts;
}

function build(db, helpers) {
  const { parseProduct, attachVariants } = helpers;

  function recommend(answers, limit = 8, opts = {}) {
    const a = sanitize(answers);

    const unconstrained = Object.keys(a).filter(k => k !== 'budget').length === 0;
    if (unconstrained && opts.requireProfile) {
      return { items: [], profile: a, relaxed: false };
    }

    const rows = db.prepare('SELECT * FROM products').all();

    const scored = rows
      .map(row => ({ row, ...scoreProduct(row, a) }))

      .filter(s => unconstrained || s.score > 0)
      .sort((x, y) => y.score - x.score || y.norm - x.norm ||
                      String(x.row.id).localeCompare(String(y.row.id)));

    const pick = (respectBudget) => {
      const brandCount = {};
      const out = [];
      for (const s of scored) {
        if (out.length >= limit) break;
        const b = s.row.brand_fa || '—';
        if ((brandCount[b] || 0) >= 2) continue;

        const p = attachVariants(parseProduct(s.row));
        if (respectBudget && !inBudget(p.min_price, a.budget)) continue;

        brandCount[b] = (brandCount[b] || 0) + 1;
        out.push({
          id: p.id, slug: p.slug,
          name_fa: p.name_fa, name_en: p.name_en,
          brand_fa: p.brand_fa, brand_en: p.brand_en,
          gender: p.gender, family_fa: p.family_fa, family_slug: p.family_slug,
          season: p.season, occasion: p.occasion,

          notes_top: (p.notes?.top || []).slice(0, 3),
          image_url: p.image_url, min_price: p.min_price,
          _score: s.score
        });
      }
      return out;
    };

    let items = pick(true);
    let relaxed = false;

    if (items.length < 3 && a.budget) {
      const wider = pick(false);
      if (wider.length > items.length) { items = wider; relaxed = true; }
    }

    return { items, profile: a, relaxed };
  }

  function resolveCustomerId(mobile) {
    if (!mobile) return null;
    const row = db.prepare('SELECT id FROM customers WHERE mobile=?').get(mobile);
    if (row) return row.id;
    try {
      const r = db.prepare(
        `INSERT INTO customers (mobile, first_name) VALUES (?, ?)`
      ).run(mobile, 'مشتری');
      return r.lastInsertRowid;
    } catch {

      const again = db.prepare('SELECT id FROM customers WHERE mobile=?').get(mobile);
      return again ? again.id : null;
    }
  }

  function getProfile(customerId) {
    const row = db.prepare(
      'SELECT taste_profile, taste_updated_at FROM customers WHERE id=?'
    ).get(customerId);
    if (!row || !row.taste_profile) return null;
    try {
      const parsed = JSON.parse(row.taste_profile);
      return { answers: sanitize(parsed), updated_at: row.taste_updated_at };
    } catch { return null; }
  }

  function saveProfile(customerId, answers) {
    const clean = sanitize(answers);
    if (!isMeaningful(clean)) return false;
    db.prepare(
      `UPDATE customers SET taste_profile=?, taste_updated_at=datetime('now')
       WHERE id=?`
    ).run(JSON.stringify(clean), customerId);
    return true;
  }

  function clearProfile(customerId) {
    db.prepare(
      'UPDATE customers SET taste_profile=NULL, taste_updated_at=NULL WHERE id=?'
    ).run(customerId);
    return true;
  }

  return {
    recommend, getProfile, saveProfile, clearProfile, resolveCustomerId,
    sanitize, isMeaningful, describe, scoreProduct, inBudget, VALID
  };
}

module.exports = { build, sanitize, isMeaningful, describe, VALID };
