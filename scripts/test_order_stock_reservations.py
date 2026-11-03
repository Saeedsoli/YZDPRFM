#!/usr/bin/env python3
"""Order stock ledger: MTO, physical stock, concurrency, expiry and legacy safety."""
import concurrent.futures,itertools,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='order-stock-ledger-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','TRUSTED_PROXY_CIDRS':'127.0.0.1/32','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Isolated-Stock-Owner-895'}
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 ips=itertools.count(1)
 def api(method,path,body=None,token=None):
  h={'Content-Type':'application/json','X-Forwarded-For':f'198.51.100.{next(ips)}'}
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def order(items):return api('POST','/api/orders',{'customer_name':'Test','mobile':'09120000000','items':items})
 def verify(oid,result='fail'):return api('POST','/api/payment/verify',{'order_id':oid,'result':result})
 def stock(sku):
  c=sqlite3.connect(db);n=c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0];c.close();return n
 def state(oid):
  c=sqlite3.connect(db);r=c.execute('select status from orders where order_id=?',(oid,)).fetchone()[0];c.close();return r
 def ledger(oid):
  c=sqlite3.connect(db);r=c.execute('select i.sku,i.quantity,r.reserved_qty,r.released from order_items i join order_stock_reservations r on r.item_id=i.id where i.order_id=? order by i.id',(oid,)).fetchall();c.close();return r
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server timeout')
  c=sqlite3.connect(db);pairs=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 order by p.id limit 2").fetchall();assert len(pairs)==2
  (mp,mto),(ip,instock)=pairs;c.execute("update products set supply_mode='IN_STOCK' where id=?",(ip,));c.execute('update variants set stock=3 where sku=?',(instock,));c.execute('update variants set stock=0 where sku=?',(mto,));c.commit();c.close()
  assert api('POST','/api/cart/calculate',{'items':[{'sku':mto,'quantity':5},{'sku':mto,'quantity':5}]})[0]==400
  c=sqlite3.connect(db);before=c.execute('select count(*) from orders').fetchone()[0];c.close()
  assert order([{'sku':mto,'quantity':5},{'sku':mto,'quantity':5}])[0]==400
  c=sqlite3.connect(db);assert c.execute('select count(*) from orders').fetchone()[0]==before;c.close()
  # Made-to-order reserves no physical units, cancellation must not invent stock.
  code,a=order([{'sku':mto,'quantity':3}]);assert code==201,a;assert stock(mto)==0 and ledger(a['order_id'])==[(mto,3,0,0)]
  code,r=verify(a['order_id']);assert code==200 and r.get('failed') and state(a['order_id'])=='CANCELLED';assert stock(mto)==0 and ledger(a['order_id'])==[(mto,3,0,1)]
  assert verify(a['order_id'])[0]==409 and stock(mto)==0
  # Later manual replenishment must not be credited to the old zero reservation.
  code,a=order([{'sku':mto,'quantity':1}]);assert code==201
  c=sqlite3.connect(db);c.execute('update variants set stock=7 where sku=?',(mto,));c.commit();c.close()
  assert verify(a['order_id'])[0]==200 and stock(mto)==7
  c=sqlite3.connect(db);c.execute('update variants set stock=0 where sku=?',(mto,));c.commit();c.close()
  # Positive physical inventory under a made-to-order product is genuinely reserved;
  # a later mode edit cannot change the reserved quantity to release.
  c=sqlite3.connect(db);c.execute('update variants set stock=5 where sku=?',(mto,));c.commit();c.close()
  code,a=order([{'sku':mto,'quantity':2}]);assert code==201 and stock(mto)==3 and ledger(a['order_id'])==[(mto,2,2,0)]
  c=sqlite3.connect(db);c.execute("update products set supply_mode='UNAVAILABLE' where id=?",(mp,));c.commit();c.close()
  assert verify(a['order_id'])[0]==200 and stock(mto)==5
  c=sqlite3.connect(db);c.execute("update products set supply_mode='MADE_TO_ORDER' where id=?",(mp,));c.execute('update variants set stock=0 where sku=?',(mto,));c.commit();c.close()
  # Mixed order: only truly deducted units return.
  code,a=order([{'sku':mto,'quantity':2},{'sku':instock,'quantity':2}]);assert code==201,a;oid=a['order_id'];assert stock(mto)==0 and stock(instock)==1
  assert ledger(oid)==[(mto,2,0,0),(instock,2,2,0)];assert verify(oid)[0]==200;assert stock(mto)==0 and stock(instock)==3
  assert ledger(oid)==[(mto,2,0,1),(instock,2,2,1)]
  # Concurrent admin cancellation releases each physical reservation exactly once.
  code,login=api('POST','/api/admin/login',{'username':'owner','password':'Isolated-Stock-Owner-895'});assert code==200;token=login['token']
  code,a=order([{'sku':instock,'quantity':1}]);assert code==201;oid=a['order_id'];assert stock(instock)==2
  def cancel(_):return api('PUT',f'/api/orders/{oid}/status',{'status':'CANCELLED'},token)[0]
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:codes=list(pool.map(cancel,range(8)))
  assert codes.count(200)==1 and all(x in [200,400,409] for x in codes),codes;assert stock(instock)==3 and state(oid)=='CANCELLED'
  c=sqlite3.connect(db);assert c.execute("select count(*) from order_status_log where order_id=? and status='CANCELLED'",(oid,)).fetchone()[0]==1;c.close()
  # Manual resolution of an uncertain payment as FAILED is also a stock release.
  code,a=order([{'sku':instock,'quantity':1}]);assert code==201;failed=a['order_id'];assert stock(instock)==2
  c=sqlite3.connect(db);c.execute("update orders set status='VERIFYING' where order_id=?",(failed,));c.commit();c.close()
  assert api('PUT',f'/api/orders/{failed}/status',{'status':'FAILED'},token)[0]==200 and state(failed)=='FAILED' and stock(instock)==3
  assert ledger(failed)==[(instock,1,1,1)]
  # Corrupted or partial ledger cannot cause a guessed stock increase.
  code,a=order([{'sku':instock,'quantity':1}]);assert code==201;damaged=a['order_id'];assert stock(instock)==2
  c=sqlite3.connect(db);item=c.execute('select id from order_items where order_id=?',(damaged,)).fetchone()[0];c.execute('update order_stock_reservations set reserved_qty=2 where item_id=?',(item,));c.commit();c.close()
  assert api('PUT',f'/api/orders/{damaged}/status',{'status':'CANCELLED'},token)[0]==409 and state(damaged)=='PENDING' and stock(instock)==2
  c=sqlite3.connect(db);c.execute('update order_stock_reservations set reserved_qty=1 where item_id=?',(item,));c.commit();c.close()
  assert api('PUT',f'/api/orders/{damaged}/status',{'status':'CANCELLED'},token)[0]==200 and stock(instock)==3
  # Expiry of a mixed known order succeeds; a historical unknown reservation is held.
  code,a=order([{'sku':mto,'quantity':2},{'sku':instock,'quantity':1}]);assert code==201;oid=a['order_id'];assert stock(instock)==2
  c=sqlite3.connect(db);c.execute("update orders set created_at='2000-01-01T00:00:00.000Z' where order_id=?",(oid,))
  c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('LEGACY-UNKNOWN','2000-01-01T00:00:00.000Z','Test','09120000000',1000,0,1000,'PENDING')")
  c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('LEGACY-UNKNOWN',?,'Old',1000,1,1000)",(mto,));c.commit();c.close()
  code,r=api('POST','/api/admin/maintenance',{},token);assert code==200 and r['released']>=1 and r['review_count']>=1,r
  assert state(oid)=='EXPIRED' and stock(instock)==3 and stock(mto)==0 and state('LEGACY-UNKNOWN')=='PENDING'
  code,r=api('PUT','/api/orders/LEGACY-UNKNOWN/status',{'status':'CANCELLED'},token);assert code==409 and state('LEGACY-UNKNOWN')=='PENDING' and stock(mto)==0
  code,r=api('GET','/payment/callback?order=LEGACY-UNKNOWN&Authority=x&Status=NOK');assert code==409 and state('LEGACY-UNKNOWN')=='PENDING'
  assert api('POST','/api/payment/verify',{'order_id':'LEGACY-UNKNOWN','result':'cancel'})[0]==409 and state('LEGACY-UNKNOWN')=='VERIFYING';assert stock(mto)==0
  # External-gateway orders may be paid late; expiry holds their known ledger.
  code,a=order([{'sku':instock,'quantity':1}]);assert code==201;external=a['order_id'];assert stock(instock)==2
  c=sqlite3.connect(db);c.execute("update orders set created_at='2000-01-01T00:00:00.000Z',payment_gateway='ZARINPAL' where order_id=?",(external,));c.commit();c.close()
  code,r=api('POST','/api/admin/maintenance',{},token);assert code==200 and r['review_count']>=1
  assert state(external)=='PENDING' and stock(instock)==2 and ledger(external)==[(instock,1,1,0)]
  # Settle the fixture through a deliberate admin cancellation after review.
  assert api('PUT',f'/api/orders/{external}/status',{'status':'CANCELLED'},token)[0]==200 and stock(instock)==3
  # One physical unit cannot be sold twice under concurrent requests.
  c=sqlite3.connect(db);c.execute('update variants set stock=1 where sku=?',(instock,));c.commit();c.close()
  def buy(_):return order([{'sku':instock,'quantity':1}])[0]
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:codes=list(pool.map(buy,range(8)))
  assert codes.count(201)==1 and stock(instock)==0,codes
  c=sqlite3.connect(db);assert c.execute('pragma integrity_check').fetchone()[0]=='ok';c.close()
 finally:proc.terminate();proc.wait(timeout=10)
print('PASS physical/MTO/mixed reservations, duplicate rejection, races, expiry and legacy manual-review safety')
