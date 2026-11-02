#!/usr/bin/env python3
"""A concurrent reset cannot let an old-password login create a fresh session."""
import concurrent.futures,hashlib,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='customer-reset-race-') as td:
 td=Path(td);db=str(td/'db.sqlite');signal=td/'verified';preload=td/'delay.js'
 preload.write_text("""const c=require('crypto'),fs=require('fs'),original=c.scryptSync;c.scryptSync=function(password,...rest){const out=original.call(c,password,...rest);if(String(password)==='Race-Old-Password-894'){fs.writeFileSync(process.env.RACE_SIGNAL,'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1200)}return out};""")
 def freeport():
  s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
 ports=[freeport(),freeport()];env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','ADMIN_PASSWORD':'Race-Owner-Password-982','SMS_PROVIDER':'console'}
 subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 mobile='09120001299';salt=os.urandom(16).hex();h=hashlib.scrypt(b'Race-Old-Password-894',salt=salt.encode(),n=16384,r=8,p=1,dklen=64,maxmem=33554432).hex();now=int(time.time()*1000)
 c=sqlite3.connect(db);c.execute("insert into customers(mobile,first_name,pass_hash,pass_salt) values(?,'Race',?,?)",(mobile,h,salt));c.execute('insert into customer_phone_verifications(mobile,verified_at,password_trusted) values(?,?,1)',(mobile,now));c.execute('insert into otp_codes(mobile,code,expires_at,last_sent,attempts) values(?,?,?,?,0)',(mobile,'24680',now+120000,now));c.commit();c.close()
 def boot(port,extra):
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**extra},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(200):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p
   except OSError:time.sleep(.1)
  p.terminate();raise RuntimeError('server timeout')
 def post(port,path,data):
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=8) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 servers=[]
 try:
  servers.append(boot(ports[0],{'NODE_OPTIONS':'--require='+str(preload),'RACE_SIGNAL':str(signal)}));servers.append(boot(ports[1],{}))
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   old=pool.submit(post,ports[0],'/api/auth/login',{'mobile':mobile,'password':'Race-Old-Password-894'})
   for _ in range(200):
    if signal.exists():break
    time.sleep(.01)
   else:raise RuntimeError('race did not reach old-password verification')
   status,reset=post(ports[1],'/api/auth/reset-password',{'mobile':mobile,'code':'24680','new_password':'Race-New-Password-925'})
   assert status==200 and reset.get('token'),reset
   status,result=old.result(timeout=8);assert status==401 and 'token' not in result,(status,result)
  c=sqlite3.connect(db);assert c.execute("select count(*) from sessions where kind='CUSTOMER_VERIFIED' and subject=?",(mobile,)).fetchone()[0]==1;c.close()
  assert post(ports[1],'/api/auth/login',{'mobile':mobile,'password':'Race-New-Password-925'})[0]==200
  print('PASS cross-process reset cannot revive an old password or session')
 finally:
  for p in servers:p.terminate()
  for p in servers:p.wait(timeout=10)
