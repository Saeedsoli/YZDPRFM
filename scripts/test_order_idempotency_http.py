#!/usr/bin/env python3
"""Keyed checkout: HTTP races, crash, replay, coupon/stock and migration gate."""
import concurrent.futures,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='order-idem-http-') as tmp:
 t=Path(tmp);db=t/'shop.sqlite';hook=t/'gateway.js';started=t/'started';release=t/'release';calls=t/'calls'
 hook.write_text('''const fs=require('fs'),pay=require('''+json.dumps(str(root/'src/payment.js'))+'''),original=pay.requestPayment;
pay.requestPayment=async (...args)=>{fs.appendFileSync(process.env.CALLS,'x');
 if(process.env.MODE==='crash')process.kill(process.pid,'SIGKILL');
 if(process.env.MODE==='failure')return {ok:false,error:'simulated provider uncertainty'};
 fs.writeFileSync(process.env.START,'started');while(!fs.existsSync(process.env.RELEASE))await new Promise(r=>setTimeout(r,10));return original(...args);
};''')
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Idem-Owner-982','TRUSTED_PROXY_CIDRS':'127.0.0.1/32','NODE_OPTIONS':'--require='+str(hook),'START':str(started),'RELEASE':str(release),'CALLS':str(calls)}
 def boot(extra={}):
  s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**extra},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port
   except OSError:time.sleep(.05)
  raise RuntimeError('server not ready')
 def stop(p):
  if p.poll() is None:p.terminate();p.wait(timeout=10)
 def request(port,path,body,key=None,ip='198.51.100.1',method='POST',admin=None):
  headers={'Content-Type':'application/json','X-Forwarded-For':ip}
  if key is not None:headers['Idempotency-Key']=key
  if admin:headers['Authorization']='Bearer '+admin
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode(),headers=headers,method=method)
  try:
   with urllib.request.urlopen(req,timeout=12) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def wait(path):
  for _ in range(400):
   if path.exists():return
   time.sleep(.01)
  raise RuntimeError('gateway not reached')
 a,pa=boot();b,pb=boot()
 try:
  with sqlite3.connect(db) as c:
   pid,sku=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()
   c.execute("update products set supply_mode='IN_STOCK' where id=?",(pid,));c.execute('update variants set stock=2 where sku=?',(sku,))
   c.execute("insert into coupons(code,type,value,usage_limit,used_count,per_user_once,active) values('ONCE-TEST','PERCENT',10,1,0,0,1)")
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status,admin_note) values('HISTORY','2026-01-01','Old','09120009999',1000,0,1000,'PAID','preserve')");c.commit()
  body={'customer_name':'Fixture','mobile':'09120001111','coupon_code':'ONCE-TEST','items':[{'sku':sku,'quantity':1}]};key='a1'*32
  assert request(pa,'/api/orders',body,'invalid')[0]==400
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   first=pool.submit(request,pa,'/api/orders',body,key,'198.51.100.1');wait(started)
   st,pending=request(pb,'/api/orders',body,key,'198.51.100.2');assert st==409 and pending.get('order_id') and 'payment_url' not in pending,(st,pending)
   oid=pending['order_id']
   st,conflict=request(pb,'/api/orders',{**body,'customer_name':'Different'},key,'198.51.100.3');assert st==409 and 'order_id' not in conflict
   with sqlite3.connect(db) as c:
    assert c.execute("select count(*) from orders where mobile='09120001111'").fetchone()[0]==1
    assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==1
    assert c.execute("select used_count from coupons where code='ONCE-TEST'").fetchone()[0]==1
   assert calls.read_text()=='x';release.touch();st,completed=first.result(timeout=12);assert st==201 and completed['order_id']==oid,completed
  st,replayed=request(pb,'/api/orders',body,key,'198.51.100.4');assert st==200 and replayed['order_id']==oid and replayed['payment_url']==completed['payment_url'] and replayed['total_payable']==completed['total_payable']
  assert calls.read_text()=='x';stop(b);b,pb=boot();assert request(pb,'/api/orders',body,key,'198.51.100.5')[0]==200 and calls.read_text()=='x'
  st,paid=request(pb,'/api/payment/verify',{'order_id':oid,'result':'success'},None,'198.51.100.6');assert st==200,paid
  st,again=request(pb,'/api/orders',body,key,'198.51.100.7');assert st==409 and again['status']=='PAID' and 'payment_url' not in again
  with sqlite3.connect(db) as c:
   r=c.execute('select key_hash,payload_hash,state,response_json from order_idempotency where order_id=?',(oid,)).fetchone();assert r[2]=='READY' and key not in str(r)
   assert c.execute("select status,admin_note from orders where order_id='HISTORY'").fetchone()==('PAID','preserve')
  # Gateway timeout/failure is not blindly recreated with the same key.
  c,pc=boot({'MODE':'failure'})
  try:
   body2={'customer_name':'Second','mobile':'09120002222','items':[{'sku':sku,'quantity':1}]};key2='b2'*32
   st,failed=request(pc,'/api/orders',body2,key2,'198.51.100.8');assert st==502 and failed.get('order_id');n=len(calls.read_text())
   st,uncertain=request(pb,'/api/orders',body2,key2,'198.51.100.9');assert st==409 and uncertain['order_id']==failed['order_id'] and len(calls.read_text())==n
   with sqlite3.connect(db) as con:assert con.execute('select state from order_idempotency where order_id=?',(failed['order_id'],)).fetchone()[0]=='UNCERTAIN'
  finally:stop(c)
  # A manager cancels while the provider call is in flight. Neither the
  # first response nor a retry may expose a stale link or start a new payment.
  login,ident=request(pb,'/api/admin/login',{'username':'owner','password':'Idem-Owner-982'},None,'198.51.100.16');assert login==200,ident;admin=ident['token']
  started.unlink(missing_ok=True);release.unlink(missing_ok=True)
  body6={'customer_name':'Sixth','mobile':'09120006666','items':[{'sku':sku,'quantity':1}]};key6='f6'*32
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(request,pa,'/api/orders',body6,key6,'198.51.100.17');wait(started)
   st,hold=request(pb,'/api/orders',body6,key6,'198.51.100.18');assert st==409;oid6=hold['order_id']
   st,cancelled=request(pb,f'/api/orders/{oid6}/status',{'status':'CANCELLED'},None,'198.51.100.19',method='PUT',admin=admin);assert st==200,cancelled
   release.touch();st,done=future.result(timeout=12);assert st==409 and 'payment_url' not in done
  n=len(calls.read_text());st,repeat=request(pb,'/api/orders',body6,key6,'198.51.100.20');assert st==409 and 'payment_url' not in repeat and len(calls.read_text())==n
  with sqlite3.connect(db) as con:
   assert con.execute('select o.status,i.state from orders o join order_idempotency i on i.order_id=o.order_id where o.order_id=?',(oid6,)).fetchone()==('CANCELLED','UNCERTAIN')
   assert con.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==1
  # Crash after committing order+key, before provider response: retry must not
  # create a second order or call the provider again.
  crash,pc=boot({'MODE':'crash'})
  try:
   body3={'customer_name':'Third','mobile':'09120003333','items':[{'sku':sku,'quantity':1}]};key3='c3'*32
   try:request(pc,'/api/orders',body3,key3,'198.51.100.10')
   except (OSError,urllib.error.URLError):pass
   crash.wait(timeout=10);assert crash.returncode!=0;n=len(calls.read_text())
   st,uncertain=request(pb,'/api/orders',body3,key3,'198.51.100.11');assert st==409 and uncertain.get('order_id') and len(calls.read_text())==n
   with sqlite3.connect(db) as con:
    assert con.execute("select count(*) from orders where mobile='09120003333'").fetchone()[0]==1
    assert con.execute('select state from order_idempotency where order_id=?',(uncertain['order_id'],)).fetchone()[0]=='CREATING'
    assert con.execute('pragma integrity_check').fetchone()[0]=='ok'
  finally:stop(crash)
  # Crash after the adapter returned an authority but before the wrapping
  # SQLite transaction commits: both the authority and READY marker roll back.
  with sqlite3.connect(db) as con:con.execute('update variants set stock=1 where sku=?',(sku,));con.commit()
  killready=t/'killready.js';killready.write_text("const s=require("+json.dumps(str(root/'src/order-idempotency.js'))+");const f=s.markReady;s.markReady=(...a)=>{f(...a);process.kill(process.pid,'SIGKILL')};")
  crash2,pc=boot({'NODE_OPTIONS':'--require='+str(hook)+' --require='+str(killready)})
  try:
   body5={'customer_name':'Fifth','mobile':'09120005555','items':[{'sku':sku,'quantity':1}]};key5='e5'*32
   try:request(pc,'/api/orders',body5,key5,'198.51.100.14')
   except (OSError,urllib.error.URLError):pass
   crash2.wait(timeout=10);assert crash2.returncode!=0;n=len(calls.read_text())
   st,uncertain=request(pb,'/api/orders',body5,key5,'198.51.100.15');assert st==409 and uncertain.get('order_id') and len(calls.read_text())==n
   with sqlite3.connect(db) as con:
    assert con.execute('select o.payment_ref,i.state from orders o join order_idempotency i on i.order_id=o.order_id where o.order_id=?',(uncertain['order_id'],)).fetchone()==(None,'CREATING')
    assert con.execute('pragma integrity_check').fetchone()[0]=='ok'
  finally:stop(crash2)
 finally:release.touch();stop(a);stop(b)
 # Existing stores without the schema remain usable for old clients; a keyed
 # request fails closed until its explicit backup-first migration.
 with sqlite3.connect(db) as c:c.execute('drop table order_idempotency');c.execute("delete from settings where key='order_idempotency_schema_v1'");c.commit()
 a,pa=boot()
 try:
  body4={'customer_name':'Fourth','mobile':'09120004444','items':[{'sku':sku,'quantity':1}]}
  assert request(pa,'/api/orders',body4,'d4'*32,'198.51.100.12')[0]==503
  with sqlite3.connect(db) as c:c.execute('update variants set stock=1 where sku=?',(sku,));c.commit()
  assert request(pa,'/api/orders',body4,None,'198.51.100.13')[0]==201
 finally:stop(a)
 print('PASS keyed checkout: provider replay, two-process race, conflict, paid state, failed/crashed gateway, stock/coupon and legacy schema; fake gateway')
