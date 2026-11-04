#!/usr/bin/env python3
"""Manual reconciliation and delivery correction with real HTTP on a temp DB."""
import datetime,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='order-recon-http-') as td:
 db=str(Path(td)/'shop.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'PAYMENT_GATEWAY':'sandbox','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Reconcile-Owner-982','RL_ORDER_LIMIT':'1000'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(method,path,body=None,cookie=None,admin=None,origin=None):
  h={'Content-Type':'application/json'}
  if cookie:h['Cookie']=cookie
  if admin:h['Authorization']='Bearer '+admin
  if origin:h['Origin']=origin
  req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:
   sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()[0]
   c.execute("insert into staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active) select 'support','Support','support',pass_hash,pass_salt,0,1 from staff where username='owner'");c.commit()
  status,login,_=call('POST','/api/admin/login',{'username':'owner','password':'Reconcile-Owner-982'});assert status==200;admin=login['token']
  status,login,_=call('POST','/api/admin/login',{'username':'support','password':'Reconcile-Owner-982'});assert status==200;support=login['token']
  status,_,h=call('POST','/api/orders/attempt',{});assert status==201;cookie=h['Set-Cookie'].split(';',1)[0];secret=cookie.split('=',1)[1]
  status,result,_=call('POST','/api/orders',{'customer_name':'Test','mobile':'09120001111','items':[{'sku':sku,'quantity':1}]},cookie=cookie);assert status==201,result;oid=result['order_id']
  assert call('POST','/api/payment/verify',{'order_id':oid,'result':'cancel'})[0]==200
  state=call('GET','/api/orders/attempt/status',cookie=cookie)[1];assert state['state']=='UNRESOLVED'
  assert call('POST','/api/orders/attempt/rotate',{},cookie=cookie)[0]==409
  review='/api/admin/reconciliation/payment-review';body={'order_id':oid,'evidence_note':'درگاه بررسی شد و پیوند پرداخت بسته شد','no_payment_confirmed':True,'link_closed_confirmed':True}
  assert call('POST',review,body)[0]==401 and call('POST',review,body,admin=support)[0]==403
  assert call('POST',review,body,admin=admin,origin='https://attacker.example')[0]==403
  assert call('POST',review,{**body,'no_payment_confirmed':False},admin=admin)[0]==400
  assert call('POST',review,{**body,'evidence_note':'کم'},admin=admin)[0]==400
  before=call('GET','/api/orders?limit=50',admin=admin)[1];entry=next(o for o in before['orders'] if o['order_id']==oid);assert entry['payment_review_needed'] is True and secret not in json.dumps(entry)
  status,data,h=call('POST',review,body,admin=admin);assert status==201 and h['Cache-Control']=='no-store' and 'تغییر نکرد' in data['message']
  assert call('POST',review,body,admin=admin)[0]==409
  with sqlite3.connect(db) as c:
   status,storednote=c.execute('select status,admin_note from orders where order_id=?',(oid,)).fetchone();assert status=='CANCELLED'
   row=c.execute('select order_status,evidence_note,reviewed_by,key_hash from order_attempt_reviews where order_id=?',(oid,)).fetchone();assert row[:3]==('CANCELLED',body['evidence_note'],'owner') and secret not in str(row)
  assert call('GET','/api/orders/attempt/status',cookie=cookie)[1]['state']=='REVIEWED'
  assert call('POST','/api/orders/attempt/rotate',{},cookie=cookie)[0]==200
  # Delivery correction records both values and never changes prior requests.
  now=int(time.time()*1000);old=now-3600000;new=now-7200000;created=datetime.datetime.fromtimestamp((now-86400000)/1000,datetime.timezone.utc).isoformat()
  with sqlite3.connect(db) as c:
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('DELIVERY',?,'Test','09120003333',100,0,100,'DELIVERED')",(created,))
   cur=c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('DELIVERY',?,'Actual',100,1,100)",(sku,));item=cur.lastrowid
   c.execute('insert into return_item_evidence values(?,30)',(item,));c.execute("insert into return_delivery_evidence values('DELIVERY',?,?,?)",(old,now,'owner'))
   c.execute("insert into account_return_requests values('RET-PRESERVE',?,'09120003333',1,'valid explanation',1,?,'NEW_PENDING')",(item,now));c.commit();before=c.execute("select * from account_return_requests where request_id='RET-PRESERVE'").fetchone()
  correction='/api/admin/reconciliation/delivery-correction';b={'order_id':'DELIVERY','expected_old_ms':old,'new_delivered_at_ms':new,'evidence_note':'اطلاعات تحویل شرکت پستی بررسی شد'}
  assert call('POST',correction,b)[0]==401
  assert call('POST',correction,{**b,'expected_old_ms':old-1},admin=admin)[0]==409
  assert call('POST',correction,{**b,'new_delivered_at_ms':now+1000000},admin=admin)[0]==400
  assert call('POST',correction,b,admin=support)[0]==201
  assert call('POST',correction,b,admin=admin)[0]==409
  with sqlite3.connect(db) as c:
   assert c.execute("select delivered_at_ms from return_delivery_evidence where order_id='DELIVERY'").fetchone()[0]==new
   assert c.execute("select old_delivered_at_ms,new_delivered_at_ms,evidence_note,corrected_by from return_delivery_corrections where order_id='DELIVERY'").fetchone()==(old,new,b['evidence_note'],'support')
   assert c.execute("select * from account_return_requests where request_id='RET-PRESERVE'").fetchone()==before
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
  print('PASS authenticated manual review, role/CSRF guards, safe cookie rotation and audited delivery correction; sandbox only')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
