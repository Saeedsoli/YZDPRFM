#!/usr/bin/env python3
"""Customer cookie-only sessions and bearer-compatible APIs on a disposable DB."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='customer-cookie-test-') as tmp:
 td=Path(tmp);db=td/'db.sqlite';mock=td/'sms.js';mock.write_text("const s=require("+json.dumps(str(root/'src/sms.js'))+");s.sendOtp=async()=>({ok:true});")
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'NODE_OPTIONS':'--require='+str(mock)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body=None,headers=None):
  h={'Content-Type':'application/json',**(headers or {})};req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def code(phone):
  assert api('POST','/api/auth/request-code',{'mobile':phone})[0]==200
  with sqlite3.connect(db) as c:return c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
 def cookie(h):
  c=h['Set-Cookie'];assert 'HttpOnly' in c and 'SameSite=Lax' in c and h.get('Cache-Control')=='no-store';return c.split(';',1)[0]
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  phone='09120002001';flag={'X-Customer-Cookie-Only':'1'}
  status,r,h=api('POST','/api/auth/register',{'mobile':phone,'first_name':'کاربر','password':'Cookie-Password-982','code':code(phone)},flag);assert status==201 and 'token' not in r;registered=cookie(h)
  assert api('GET','/api/auth/me',headers={'Cookie':registered})[1]['authenticated']
  status,r,h=api('POST','/api/auth/login',{'mobile':phone,'password':'Cookie-Password-982'},flag);assert status==200 and 'token' not in r;old=cookie(h)
  status,r,h=api('POST','/api/auth/reset-password',{'mobile':phone,'code':code(phone),'new_password':'New-Cookie-Password-982'},flag);assert status==200 and 'token' not in r;reset=cookie(h)
  assert not api('GET','/api/auth/me',headers={'Cookie':old})[1]['authenticated']
  assert api('GET','/api/auth/me',headers={'Cookie':reset})[1]['authenticated']
  guest='09120002002';status,r,h=api('POST','/api/auth/verify-code',{'mobile':guest,'code':code(guest)},flag);assert status==200 and 'token' not in r;guest_cookie=cookie(h)
  assert api('GET','/api/auth/me',headers={'Cookie':guest_cookie})[1]['mobile']==guest
  assert api('POST','/api/auth/logout',{}, {'Cookie':guest_cookie})[0]==200
  assert not api('GET','/api/auth/me',headers={'Cookie':guest_cookie})[1]['authenticated']
  # Explicit token clients continue to receive and use a token.
  api_phone='09120002003';status,r,_=api('POST','/api/auth/verify-code',{'mobile':api_phone,'code':code(api_phone)});assert status==200 and r['token']
  assert api('GET','/api/auth/me',headers={'X-Customer-Token':r['token']})[1]['mobile']==api_phone
  app=(root/'public/assets/app.js').read_text();login=(root/'public/login.html').read_text();account=(root/'public/account.html').read_text()
  assert "setItem('yazd_customer_token'" not in app+login+account and "getItem('yazd_customer_token'" not in app+login+account
  print('PASS cookie-only register/login/reset/OTP, logout and token API compatibility; mocked SMS')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
