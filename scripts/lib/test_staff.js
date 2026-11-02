/**
 * کمک‌کننده مشترک ساخت کارمند آزمایشی.
 *
 * چرا وجود دارد:
 *   نام کاربری کارمند از «حرفی دلخواه» به «کد ملی ۱۰ رقمی» تغییر
 *   کرد و رمز اولیه تصادفی و مستقل از شماره موبایل ساخته می‌شود. پنج
 *   آزمون این منطق را تکرار می‌کردند و همه با هم شکستند.
 *
 *   حالا یک جا تعریف شده: اگر قاعده دوباره عوض شود، فقط همین
 *   فایل تغییر می‌کند.
 *
 * کد ملی و موبایل از روی نام مستعار ساخته می‌شوند تا:
 *   • یکتا باشند (تداخل بین آزمون‌ها نباشد)
 *   • پایدار باشند (هر اجرا همان مقدار)
 *   • قابل پاک‌سازی باشند
 */
'use strict';

const crypto = require('crypto');

/** کد ملی ۱۰ رقمی یکتا و پایدار از روی یک نام */
function nidFor(alias) {
  const h = crypto.createHash('md5').update(String(alias)).digest('hex');
  const n = parseInt(h.slice(0, 9), 16) % 9000000000 + 1000000000;
  return String(n);
}

/** شماره موبایل یکتا و پایدار از روی یک نام */
function mobileFor(alias) {
  const h = crypto.createHash('md5').update('m' + alias).digest('hex');
  const n = parseInt(h.slice(0, 8), 16) % 90000000 + 10000000;
  return '091' + String(n);
}

/**
 * ساخت کارمند و آماده‌سازی برای کار.
 *
 * سرور رمز موقت تصادفی را یک‌بار به مدیر می‌دهد و
 * کارمند تا عوض نکردنش هیچ کاری نمی‌تواند بکند — پس اینجا هم
 * عوضش می‌کنیم تا آزمون بتواند مرزهای دسترسی را بسنجد.
 *
 * @returns {Promise<{token:string|null, nid:string, mobile:string, id:number|null}>}
 */
async function makeStaff(api, ownerToken, alias, roleKey) {
  const nid = nidFor(alias);
  const mobile = mobileFor(alias);

  const created = await api('/api/admin/staff', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'آزمایشی',
      last_name: alias,
      national_id: nid,
      mobile,
      role_key: roleKey
    })
  }, ownerToken);

  if (created.status !== 201) {
    return { token: null, nid, mobile, id: null, error: created.json.error };
  }

  const tempPassword = created.json.temp_password;
  if (!tempPassword) return {token:null,nid,mobile,id:created.json.staff?.id,error:'missing temporary credential'};
  const freshPassword = 'Tst' + nid.slice(0, 8);

  const login = p => api('/api/admin/login', {
    method: 'POST', body: JSON.stringify({ username: nid, password: p })
  });

  const first = (await login(tempPassword)).json.token;
  if (!first) return { token: null, nid, mobile, id: created.json.staff?.id };

  await api('/api/admin/change-password', {
    method: 'POST',
    body: JSON.stringify({ current: tempPassword, new_password: freshPassword })
  }, first);

  const token = (await login(freshPassword)).json.token || null;
  return { token, nid, mobile, id: created.json.staff?.id, password: freshPassword };
}

/** پاک‌سازی کارکنان آزمایشی از روی نام مستعارشان */
function cleanupStaff(db, aliases) {
  for (const alias of aliases) {
    const nid = nidFor(alias);
    const s = db.prepare('SELECT id FROM staff WHERE username=?').get(nid);
    if (s) {
      db.prepare("DELETE FROM sessions WHERE kind='ADMIN' AND subject=?").run(String(s.id));
      db.prepare('DELETE FROM audit_log WHERE staff_id=?').run(s.id);
      db.prepare('DELETE FROM staff WHERE id=?').run(s.id);
    }
  }
}

module.exports = { nidFor, mobileFor, makeStaff, cleanupStaff };
