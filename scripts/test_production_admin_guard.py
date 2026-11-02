#!/usr/bin/env python3
"""Production owner guard: new, existing, default, invalid and password changes."""
import hashlib,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='production-admin-guard-') as td:
 td=Path(td);base={**os.environ,'BACKUP_DISABLED':'1','NODE_ENV':'production'}
 def run(db,password=None,mode='production'):
  e={**base,'DB_PATH':str(db),'NODE_ENV':mode};e.pop('ADMIN_PASSWORD',None)
  if password is not None:e['ADMIN_PASSWORD']=password
  return subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=e,capture_output=True,text=True,timeout=120)
 for i,pw in enumerate([None,'','short','yazd1404','aaaaaaaaaaaa','password123456']):
  path=td/f'bad-{i}.sqlite';r=run(path,pw);assert r.returncode!=0 and not path.exists(),(i,r.stdout,r.stderr)
  if pw:assert pw not in r.stdout+r.stderr
 strong='Correct-Private-Seed-39281';safe=td/'safe.sqlite';r=run(safe,strong);assert r.returncode==0,r.stderr
 c=sqlite3.connect(safe);stored=c.execute("select pass_hash,pass_salt from staff where role_key='owner'").fetchone();assert stored;c.close()
 # The environment is only for initialization: existing safe owner is authoritative.
 r=run(safe,'yazd1404');assert r.returncode==0,r.stderr
 c=sqlite3.connect(safe);assert c.execute("select pass_hash,pass_salt from staff where role_key='owner'").fetchone()==stored;c.close()
 weak=td/'old-default.sqlite';r=run(weak,'yazd1404','test');assert r.returncode==0,r.stderr
 c=sqlite3.connect(weak);c.execute("update staff set must_change=0 where role_key='owner'");c.commit();weakrow=c.execute("select pass_hash,pass_salt from staff where role_key='owner'").fetchone();orders=c.execute('select * from orders').fetchall();c.close()
 before=hashlib.sha256(weak.read_bytes()).hexdigest()
 for password in [None,strong,'yazd1404']:
  r=run(weak,password);assert r.returncode!=0 and hashlib.sha256(weak.read_bytes()).hexdigest()==before
  assert strong not in r.stdout+r.stderr and 'yazd1404' not in r.stdout+r.stderr
 c=sqlite3.connect(weak);assert c.execute('select * from orders').fetchall()==orders;c.close()
 def copy(src,dst):
  a=sqlite3.connect(src);b=sqlite3.connect(dst);a.backup(b);b.close();a.close()
 mixed=td/'mixed.sqlite';copy(safe,mixed);c=sqlite3.connect(mixed)
 c.execute("insert into staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active,created_by) values('legacyowner','Legacy','owner',?,?,0,1,'test')",weakrow);c.commit();c.close()
 assert run(mixed,strong).returncode!=0
 c=sqlite3.connect(mixed);c.execute("update staff set active=0 where username='legacyowner'");c.commit();c.close();assert run(mixed).returncode==0
 invalid=td/'invalid.sqlite';copy(safe,invalid);c=sqlite3.connect(invalid);c.execute("update staff set pass_hash='bad' where role_key='owner'");c.commit();c.close();assert run(invalid,strong).returncode!=0
 inactive=td/'inactive.sqlite';copy(safe,inactive);c=sqlite3.connect(inactive);c.execute("update staff set active=0 where role_key='owner'");c.commit();c.close();assert run(inactive,strong).returncode!=0
 # Real HTTP: an authenticated production owner cannot change to the default/weak value.
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();e={**base,'DB_PATH':str(safe),'PORT':str(port)};e.pop('ADMIN_PASSWORD',None)
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=e,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(route,body,token=None):
  h={'Content-Type':'application/json'}
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+route,data=json.dumps(body).encode(),headers=h,method='POST')
  try:
   with urllib.request.urlopen(req,timeout=4) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as ex:return ex.code,json.load(ex)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server timeout')
  code,login=api('/api/admin/login',{'username':'owner','password':strong});assert code==200,login
  token=login['token']
  for candidate in ['yazd1404','aaaaaaaaaaaa','password123456']:
   code,_=api('/api/admin/change-password',{'current':strong,'new_password':candidate},token);assert code==400,code
  assert api('/api/admin/login',{'username':'owner','password':strong})[0]==200
 finally:proc.terminate();proc.wait(timeout=10)
print('PASS production guard: secure first boot, stored owner authority, default/invalid/inactive rejection and owner password policy')
