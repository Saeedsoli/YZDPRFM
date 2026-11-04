#!/usr/bin/env python3
"""Offline attempt recovery: verified backup, no changes to payment or stock."""
import hashlib,json,os,sqlite3,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='attempt-recovery-') as td:
 t=Path(td);db=t/'shop.sqlite';backup=t/'backup.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test'}
 def run(*args):return subprocess.run(['node',*map(str,args)],cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 r=run('-e',"require('./src/db').db.close()");assert r.returncode==0,r.stderr
 key=hashlib.sha256(b'fixture-key').hexdigest();payload=hashlib.sha256(b'fixture-payload').hexdigest()
 with sqlite3.connect(db) as c:
  sku=c.execute('select sku from variants limit 1').fetchone()[0]
  c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status,payment_ref) values('RECOVER-ORDER','2026-01-01','Test','09120001111',1000,0,1000,'PENDING',NULL)")
  c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('RECOVER-ORDER',?,'Test',1000,1,1000)",(sku,))
  c.execute("insert into order_idempotency values(?,?,?,'CREATING',NULL,?,?)",(key,payload,'RECOVER-ORDER',1000000,1000000));c.commit()
  order_before=c.execute("select * from orders where order_id='RECOVER-ORDER'").fetchone();item_before=c.execute("select * from order_items where order_id='RECOVER-ORDER'").fetchall();stock_before=c.execute('select stock from variants where sku=?',(sku,)).fetchone()
 command=['src/order-attempt-recovery-cli.js','--db',db,'--backup',backup,'--order-id','RECOVER-ORDER','--actor','owner','--note','All writers stopped and gateway checked','--offline-confirmed']
 missing=run(*command[:-1]);assert missing.returncode!=0 and not backup.exists()
 result=run(*command);assert result.returncode==0,result.stderr;data=json.loads(result.stdout);assert data['backup_verified'] and data['result']['ok'] and data['order_payment_and_stock_unchanged']
 with sqlite3.connect(backup) as b,sqlite3.connect(db) as c:
  assert b.execute('pragma integrity_check').fetchone()[0]=='ok' and c.execute('pragma integrity_check').fetchone()[0]=='ok'
  assert b.execute("select state from order_idempotency where order_id='RECOVER-ORDER'").fetchone()[0]=='CREATING'
  assert c.execute("select state from order_idempotency where order_id='RECOVER-ORDER'").fetchone()[0]=='UNCERTAIN'
  assert c.execute("select * from orders where order_id='RECOVER-ORDER'").fetchone()==order_before
  assert c.execute("select * from order_items where order_id='RECOVER-ORDER'").fetchall()==item_before
  assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()==stock_before
  assert c.execute("select count(*) from order_status_log where order_id='RECOVER-ORDER' and note like '%owner%'").fetchone()[0]==0
  assert c.execute("select count(*) from audit_log where target='RECOVER-ORDER' and username='owner' and action='orders.offline_attempt_recovery'").fetchone()[0]==1
 # Replays and invalid cases fail; the required backup remains recoverable.
 badbackup=t/'again.sqlite';again=run(*[str(badbackup) if x==backup else x for x in command]);assert again.returncode!=0
 with sqlite3.connect(db) as c:assert c.execute("select state from order_idempotency where order_id='RECOVER-ORDER'").fetchone()[0]=='UNCERTAIN'
 print('PASS offline attempt recovery: explicit confirmation, verified backup, durable note, no payment/order/stock change')
