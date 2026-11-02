#!/usr/bin/env python3
"""Coupon/order/stock atomicity across processes and hard crash on a disposable DB."""
import concurrent.futures,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='coupon-atomic-') as tmp:
 td=Path(tmp);db=td/'shop.sqlite';env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox'}
 init=subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,capture_output=True,text=True,timeout=120);assert init.returncode==0,init.stderr
 with sqlite3.connect(db) as c:
  pid,sku=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()
  c.execute("update products set supply_mode='IN_STOCK' where id=?",(pid,));c.execute('update variants set stock=2 where sku=?',(sku,))
  c.execute("insert into coupons(code,type,value,usage_limit,used_count,per_user_once,active) values('ONE-TEST','PERCENT',10,1,0,1,1)")
  c.execute("insert into coupons(code,type,value,usage_limit,used_count,per_user_once,active) values('CRASH-TEST','PERCENT',10,2,0,0,1)")
  c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status,admin_note) values('HIST-PRESERVE','2026-01-01','Old','09120001111',1000,0,1000,'PAID','keep')")
 def boot(extra=None):
  s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**(extra or {})},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port
   except OSError:time.sleep(.05)
  raise RuntimeError('server startup timed out')
 def stop(p):
  if p.poll() is None:p.terminate();p.wait(timeout=10)
 def order(port,mobile,code):
  body={'customer_name':'Fixture','mobile':mobile,'coupon_code':code,'items':[{'sku':sku,'quantity':1}]}
  req=urllib.request.Request(f'http://127.0.0.1:{port}/api/orders',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 a,port1=boot();b,port2=boot()
 try:
  def go(i):return order([port1,port2][i],['09120002222','09120003333'][i],'ONE-TEST')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(go,[0,1]))
  codes=sorted(x[0] for x in results);assert codes[0]==201 and codes[1] in (400,409),results
  winner=next(x[1]['order_id'] for x in results if x[0]==201)
  with sqlite3.connect(db) as c:
   assert c.execute("select used_count from coupons where code='ONE-TEST'").fetchone()[0]==1
   assert c.execute("select order_id from coupon_usage where code='ONE-TEST'").fetchall()==[(winner,)]
   assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==1
   assert c.execute('select reserved_qty from order_stock_reservations join order_items on item_id=order_items.id where order_items.order_id=?',(winner,)).fetchone()[0]==1
 finally:stop(a);stop(b)
 # Terminate the server immediately after coupon reservation while the outer
 # order transaction is still open. SQLite must roll back every write.
 patch=td/'crash.js';patch.write_text("const d=require("+json.dumps(str(root/'src/db.js'))+");const f=d.recordCouponUse;d.recordCouponUse=(...a)=>{const r=f(...a);if(r.ok)process.kill(process.pid,'SIGKILL');return r};")
 cr,port=boot({'NODE_OPTIONS':'--require='+str(patch)})
 try:
  try:order(port,'09120004444','CRASH-TEST')
  except (OSError,urllib.error.URLError):pass
  cr.wait(timeout=10);assert cr.returncode!=0
  with sqlite3.connect(db) as c:
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
   assert c.execute("select used_count from coupons where code='CRASH-TEST'").fetchone()[0]==0
   assert c.execute("select count(*) from coupon_usage where code='CRASH-TEST'").fetchone()[0]==0
   assert c.execute("select count(*) from orders where mobile='09120004444'").fetchone()[0]==0
   assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==1
   assert c.execute("select status,admin_note from orders where order_id='HIST-PRESERVE'").fetchone()==('PAID','keep')
   assert c.execute("select order_id from coupon_usage where code='ONE-TEST'").fetchall()==[(winner,)]
 finally:stop(cr)
 print('PASS coupon/order/stock atomicity, two-process limit and hard-crash rollback; sandbox only')
