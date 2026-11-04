#!/usr/bin/env python3
"""Public liveness leaks no operational details; protected health enforces RBAC."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='admin-health-security-') as td:
 db=str(Path(td)/'shop.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Health-Test-Owner-982'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(method,path,body=None,token=None):
  h={'Content-Type':'application/json'}
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  code,data,h=call('GET','/api/health');assert code==200 and set(data)=={'status','products'} and data['status']=='ok' and data['products']>0 and h['Cache-Control']=='no-store'
  assert db not in json.dumps(data) and 'pending_orders' not in data and 'sessions' not in data and 'sms_provider' not in data
  assert call('GET','/api/admin/health')[0]==401
  with sqlite3.connect(db) as c:
   c.execute("insert into staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active) select 'support','Support','support',pass_hash,pass_salt,0,1 from staff where username='owner'");c.commit()
  status,login,_=call('POST','/api/admin/login',{'username':'support','password':'Health-Test-Owner-982'});assert status==200;support=login['token']
  code,data,h=call('GET','/api/admin/health',token=support);assert code==403 and data['required']=='system.logs' and h['Cache-Control']=='no-store' and 'Access-Control-Allow-Origin' not in h
  status,login,_=call('POST','/api/admin/login',{'username':'owner','password':'Health-Test-Owner-982'});assert status==200;owner=login['token']
  code,data,h=call('GET','/api/admin/health',token=owner);assert code==200 and data['db']==db and isinstance(data['pending_orders'],int) and 'sessions' in data and 'sms_provider' in data
  assert h['Cache-Control']=='no-store' and 'Access-Control-Allow-Origin' not in h
  assert call('GET','/api/admin/health',token='fake')[0]==401
  with sqlite3.connect(db) as c:assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
  print('PASS public health whitelist, private health RBAC, no-store, owner/support separation')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
