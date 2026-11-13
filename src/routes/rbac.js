'use strict';
const {strongInitialSecret} = require('../production-admin-guard');
const crypto = require('crypto');

function send(fn, ...args) { fn(...args); return true; }

async function handle(ctx) {
  const {
    method, pathname, req, res, sendJSON, can, logAudit, who,
    parseBody, db, appLog, perms, cleanText, normalizeDigits,
    getStaff, getStaffByUsername, listStaff, listRoles, getRole,
    hashPassword, verifyPassword,

    otp, notify, faNum, getToken,

    publicStaff
  } = ctx;

  if (method === 'GET' && pathname === '/api/admin/whoami') {
    if (!who) return send(sendJSON, 401, { error: 'وارد نشده‌اید.' });
    return send(sendJSON, 200, {
      id: who.id, username: who.username, display_name: who.display_name,
      role_key: who.role_key, role_name: who.role_name,
      permissions: who.permissions, must_change: who.must_change
    });
  }

  if (method === 'GET' && pathname === '/api/admin/permissions') {
    if (!can('roles.manage')) return true;
    return send(sendJSON, 200, { groups: perms.groupedPermissions() });
  }

  if (method === 'GET' && pathname === '/api/admin/roles') {
    if (!can('staff.view')) return true;
    return send(sendJSON, 200, { roles: listRoles() });
  }

  if (method === 'POST' && pathname === '/api/admin/roles') {
    if (!can('roles.manage')) return true;
    const b = await parseBody(req);

    const key = String(b.key || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,23}$/.test(key)) {
      return send(sendJSON, 400, {
        error: 'شناسه نقش باید ۲ تا ۲۴ نویسه لاتین کوچک باشد و با حرف شروع شود.'
      });
    }
    if (getRole(key)) return send(sendJSON, 409, { error: 'نقشی با این شناسه وجود دارد.' });

    const name = cleanText(b.name, 40);
    if (!name) return send(sendJSON, 400, { error: 'نام نقش را وارد کنید.' });

    const list = perms.sanitizePermissions(b.permissions);
    if (!list.length) return send(sendJSON, 400, { error: 'دست‌کم یک مجوز انتخاب کنید.' });

    const escalation = list.filter(k => k === 'roles.manage' || k === 'staff.manage');
    if (escalation.length && who.role_key !== 'owner') {
      return send(sendJSON, 403, {
        error: 'تنها مدیر کل می‌تواند مجوز مدیریت کارکنان یا نقش‌ها بدهد.'
      });
    }

    db.prepare(`
      INSERT INTO roles (key, name, description, permissions, builtin, locked)
      VALUES (?,?,?,?,0,0)
    `).run(key, name, cleanText(b.description, 200), JSON.stringify(list));

    appLog('INFO', 'staff', 'نقش تازه ساخته شد', { key, by: who.username });
    logAudit('roles.manage', { target: key, detail: { action: 'create', permissions: list.length } });
    return send(sendJSON, 201, { message: `نقش «${name}» ساخته شد.`, role: getRole(key) });
  }

  if (method === 'PUT' && pathname.startsWith('/api/admin/roles/')) {
    if (!can('roles.manage')) return true;
    const key = decodeURIComponent(pathname.replace('/api/admin/roles/', ''));
    const role = getRole(key);
    if (!role) return send(sendJSON, 404, { error: 'نقش یافت نشد.' });
    if (role.locked) {
      return send(sendJSON, 403, { error: 'مجوزهای مدیر کل قابل تغییر نیست.' });
    }

    if (key === who.role_key && who.role_key !== 'owner') {
      logAudit('roles.manage', {
        target: key, allowed: false,
        detail: { reason: 'تلاش برای ویرایش نقش خود' }
      });
      appLog('WARN', 'security', 'تلاش برای ویرایش نقش خود',
             { by: who.username, role: key });
      return send(sendJSON, 403, {
        error: 'نقش خودتان را نمی‌توانید ویرایش کنید. مدیر کل باید این کار را بکند.'
      });
    }

    const b = await parseBody(req);
    const name = b.name != null ? cleanText(b.name, 40) : role.name;
    const desc = b.description != null ? cleanText(b.description, 200) : role.description;
    const list = b.permissions != null
      ? perms.sanitizePermissions(b.permissions)
      : role.permissions;

    if (!name) return send(sendJSON, 400, { error: 'نام نقش نمی‌تواند خالی باشد.' });
    if (!list.length) return send(sendJSON, 400, { error: 'دست‌کم یک مجوز انتخاب کنید.' });

    const escalation = list.filter(k => k === 'roles.manage' || k === 'staff.manage');
    if (escalation.length && who.role_key !== 'owner') {
      return send(sendJSON, 403, {
        error: 'تنها مدیر کل می‌تواند مجوز مدیریت کارکنان یا نقش‌ها بدهد.'
      });
    }

    db.prepare(
      'UPDATE roles SET name=?, description=?, permissions=?, updated_at=? WHERE key=?'
    ).run(name, desc, JSON.stringify(list), new Date().toISOString(), key);

    appLog('INFO', 'staff', 'نقش ویرایش شد', { key, by: who.username });
    logAudit('roles.manage', {
      target: key,
      detail: { action: 'update', before: role.permissions.length, after: list.length }
    });
    return send(sendJSON, 200, { message: 'نقش به‌روزرسانی شد.', role: getRole(key) });
  }

  if (method === 'DELETE' && pathname.startsWith('/api/admin/roles/')) {
    if (!can('roles.manage')) return true;
    const key = decodeURIComponent(pathname.replace('/api/admin/roles/', ''));
    const role = getRole(key);
    if (!role) return send(sendJSON, 404, { error: 'نقش یافت نشد.' });
    if (role.builtin) return send(sendJSON, 403, { error: 'نقش‌های پیش‌فرض حذف نمی‌شوند.' });

    const inUse = db.prepare('SELECT COUNT(*) n FROM staff WHERE role_key=?').get(key).n;
    if (inUse) {
      return send(sendJSON, 409, {
        error: `${faNum(inUse)} کارمند این نقش را دارند. اول نقششان را عوض کنید.`
      });
    }

    db.prepare('DELETE FROM roles WHERE key=?').run(key);
    appLog('INFO', 'staff', 'نقش حذف شد', { key, by: who.username });
    logAudit('roles.manage', { target: key, detail: { action: 'delete' } });
    return send(sendJSON, 200, { message: 'نقش حذف شد.' });
  }

  if (method === 'GET' && pathname === '/api/admin/staff') {
    if (!can('staff.view')) return true;
    return send(sendJSON, 200, { staff: listStaff() });
  }

  if (method === 'POST' && pathname === '/api/admin/staff') {
    if (!can('staff.manage')) return true;
    const b = await parseBody(req);

    const nid = normalizeDigits(b.national_id);
    if (!/^\d{10}$/.test(nid)) {
      return send(sendJSON, 400, { error: 'کد ملی باید دقیقاً ۱۰ رقم باشد.' });
    }
    if (getStaffByUsername(nid)) {
      return send(sendJSON, 409, { error: 'کارمندی با این کد ملی قبلاً ثبت شده است.' });
    }

    const firstName = cleanText(b.first_name, 40);
    if (!firstName) return send(sendJSON, 400, { error: 'نام را وارد کنید.' });
    const lastName = cleanText(b.last_name, 40);
    if (!lastName) return send(sendJSON, 400, { error: 'نام خانوادگی را وارد کنید.' });
    const display = `${firstName} ${lastName}`.trim();

    const role = getRole(String(b.role_key || '').trim());
    if (!role) return send(sendJSON, 400, { error: 'نقش انتخابی معتبر نیست.' });

    if (role.key === 'owner' && who.role_key !== 'owner') {
      return send(sendJSON, 403, { error: 'تنها مدیر کل می‌تواند مدیر کل تعریف کند.' });
    }

    const mobile = otp.normalizeMobile(b.mobile);
    if (!otp.isValidMobile(mobile)) {
      return send(sendJSON, 400, { error: 'شماره موبایل معتبر نیست.' });
    }

    const tempPassword = crypto.randomBytes(18).toString('base64url');

    const { hash, salt } = hashPassword(tempPassword);
    const info = db.prepare(`
      INSERT INTO staff (username, national_id, first_name, last_name,
                         display_name, mobile, role_key,
                         pass_hash, pass_salt, must_change, active, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,1,1,?)
    `).run(nid, nid, firstName, lastName, display, mobile, role.key,
           hash, salt, who.username);

    appLog('INFO', 'staff', 'کارمند تازه اضافه شد',
           { username: nid, role: role.key, by: who.username });
    logAudit('staff.manage', {
      target: nid, detail: { action: 'create', role: role.key }
    });

    let smsSent = false;
    try { smsSent = !!(await notify.sendStaffNotice(mobile)); } catch { smsSent = false; }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');

    return send(sendJSON, 201, {
      message: smsSent
        ? `حساب «${display}» ساخته شد؛ درخواست پیامک اطلاع‌رسانی پذیرفته شد.`
        : `حساب «${display}» ساخته شد؛ پیامک اطلاع‌رسانی ارسال نشد.`,
      sms_sent: smsSent,
      temp_password: tempPassword,
      staff: publicStaff(getStaff(info.lastInsertRowid))
    });
  }

  if (method === 'PUT' && /^\/api\/admin\/staff\/\d+$/.test(pathname)) {
    if (!can('staff.manage')) return true;
    const id = parseInt(pathname.split('/').pop());
    const target = getStaff(id);
    if (!target) return send(sendJSON, 404, { error: 'کارمند یافت نشد.' });

    const b = await parseBody(req);
    const fields = [], args = [];
    const isSelf = target.id === who.id;
    const iAmOwner = who.role_key === 'owner';

    if (target.role_key === 'owner' && !iAmOwner) {
      logAudit('staff.manage', {
        target: target.username, allowed: false,
        detail: { reason: 'تلاش برای تغییر حساب مدیر کل' }
      });
      appLog('WARN', 'security', 'تلاش برای دست بردن در حساب مدیر کل',
             { by: who.username, target: target.username });
      return send(sendJSON, 403, {
        error: 'حساب مدیر کل را تنها خودِ مدیر کل می‌تواند تغییر دهد.'
      });
    }

    if (b.role_key != null && b.role_key !== target.role_key && isSelf) {
      logAudit('staff.manage', {
        target: target.username, allowed: false,
        detail: { reason: 'تلاش برای تغییر نقش خود' }
      });
      appLog('WARN', 'security', 'تلاش برای تغییر نقش خود',
             { by: who.username, to: String(b.role_key) });
      return send(sendJSON, 403, {
        error: 'نقش خودتان را نمی‌توانید عوض کنید. مدیر کل دیگری باید این کار را بکند.'
      });
    }

    if (b.password && isSelf) {
      return send(sendJSON, 400, {
        error: 'برای رمز خودتان از «تغییر رمز عبور» استفاده کنید.'
      });
    }

    if (b.display_name != null) {
      const dn = cleanText(b.display_name, 60);
      if (!dn) return send(sendJSON, 400, { error: 'نام نمی‌تواند خالی باشد.' });
      fields.push('display_name=?'); args.push(dn);
    }

    if (b.mobile !== undefined) {
      const m = b.mobile ? otp.normalizeMobile(b.mobile) : null;
      if (m && !otp.isValidMobile(m)) {
        return send(sendJSON, 400, { error: 'شماره موبایل معتبر نیست.' });
      }
      fields.push('mobile=?'); args.push(m);
    }

    if (b.role_key != null && b.role_key !== target.role_key) {
      const role = getRole(String(b.role_key));
      if (!role) return send(sendJSON, 400, { error: 'نقش انتخابی معتبر نیست.' });
      if (role.key === 'owner' && who.role_key !== 'owner') {
        return send(sendJSON, 403, { error: 'تنها مدیر کل می‌تواند نقش مدیر کل بدهد.' });
      }

      if (target.role_key === 'owner') {
        const owners = db.prepare(
          "SELECT COUNT(*) n FROM staff WHERE role_key='owner' AND active=1"
        ).get().n;
        if (owners <= 1) {
          return send(sendJSON, 409, {
            error: 'این تنها مدیر کل فعال است. اول یک مدیر کل دیگر تعریف کنید.'
          });
        }
      }
      fields.push('role_key=?'); args.push(role.key);
    }

    if (b.active != null) {
      const act = b.active ? 1 : 0;
      if (!act && target.id === who.id) {
        return send(sendJSON, 400, { error: 'نمی‌توانید حساب خودتان را غیرفعال کنید.' });
      }
      if (!act && target.role_key === 'owner') {
        const owners = db.prepare(
          "SELECT COUNT(*) n FROM staff WHERE role_key='owner' AND active=1"
        ).get().n;
        if (owners <= 1) {
          return send(sendJSON, 409, { error: 'آخرین مدیر کل فعال را نمی‌توان غیرفعال کرد.' });
        }
      }
      fields.push('active=?'); args.push(act);
    }

    if (b.password) {
      if (String(process.env.NODE_ENV||'').trim().toLowerCase()==='production' &&
          (target.role_key==='owner' || b.role_key==='owner') && !strongInitialSecret(String(b.password))) {
        return send(sendJSON, 400, { error: 'رمز مدیر کل باید دست‌کم ۱۲ نویسه باشد و از الگوهای ساده استفاده نکند.' });
      }
      if (String(b.password).length < 8) {
        return send(sendJSON, 400, { error: 'رمز باید حداقل ۸ نویسه باشد.' });
      }
      const { hash, salt } = hashPassword(b.password);
      fields.push('pass_hash=?', 'pass_salt=?', 'must_change=?');
      args.push(hash, salt, 1);

      db.prepare("DELETE FROM sessions WHERE kind='ADMIN' AND subject=?")
        .run(String(id));
    }

    if (!fields.length) return send(sendJSON, 400, { error: 'تغییری ارسال نشد.' });

    args.push(id);
    db.prepare(`UPDATE staff SET ${fields.join(', ')} WHERE id=?`).run(...args);

    appLog('INFO', 'staff', 'کارمند ویرایش شد',
           { username: target.username, by: who.username });
    logAudit('staff.manage', {
      target: target.username,
      detail: { action: 'update', fields: Object.keys(b).filter(k => k !== 'password') }
    });

    return send(sendJSON, 200, { message: 'اطلاعات به‌روزرسانی شد.', staff: publicStaff(getStaff(id)) });
  }

  if (method === 'DELETE' && /^\/api\/admin\/staff\/\d+$/.test(pathname)) {
    if (!can('staff.manage')) return true;
    const id = parseInt(pathname.split('/').pop());
    const target = getStaff(id);
    if (!target) return send(sendJSON, 404, { error: 'کارمند یافت نشد.' });

    if (target.id === who.id) {
      return send(sendJSON, 400, { error: 'نمی‌توانید حساب خودتان را حذف کنید.' });
    }

    if (target.role_key === 'owner' && who.role_key !== 'owner') {
      logAudit('staff.manage', {
        target: target.username, allowed: false,
        detail: { reason: 'تلاش برای حذف مدیر کل' }
      });
      appLog('WARN', 'security', 'تلاش برای حذف حساب مدیر کل',
             { by: who.username, target: target.username });
      return send(sendJSON, 403, {
        error: 'حساب مدیر کل را تنها خودِ مدیر کل می‌تواند حذف کند.'
      });
    }
    if (target.role_key === 'owner') {
      const owners = db.prepare(
        "SELECT COUNT(*) n FROM staff WHERE role_key='owner'"
      ).get().n;
      if (owners <= 1) {
        return send(sendJSON, 409, { error: 'آخرین مدیر کل حذف نمی‌شود.' });
      }
    }

    db.prepare("DELETE FROM sessions WHERE kind='ADMIN' AND subject=?").run(String(id));
    db.prepare('DELETE FROM staff WHERE id=?').run(id);

    appLog('INFO', 'staff', 'کارمند حذف شد',
           { username: target.username, by: who.username });
    logAudit('staff.manage', { target: target.username, detail: { action: 'delete' } });
    return send(sendJSON, 200, { message: `حساب «${target.display_name}» حذف شد.` });
  }

  if (method === 'POST' && pathname === '/api/admin/change-password') {
    if (!who) return send(sendJSON, 401, { error: 'وارد نشده‌اید.' });
    const b = await parseBody(req);

    const cur = db.prepare('SELECT * FROM staff WHERE id=?').get(who.id);
    if (!verifyPassword(String(b.current || ''), cur.pass_hash, cur.pass_salt)) {
      logAudit('auth.change_password', { allowed: false });
      return send(sendJSON, 401, { error: 'رمز فعلی نادرست است.' });
    }

    const next = String(b.new_password || '');
    if (String(process.env.NODE_ENV||'').trim().toLowerCase()==='production' && cur.role_key==='owner' && !strongInitialSecret(next)) {
      return send(sendJSON, 400, { error: 'رمز مدیر کل باید دست‌کم ۱۲ نویسه باشد و از الگوهای ساده استفاده نکند.' });
    }
    if (next.length < 8) {
      return send(sendJSON, 400, { error: 'رمز تازه باید حداقل ۸ نویسه باشد.' });
    }
    if (verifyPassword(next, cur.pass_hash, cur.pass_salt)) {
      return send(sendJSON, 400, { error: 'رمز تازه باید با رمز فعلی فرق کند.' });
    }

    const { hash, salt } = hashPassword(next);
    db.prepare('UPDATE staff SET pass_hash=?, pass_salt=?, must_change=0 WHERE id=?')
      .run(hash, salt, who.id);

    const tok = getToken(req);
    db.prepare("DELETE FROM sessions WHERE kind='ADMIN' AND subject=? AND token!=?")
      .run(String(who.id), tok);

    appLog('INFO', 'auth', 'رمز کارمند تغییر کرد', { user: who.username });
    logAudit('auth.change_password');
    return send(sendJSON, 200, { message: 'رمز عبور تغییر کرد.' });
  }

  return false;
}

module.exports = { handle };
