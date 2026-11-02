#!/usr/bin/env python3
"""Existing DB: no auto-trust, backup-first additive phone-verification schema."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='phone-verification-migration-') as td:
 td=Path(td);db=td/'old.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','ADMIN_PASSWORD':'Phone-Migration-Owner-832'}
 subprocess.run(['node','-e',"const x=require('./src/db');const p=x.hashPassword('Legacy-Test-Password-63');x.db.prepare(\"insert into customers(mobile,first_name,pass_hash,pass_salt) values('09120007777','Legacy',?,?)\").run(p.hash,p.salt);x.db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 c=sqlite3.connect(db);c.execute('drop table customer_phone_verifications');c.execute("delete from settings where key='customer_phone_verification_schema_v1'")
 c.execute("insert into sessions(token,kind,subject,expires_at) values(?,'CUSTOMER','09120007777',?)",('a'*48,int(time.time()*1000)+600000))
 c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('LEGACY-ORDER',?,'Test','09120007777',1000,0,1000,'PAID')",(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),));c.commit()
 tables=[x[0] for x in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")];c.close()
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();proc=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body=None,token=None):
  headers={'Content-Type':'application/json'}
  if token:headers['X-Customer-Token']=token
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
  try:
   with urllib.request.urlopen(req,timeout=4) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server timeout')
  assert api('GET','/api/auth/me',token='a'*48)[1]['authenticated'] is False
  assert api('GET','/api/auth/orders',token='a'*48)[0]==401
  assert api('POST','/api/auth/login',{'mobile':'09120007777','password':'Legacy-Test-Password-63'})[0]==503
  assert api('POST','/api/auth/register',{'first_name':'Test','mobile':'09120007777','password':'Another-Password-63','code':'12345'})[0]==503
  assert api('POST','/api/auth/request-code',{'mobile':'09120007777'})[0]==400
  c=sqlite3.connect(db);assert not c.execute("select 1 from sqlite_master where name='customer_phone_verifications'").fetchone();assert c.execute("select status from orders where order_id='LEGACY-ORDER'").fetchone()[0]=='PAID';c.close()
 finally:proc.terminate();proc.wait(timeout=10)
 c=sqlite3.connect(db);before={t:c.execute(f'select * from "{t}" order by rowid').fetchall() for t in tables};c.close()
 def migrate(backup,*extra):return subprocess.run(['node','src/customer-phone-verification-cli.js','--db',str(db),'--backup',str(backup),*extra],cwd=root,capture_output=True,text=True,timeout=120)
 occupied=td/'occupied';occupied.write_bytes(b'keep');assert migrate(occupied,'--offline-confirmed').returncode!=0 and occupied.read_bytes()==b'keep'
 assert migrate(td/'no-confirm.sqlite').returncode!=0
 backup=td/'backup.sqlite';r=migrate(backup,'--offline-confirmed');assert r.returncode==0,r.stderr;assert json.loads(r.stdout)['backup_verified'] and (backup.stat().st_mode&0o777)==0o600
 b=sqlite3.connect(backup);a=sqlite3.connect(db)
 for t,rows in before.items():
  assert b.execute(f'select * from "{t}" order by rowid').fetchall()==rows,t
  if t=='settings':assert a.execute("select * from settings where key<>'customer_phone_verification_schema_v1' order by rowid").fetchall()==rows
  else:assert a.execute(f'select * from "{t}" order by rowid').fetchall()==rows,t
 assert b.execute('pragma integrity_check').fetchone()[0]=='ok' and a.execute('pragma integrity_check').fetchone()[0]=='ok'
 assert a.execute('select count(*) from customer_phone_verifications').fetchone()[0]==0
 assert a.execute("select status from orders where order_id='LEGACY-ORDER'").fetchone()[0]=='PAID';a.close();b.close()
 second=td/'second.sqlite';r=migrate(second,'--offline-confirmed');assert r.returncode==0 and json.loads(r.stdout)['result']['reason']=='already_installed'
print('PASS legacy sessions fail closed; backup-first schema migration preserves customers, sessions and orders without inferred trust')
