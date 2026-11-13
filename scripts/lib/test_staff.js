'use strict';

const crypto = require('crypto');

function nidFor(alias) {
  const h = crypto.createHash('md5').update(String(alias)).digest('hex');
  const n = parseInt(h.slice(0, 9), 16) % 9000000000 + 1000000000;
  return String(n);
}

function mobileFor(alias) {
  const h = crypto.createHash('md5').update('m' + alias).digest('hex');
  const n = parseInt(h.slice(0, 8), 16) % 90000000 + 10000000;
  return '091' + String(n);
}

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
