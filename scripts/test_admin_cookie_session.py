#!/usr/bin/env python3
"""Cookie-only browser login and legacy bearer API on a disposable database."""
import json,os,socket,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='admin-cookie-test-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Cookie-Test-Owner-981'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body=None,headers=None):
  h={'Content-Type':'application/json',**(headers or {})};req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  credentials={'username':'owner','password':'Cookie-Test-Owner-981'}
  status,login,h=api('POST','/api/admin/login',credentials,{'X-Admin-Cookie-Only':'1','Origin':base});assert status==200 and 'token' not in login and h.get('Cache-Control')=='no-store'
  cookie=h['Set-Cookie'];assert 'HttpOnly' in cookie and 'SameSite=Lax' in cookie;cookie=cookie.split(';',1)[0]
  status,who,h=api('GET','/api/admin/whoami',headers={'Cookie':cookie});assert status==200 and who['username']=='owner' and h.get('Cache-Control')=='no-store'
  status,_,_=api('POST','/api/admin/logout',{}, {'Cookie':cookie,'Origin':base});assert status==200
  assert api('GET','/api/admin/whoami',headers={'Cookie':cookie})[0]==401
  status,login,_=api('POST','/api/admin/login',credentials);assert status==200 and login['token']
  assert api('GET','/api/admin/whoami',headers={'Authorization':'Bearer '+login['token']})[0]==200
  admin=(root/'public/admin.html').read_text();invoice=(root/'public/invoice.html').read_text();label=(root/'public/label.html').read_text()
  assert "localStorage.setItem('yazd_admin_token'" not in admin and 'X-Admin-Cookie-Only' in admin
  assert "getItem('yazd_admin_token')" not in invoice and "getItem('yazd_admin_token')" not in label
  assert "removeItem('yazd_admin_token')" in invoice and "removeItem('yazd_admin_token')" in label
  print('PASS cookie-only admin response, no-store, logout and backward-compatible Bearer API')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
