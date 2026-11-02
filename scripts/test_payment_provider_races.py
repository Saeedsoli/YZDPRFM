#!/usr/bin/env python3
"""Provider/order status races on temporary DB; fake HTTPS, no real payment."""
import concurrent.futures,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='payment-race-') as td:
 td=Path(td);db=td/'db.sqlite';mock=td/'mock.js';request_started=td/'request-started';request_go=td/'request-go';verify_started=td/'verify-started';verify_go=td/'verify-go'
 mock.write_text('''const https=require('https'),{EventEmitter}=require('events'),fs=require('fs');
https.request=(opt,cb)=>{const q=new EventEmitter();let body='';q.write=x=>body+=x;q.destroy=()=>{};q.end=()=>{const verify=opt.path.includes('/verify.json');const started=verify?process.env.VSTART:process.env.RSTART,go=verify?process.env.VGO:process.env.RGO;fs.writeFileSync(started,'started');const run=()=>{if(!fs.existsSync(go))return setTimeout(run,10);const r=new EventEmitter();cb(r);setImmediate(()=>{r.emit('data',JSON.stringify({data:{code:100,authority:'AUTH-RACE',ref_id:'BANK-TEST'}}));r.emit('end')})};run()};return q};''')
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'production','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Race-Owner-Password-981','PORT':str(port),'SITE_URL':'https://shop.example.test','PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'12345678-1234-4234-8234-123456789abc','ZARINPAL_SANDBOX':'false','NODE_OPTIONS':'--require='+str(mock),'RSTART':str(request_started),'RGO':str(request_go),'VSTART':str(verify_started),'VGO':str(verify_go)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(method,path,body=None,token=None):
  h={'Content-Type':'application/json'}
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=20) as r:return r.status,json.loads(r.read())
  except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
 def wait(file):
  for _ in range(500):
   if file.exists():return
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   time.sleep(.01)
  raise RuntimeError('provider hook not reached')
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server startup timed out')
  code,r=call('POST','/api/admin/login',{'username':'owner','password':'Race-Owner-Password-981'});assert code==200;token=r['token']
  with sqlite3.connect(db) as c:
   pid,sku=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()
   c.execute("update products set supply_mode='IN_STOCK' where id=?",(pid,));c.execute('update variants set stock=2 where sku=?',(sku,))
  def order():return call('POST','/api/orders',{'customer_name':'Fixture','mobile':'09120003333','items':[{'sku':sku,'quantity':1}]})
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   fut=pool.submit(order);wait(request_started)
   with sqlite3.connect(db) as c:oid,status,ref=c.execute("select order_id,status,payment_ref from orders where mobile='09120003333'").fetchone();assert (status,ref)==('PENDING',None)
   status,r=call('PUT',f'/api/orders/{oid}/status',{'status':'CANCELLED'},token);assert status==200,(status,r)
   request_go.touch();status,r=fut.result(timeout=10);assert status==409 and r['order_id']==oid and 'payment_url' not in r,(status,r)
  with sqlite3.connect(db) as c:
   assert c.execute('select status,payment_ref from orders where order_id=?',(oid,)).fetchone()==('CANCELLED',None)
   assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==2
   assert c.execute('select released from order_stock_reservations join order_items on item_id=order_items.id where order_items.order_id=?',(oid,)).fetchone()[0]==1
  # A normal order still receives a link. In a separate race a provider
  # confirms payment after a manager changes VERIFYING; never report success.
  status,r=order();assert status==201 and r.get('payment_url');oid2=r['order_id']
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   fut=pool.submit(call,'GET',f'/payment/callback?order={oid2}&Authority=AUTH-RACE&Status=OK');wait(verify_started)
   with sqlite3.connect(db) as c:assert c.execute('select status from orders where order_id=?',(oid2,)).fetchone()[0]=='VERIFYING'
   status,r=call('PUT',f'/api/orders/{oid2}/status',{'status':'CANCELLED'},token);assert status==200,(status,r)
   verify_go.touch();status,r=fut.result(timeout=10);assert status==503 and r['order_id']==oid2 and 'بررسی' in r['error'],(status,r)
  with sqlite3.connect(db) as c:
   assert c.execute('select status from orders where order_id=?',(oid2,)).fetchone()[0]=='CANCELLED'
   assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==2
  print('PASS no stale payment link, no false success on status conflict, and stock preservation; fake provider only')
 finally:
  request_go.touch();verify_go.touch();p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
