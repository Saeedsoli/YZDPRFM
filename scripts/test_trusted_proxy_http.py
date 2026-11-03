#!/usr/bin/env python3
"""Rate limits resist forged forwarded headers in a disposable fake-proxy setup."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='trusted-proxy-http-') as td:
 td=Path(td);mock=td/'fake-sms.js';mock.write_text("const s=require("+json.dumps(str(root/'src/sms.js'))+");s.sendOtp=async()=>({ok:true});")
 def boot(name,trusted):
  s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();db=td/(name+'.sqlite')
  env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Proxy-Test-Owner-981','NODE_OPTIONS':'--require='+str(mock),'TRUSTED_PROXY_CIDRS':trusted}
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port,db
   except OSError:time.sleep(.05)
  raise RuntimeError('server startup timed out')
 def api(port,method,path,body=None,headers=None):
  h={'Content-Type':'application/json',**(headers or {})};req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 for trusted in ('','127.0.0.1/32'):
  p,port,db=boot('proxy' if trusted else 'direct',trusted)
  try:
   for i in range(13):
    spoof=f'203.0.113.{i+1}';chain=f'{spoof}, 198.51.100.100' if trusted else spoof
    status,_=api(port,'POST','/api/auth/request-code',{'mobile':f'0913{i:07d}'},{'X-Forwarded-For':chain})
    assert status==(200 if i<12 else 429),(trusted,i,status)
   with sqlite3.connect(db) as c:
    key='otp-ip:198.51.100.100' if trusted else 'otp-ip:127.0.0.1'
    assert c.execute('select count from rate_limits where bucket=?',(key,)).fetchone()[0]==12
    assert not c.execute("select 1 from rate_limits where bucket like 'otp-ip:203.0.113.%'").fetchone()
   if trusted:
    status,_=api(port,'POST','/api/auth/request-code',{'mobile':'09139999999'},{'X-Forwarded-For':'203.0.113.4, 198.51.100.101'});assert status==200
   # Readiness must warn; configured text is not proof of a real network test.
   status,auth=api(port,'POST','/api/admin/login',{'username':'owner','password':'Proxy-Test-Owner-981'});assert status==200
   status,ready=api(port,'GET','/api/admin/readiness',headers={'Authorization':'Bearer '+auth['token']});assert status==200
   item=next(x for x in ready['items'] if x['key']=='proxy');assert item['level']=='warn' and 'پروکسی' in item['message']
  finally:p.terminate();p.wait(timeout=10)
 bad=td/'bad.sqlite';env={**os.environ,'DB_PATH':str(bad),'BACKUP_DISABLED':'1','NODE_ENV':'test','TRUSTED_PROXY_CIDRS':'0.0.0.0/0'}
 p=subprocess.run(['node','src/server.js'],cwd=root,env=env,capture_output=True,text=True,timeout=20)
 assert p.returncode!=0 and 'Invalid trusted proxy configuration' in p.stderr and not bad.exists()
 print('PASS forged forwarded IP rejected, trusted proxy chain, rate buckets and readiness; mocked SMS only')
