#!/usr/bin/env python3
"""Existing stores require explicit backup-first ledger migration; history is never inferred."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='stock-ledger-migration-') as td:
 td=Path(td);db=td/'old.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','ADMIN_PASSWORD':'Stock-Migration-Owner-693'}
 subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 c=sqlite3.connect(db);c.execute('drop table order_stock_reservations');c.execute("delete from settings where key='order_stock_reservations_schema_v1'")
 sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.stock=0 and v.type='EDP' and v.volume_ml=10 limit 1").fetchone()[0]
 c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('OLD-ORDER','2000-01-01T00:00:00Z','Test','09120000000',1000,0,1000,'PENDING')")
 c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('OLD-ORDER',?,'Test',1000,1,1000)",(sku,));c.commit()
 tables=[x[0] for x in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")];before={t:c.execute(f'select * from "{t}" order by rowid').fetchall() for t in tables};c.close()
 # Existing DB starts without modifying schema; checkout/readiness fail closed.
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();runenv={**env,'PORT':str(port)}
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=runenv,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body=None,token=None):
  headers={'Content-Type':'application/json'}
  if token:headers['Authorization']='Bearer '+token
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
  assert api('POST','/api/orders',{'customer_name':'Test','mobile':'09120000000','items':[{'sku':sku,'quantity':1}]})[0]==503
  code,login=api('POST','/api/admin/login',{'username':'owner','password':'Stock-Migration-Owner-693'});assert code==200;token=login['token']
  code,ready=api('GET','/api/admin/readiness',token=token);assert code==200 and next(x for x in ready['items'] if x['key']=='stock')['level']=='error'
  c=sqlite3.connect(db);assert c.execute("select status from orders where order_id='OLD-ORDER'").fetchone()[0]=='PENDING';assert not c.execute("select 1 from sqlite_master where name='order_stock_reservations'").fetchone();c.close()
 finally:proc.terminate();proc.wait(timeout=10)
 # Login/test traffic modifies logs/sessions, so capture final source immediately before offline backup.
 c=sqlite3.connect(db);before={t:c.execute(f'select * from "{t}" order by rowid').fetchall() for t in tables};c.close()
 def migrate(backup,*extra):return subprocess.run(['node','src/order-stock-reservation-cli.js','--db',str(db),'--backup',str(backup),*extra],cwd=root,capture_output=True,text=True,timeout=120)
 occupied=td/'occupied.db';occupied.write_bytes(b'do-not-overwrite');assert migrate(occupied,'--offline-confirmed').returncode!=0 and occupied.read_bytes()==b'do-not-overwrite'
 assert migrate(td/'without-confirm.sqlite').returncode!=0
 # Never write a backup where the live SQLite sidecars may appear.
 assert migrate(Path(str(db)+'-wal'),'--offline-confirmed').returncode!=0
 backup=td/'verified-backup.sqlite';r=migrate(backup,'--offline-confirmed');assert r.returncode==0,r.stderr;assert json.loads(r.stdout)['backup_verified'] and (backup.stat().st_mode&0o777)==0o600
 b=sqlite3.connect(backup);a=sqlite3.connect(db)
 for t,rows in before.items():
  assert b.execute(f'select * from "{t}" order by rowid').fetchall()==rows,t
  if t=='settings':assert a.execute("select * from settings where key<>'order_stock_reservations_schema_v1' order by rowid").fetchall()==rows
  else:assert a.execute(f'select * from "{t}" order by rowid').fetchall()==rows,t
 assert b.execute('pragma integrity_check').fetchone()[0]=='ok' and a.execute('pragma integrity_check').fetchone()[0]=='ok'
 assert a.execute('select count(*) from order_stock_reservations').fetchone()[0]==0 and a.execute("select status from orders where order_id='OLD-ORDER'").fetchone()[0]=='PENDING';a.close();b.close()
 second=td/'second-backup.sqlite';r=migrate(second,'--offline-confirmed');assert r.returncode==0 and json.loads(r.stdout)['result']['reason']=='already_installed'
print('PASS existing store fails closed; verified backup-first migration, unchanged historical tables and no inferred reservations')
