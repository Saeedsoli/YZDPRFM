#!/usr/bin/env python3
"""HttpOnly checkout cookie, serialized rotation and keyed order API on temp DB."""
import concurrent.futures,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='attempt-cookie-http-') as tmp:
 t=Path(tmp);db=t/'shop.sqlite';hook=t/'gateway.js';start=t/'start';go=t/'go';calls=t/'calls'
 hook.write_text('''const fs=require('fs'),pay=require('''+json.dumps(str(root/'src/payment.js'))+'''),original=pay.requestPayment;
pay.requestPayment=async (...args)=>{fs.appendFileSync(process.env.CALLS,'x');fs.writeFileSync(process.env.START,'x');while(!fs.existsSync(process.env.GO))await new Promise(r=>setTimeout(r,10));return original(...args)};''')
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox','TRUSTED_PROXY_CIDRS':'127.0.0.1/32','NODE_OPTIONS':'--require='+str(hook),'START':str(start),'GO':str(go),'CALLS':str(calls)}
 def boot(extra={}):
  s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**extra},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port
   except OSError:time.sleep(.05)
  raise RuntimeError('server did not start')
 def stop(p):
  if p.poll() is None:p.terminate();p.wait(timeout=10)
 def call(port,method,path,body=None,cookie=None,ip='198.51.100.1',headers=None):
  h={'Content-Type':'application/json','X-Forwarded-For':ip,**(headers or {})}
  if cookie:h['Cookie']=cookie
  r=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(r,timeout=12) as x:return x.status,json.load(x),dict(x.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def wait(path):
  for _ in range(400):
   if path.exists():return
   time.sleep(.01)
  raise RuntimeError('provider not reached')
 a,pa=boot();b,pb=boot()
 try:
  issue='/api/orders/attempt';rotate=issue+'/rotate';status=issue+'/status'
  assert call(pa,'GET',status)[0]==401
  assert call(pa,'POST',issue,{},headers={'Origin':'https://attacker.example'})[0]==403
  code,data,h=call(pa,'POST',issue,{});assert code==201 and data=={'ready':True} and h['Cache-Control']=='no-store'
  full=h['Set-Cookie'];assert 'HttpOnly' in full and 'SameSite=Lax' in full and 'Path=/api/orders' in full and 'Secure' not in full
  cookie=full.split(';',1)[0];secret=cookie.split('=',1)[1];assert secret not in json.dumps(data)
  code,data,h=call(pb,'POST',issue,{},cookie=cookie,ip='198.51.100.2');assert code==200 and data=={'ready':True} and 'Set-Cookie' not in h
  assert call(pb,'GET',status,cookie=cookie)[1]=={'ready':True,'state':'UNUSED'}
  assert call(pb,'POST',rotate,{},cookie=cookie,headers={'Origin':'https://attacker.example'})[0]==403
  assert call(pb,'POST',issue,{},cookie=cookie+'; '+cookie,ip='198.51.100.3')[0]==400
  with sqlite3.connect(db) as c:
   assert secret not in str(c.execute('select * from checkout_attempt_tokens').fetchall())
   pid,sku=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()
   c.execute("update products set supply_mode='IN_STOCK' where id=?",(pid,));c.execute('update variants set stock=1 where sku=?',(sku,));c.commit()
  order={'customer_name':'Test','mobile':'09120001111','items':[{'sku':sku,'quantity':1}]}
  assert call(pa,'POST','/api/orders',order,cookie=cookie,headers={'Idempotency-Key':'a1'*32},ip='198.51.100.4')[0]==400
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   first=pool.submit(call,pa,'POST','/api/orders',order,cookie,'198.51.100.5');wait(start)
   code,hold,_=call(pb,'POST','/api/orders',order,cookie,ip='198.51.100.6');assert code==409 and hold.get('order_id');oid=hold['order_id']
   assert call(pb,'GET',status,cookie=cookie)[1]=={'ready':True,'state':'UNRESOLVED','order_id':oid}
   assert call(pb,'POST',rotate,{},cookie=cookie,ip='198.51.100.7')[0]==409
   assert calls.read_text()=='x';go.touch();code,created,_=first.result(timeout=12);assert code==201 and created['order_id']==oid
  code,replay,_=call(pb,'POST','/api/orders',order,cookie,ip='198.51.100.8');assert code==200 and replay['order_id']==oid and replay['payment_url']==created['payment_url'] and calls.read_text()=='x'
  assert call(pb,'GET',status,cookie=cookie)[1]=={'ready':True,'state':'PENDING','order_id':oid}
  assert call(pb,'POST',rotate,{},cookie=cookie,ip='198.51.100.9')[0]==409
  assert call(pb,'POST','/api/payment/verify',{'order_id':oid,'result':'success'},ip='198.51.100.10')[0]==200
  assert call(pb,'GET',status,cookie=cookie)[1]=={'ready':True,'state':'PAID','order_id':oid}
  code,data,h=call(pb,'POST',rotate,{},cookie=cookie,ip='198.51.100.11');assert code==200 and data=={'ready':True};new=h['Set-Cookie'].split(';',1)[0];assert new!=cookie
  assert call(pb,'GET',status,cookie=cookie)[0]==409 and call(pb,'GET',status,cookie=new)[0]==200
  assert call(pb,'POST','/api/orders',order,cookie=cookie,ip='198.51.100.12')[0]==409
  with sqlite3.connect(db) as c:
   assert c.execute("select count(*) from orders where mobile='09120001111'").fetchone()[0]==1
   assert c.execute('select count(*) from checkout_attempt_tokens').fetchone()[0]==2
   assert secret not in str(c.execute('select * from checkout_attempt_tokens').fetchall())
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
  # Rotate and submit using the same unbound cookie on two processes. Either
  # rotation wins and the old request is denied, or order commit wins and
  # rotation is refused; both cannot succeed.
  with sqlite3.connect(db) as c:c.execute('update variants set stock=1 where sku=?',(sku,));c.commit()
  order2={'customer_name':'Second','mobile':'09120002222','items':[{'sku':sku,'quantity':1}]}
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   submit=pool.submit(call,pa,'POST','/api/orders',order2,new,'198.51.100.13')
   rotate_race=pool.submit(call,pb,'POST',rotate,{},new,'198.51.100.14')
   order_result=submit.result(timeout=12);rotate_result=rotate_race.result(timeout=12)
  assert (order_result[0],rotate_result[0]) in ((201,409),(409,200)),(order_result[0],rotate_result[0])
  with sqlite3.connect(db) as c:
   assert c.execute("select count(*) from orders where mobile='09120002222'").fetchone()[0]==(1 if order_result[0]==201 else 0)
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
 finally:go.touch();stop(a);stop(b)
 # Existing DB remains unchanged without explicit migration and fails closed.
 with sqlite3.connect(db) as c:c.execute('drop table checkout_attempt_tokens');c.execute("delete from settings where key='checkout_attempt_cookie_schema_v1'");c.commit()
 a,pa=boot()
 try:
  assert call(pa,'POST','/api/orders/attempt',{})[0]==503
  assert call(pa,'GET','/api/orders/attempt/status',cookie=cookie)[0]==503
  assert call(pa,'POST','/api/orders',order,cookie=cookie)[0]==503
 finally:stop(a)
 # The production cookie is Secure; this checks headers only, not a real deployment.
 production=t/'prod.sqlite';a,pa=boot({'DB_PATH':str(production),'NODE_ENV':'production','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Production-Cookie-Owner-982','SITE_URL':'https://shop.example.test','PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'12345678-1234-4234-8234-123456789abc','ZARINPAL_SANDBOX':'false'})
 try:
  code,data,h=call(pa,'POST','/api/orders/attempt',{});assert code==201 and data=={'ready':True} and 'Secure' in h['Set-Cookie'] and 'HttpOnly' in h['Set-Cookie']
 finally:stop(a)
 print('PASS HttpOnly cookie, no-store, CSRF, shared-key concurrency, guarded rotation, schema gate and Secure production header; fake gateway')
