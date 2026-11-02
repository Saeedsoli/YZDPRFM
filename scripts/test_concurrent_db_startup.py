#!/usr/bin/env python3
"""Concurrent existing-store startup and rollback, using a disposable DB only."""
import json,os,sqlite3,subprocess,tempfile,time
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='db-startup-race-') as tmp:
 p=Path(tmp);db=p/'db.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test'}
 command=['node','-e',"const d=require('./src/db');console.log('READY');d.db.close()"]
 first=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=120);assert first.returncode==0,first.stderr
 with sqlite3.connect(db) as c:
  sku=c.execute('select sku from variants limit 1').fetchone()[0]
  c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status,admin_note) values('STARTUP-SENTINEL','2026-01-01','Fixture','09120009999',1000,0,1000,'PAID','preserve')")
  c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('STARTUP-SENTINEL',?,'Fixture',1000,1,1000)",(sku,))
  c.execute("insert into customers(mobile,first_name) values('09120009999','Fixture')")
 def snapshot():
  with sqlite3.connect(db) as c:
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
   names=[x[0] for x in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
   result={}
   for n in names:
    q='"'+n.replace('"','""')+'"';rows=c.execute(f'select * from {q}').fetchall()
    result[n]=sorted(rows,key=lambda r:repr(r))
   return result
 before=snapshot();procs=[]
 try:
  for _ in range(8):procs.append(subprocess.Popen(command,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True))
  for proc in procs:
   out,err=proc.communicate(timeout=120);assert proc.returncode==0 and 'READY' in out,(out,err)
 finally:
  for proc in procs:
   if proc.poll() is None:proc.kill();proc.communicate()
 assert snapshot()==before,'concurrent restarts changed data'
 # Fail late in initialization after a deliberate write. The outer startup
 # transaction must roll it back and preserve every historical table.
 patch=p/'inject.js';patch.write_text("const x=require("+json.dumps(str(root/'src/official-identities.js'))+");x.seedOfficialIdentities=(db)=>{db.prepare(\"insert into settings(key,value) values('test-rollback-sentinel','x')\").run();throw new Error('forced-startup-failure')};")
 failure=subprocess.run(command,cwd=root,env={**env,'NODE_OPTIONS':'--require='+str(patch)},capture_output=True,text=True,timeout=120)
 assert failure.returncode!=0 and 'forced-startup-failure' in failure.stderr,(failure.stdout,failure.stderr)
 assert snapshot()==before,'failed startup left partial changes'
 print('PASS eight simultaneous existing DB startups, all-table preservation and rollback on forced initialization failure')
