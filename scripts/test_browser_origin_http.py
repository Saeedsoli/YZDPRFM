#!/usr/bin/env python3
"""Real HTTP security checks on disposable databases and a mocked SMS provider."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='origin-http-') as td:
 td=Path(td);mock=td/'mock.js';mock.write_text("const s=require("+json.dumps(str(root/'src/sms.js'))+");s.sendOtp=async()=>({ok:true});s.testConnection=async()=>({ok:true,live:true});")
 def start(mode):
  sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();db=td/(mode+'.sqlite')
  env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':mode,'PORT':str(port),'SITE_URL':'https://shop.example.test','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Guard-Owner-Password-981','NODE_OPTIONS':'--require='+str(mock)}
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port,db
   except OSError:time.sleep(.05)
  raise RuntimeError('server did not start')
 def call(port,method,path,body=None,headers=None):
  h={'Content-Type':'application/json',**(headers or {})};req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=8) as r:return r.status,r.read(),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,e.read(),dict(e.headers)
 for mode in ('test','production'):
  p,port,db=start(mode);origin=f'http://127.0.0.1:{port}' if mode=='test' else 'https://shop.example.test'
  try:
   same={'Origin':origin,'Sec-Fetch-Site':'same-origin'};evil={'Origin':'https://evil.example','Sec-Fetch-Site':'cross-site'}
   sibling={'Origin':'https://sibling.example.test','Sec-Fetch-Site':'same-site'}
   for h in (evil,sibling,{'Origin':'null'},{'Sec-Fetch-Site':'same-site'},{'Sec-Fetch-Site':'cross-site'}):
    for method,path in [('POST','/api/auth/request-code'),('POST','/api/orders'),('PUT','/api/admin/variants/x'),('DELETE','/api/taste/profile')]:
     status,_,rh=call(port,method,path,{'mobile':'09120001234'},h);assert status==403 and rh.get('Cache-Control')=='no-store',(mode,method,path,status)
   with sqlite3.connect(db) as c:assert c.execute('select count(*) from otp_codes').fetchone()[0]==0 and c.execute('select count(*) from orders').fetchone()[0]==0
   # Same-origin owner session can be created; cross-origin logout cannot revoke it.
   status,body,_=call(port,'POST','/api/admin/login',{'username':'owner','password':'Guard-Owner-Password-981'},same);assert status==200,(mode,status,body);token=json.loads(body)['token']
   status,_,_=call(port,'POST','/api/admin/logout',{}, {**evil,'Authorization':'Bearer '+token});assert status==403
   with sqlite3.connect(db) as c:assert c.execute('select count(*) from sessions where token=?',(token,)).fetchone()[0]==1
   status,_,_=call(port,'POST','/api/auth/request-code',{'mobile':'09120001234'},same);assert status==200,(mode,status)
   # Non-browser integrations without Origin/Fetch-Metadata remain usable.
   status,_,_=call(port,'POST','/api/cart/calculate',{'items':[]});assert status==400
   status,_,_=call(port,'GET','/api/products?limit=1',headers=evil);assert status==200
   status,_,_=call(port,'OPTIONS','/api/orders',headers=evil);assert status==204
   if mode=='production':assert call(port,'GET','/payment/callback?order=INVALID&Authority=A&Status=OK',headers=evil)[0]==503
   assert p.poll() is None
  finally:p.terminate();p.wait(timeout=10)
 print('PASS cross-origin mutation rejection, same-origin sessions, API compatibility and callback behavior; fake SMS')
