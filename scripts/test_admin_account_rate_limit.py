#!/usr/bin/env python3
"""Distributed admin-login attempts must be limited per account across restarts."""
import hashlib,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='admin-account-limit-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'TestOwnerPassword-982'}
 subprocess.run(['node','-e',"const {db,hashPassword}=require('./src/db');const p=hashPassword('OtherTestPassword-472');db.prepare(\"insert into staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active,created_by) values('secondowner','Second','owner',?,?,0,1,'test')\").run(p.hash,p.salt);db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL)
 def boot():
  proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return proc
   except Exception:time.sleep(.1)
  proc.terminate();raise RuntimeError('server not ready')
 def stop(p):p.terminate();p.wait(timeout=10)
 def login(body,ip):
  req=urllib.request.Request(f'http://127.0.0.1:{port}/api/admin/login',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','X-Forwarded-For':ip},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=4) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 proc=boot()
 try:
  for i in range(6):
   body={'password':'wrong'} if i%2==0 else {'username':'OWNER','password':'wrong'}
   code,_=login(body,f'198.51.100.{i+1}');assert code==401,(i,code)
  code,r=login({'username':'owner','password':'TestOwnerPassword-982'},'198.51.100.20');assert code==429 and r.get('retry_after',0)>0
  # A different account is not locked by the first account's failures.
  assert login({'username':'secondowner','password':'OtherTestPassword-472'},'198.51.100.21')[0]==200
 finally:stop(proc)
 c=sqlite3.connect(db);key='login-account:'+hashlib.sha256(b'owner').hexdigest();row=c.execute('select count,blocked_until from rate_limits where bucket=?',(key,)).fetchone();assert row and row[0]==6 and row[1]>int(time.time()*1000)
 assert not c.execute("select 1 from rate_limits where bucket like '%TestOwnerPassword%' or bucket='login-account:owner'").fetchone();c.close()
 proc=boot()
 try:
  # Account lock survives restart and rotating the address.
  assert login({'username':'owner','password':'TestOwnerPassword-982'},'203.0.113.25')[0]==429
  c=sqlite3.connect(db);c.execute('update rate_limits set blocked_until=0,window_end=0 where bucket=?',(key,));c.commit();c.close()
  for i in range(5):assert login({'username':'owner','password':'wrong'},f'192.0.2.{i+1}')[0]==401
  assert login({'username':'owner','password':'TestOwnerPassword-982'},'192.0.2.20')[0]==200
  c=sqlite3.connect(db);assert not c.execute('select 1 from rate_limits where bucket=?',(key,)).fetchone();c.close()
  assert login({'username':'owner','password':'wrong'},'192.0.2.21')[0]==401
 finally:stop(proc)
print('PASS account login throttle across spoofed IPs, aliases and restart; isolated accounts and successful reset')
