#!/usr/bin/env python3
"""A review cannot clear a cookie while provider creation is still in flight."""
import concurrent.futures,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='review-inflight-') as td:
 t=Path(td);db=t/'shop.sqlite';start=t/'start';go=t/'go';hook=t/'gateway.js'
 hook.write_text('''const fs=require('fs'),pay=require('''+json.dumps(str(root/'src/payment.js'))+'''),original=pay.requestPayment;
pay.requestPayment=async (...args)=>{fs.writeFileSync(process.env.START,'x');while(!fs.existsSync(process.env.GO))await new Promise(r=>setTimeout(r,10));return original(...args)};''')
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'PAYMENT_GATEWAY':'sandbox','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Inflight-Review-982','NODE_OPTIONS':'--require='+str(hook),'START':str(start),'GO':str(go),'RL_ORDER_LIMIT':'1000'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(method,path,body=None,cookie=None,admin=None):
  h={'Content-Type':'application/json'}
  if cookie:h['Cookie']=cookie
  if admin:h['Authorization']='Bearer '+admin
  r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(r,timeout=15) as x:return x.status,json.load(x),dict(x.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()[0]
  status,login,_=call('POST','/api/admin/login',{'username':'owner','password':'Inflight-Review-982'});assert status==200;admin=login['token']
  status,_,h=call('POST','/api/orders/attempt',{});assert status==201;cookie=h['Set-Cookie'].split(';',1)[0]
  body={'customer_name':'Test','mobile':'09120001111','items':[{'sku':sku,'quantity':1}]}
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(call,'POST','/api/orders',body,cookie,None)
   for _ in range(500):
    if start.exists():break
    time.sleep(.01)
   else:raise RuntimeError('gateway hook not reached')
   state=call('GET','/api/orders/attempt/status',cookie=cookie)[1];assert state['state']=='UNRESOLVED';oid=state['order_id']
   assert call('PUT',f'/api/orders/{oid}/status',{'status':'CANCELLED'},admin=admin)[0]==200
   review={'order_id':oid,'evidence_note':'تراکنش در درگاه بررسی شد و پیوند بسته است','no_payment_confirmed':True,'link_closed_confirmed':True}
   assert call('POST','/api/admin/reconciliation/payment-review',review,admin=admin)[0]==409
   entry=next(o for o in call('GET','/api/orders?limit=50',admin=admin)[1]['orders'] if o['order_id']==oid);assert entry['payment_recovery_pending'] and not entry['payment_review_needed']
   assert call('POST','/api/orders/attempt/rotate',{},cookie=cookie)[0]==409
   with sqlite3.connect(db) as c:assert c.execute('select state from order_idempotency where order_id=?',(oid,)).fetchone()[0]=='CREATING' and c.execute('select count(*) from order_attempt_reviews').fetchone()[0]==0
   go.touch();status,result,_=future.result(timeout=12);assert status==409 and 'payment_url' not in result
  with sqlite3.connect(db) as c:assert c.execute('select state from order_idempotency where order_id=?',(oid,)).fetchone()[0]=='UNCERTAIN'
  entry=next(o for o in call('GET','/api/orders?limit=50',admin=admin)[1]['orders'] if o['order_id']==oid);assert entry['payment_review_needed'] and not entry['payment_recovery_pending']
  assert call('POST','/api/admin/reconciliation/payment-review',review,admin=admin)[0]==201
  assert call('GET','/api/orders/attempt/status',cookie=cookie)[1]['state']=='REVIEWED'
  assert call('POST','/api/orders/attempt/rotate',{},cookie=cookie)[0]==200
  print('PASS in-flight provider cannot be manually cleared; review only after provider outcome is recorded; fake gateway')
 finally:
  go.touch();p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
