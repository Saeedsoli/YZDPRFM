#!/usr/bin/env python3
"""Full staged purchase-to-return journey: isolated DB, sandbox payment, mocked SMS."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='returns-journey-') as td:
 t=Path(td);db=t/'shop.sqlite';mock=t/'sms.js'
 mock.write_text('const s=require('+json.dumps(str(root/'src/sms.js'))+');s.sendOtp=async()=>({ok:true});s.send=async()=>({ok:true});')
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','RETURNS_API_TEST_ONLY':'1','PAYMENT_GATEWAY':'sandbox','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Journey-Owner-982','NODE_OPTIONS':'--require='+str(mock)}
 def boot():
  s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port)},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port
   except OSError:time.sleep(.05)
  raise RuntimeError('server did not start')
 def api(port,method,path,body=None,customer=None,admin=None,origin=None):
  h={'Content-Type':'application/json'}
  if customer:h['X-Customer-Token']=customer
  if admin:h['Authorization']='Bearer '+admin
  if origin:h['Origin']=origin
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def get_token(port,phone):
  assert api(port,'POST','/api/auth/request-code',{'mobile':phone})[0]==200
  with sqlite3.connect(db) as c:code=c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
  status,data=api(port,'POST','/api/auth/verify-code',{'mobile':phone,'code':code});assert status==200,data;return data['token']
 def stop(p):
  if p.poll() is None:p.terminate();p.wait(timeout=10)
 p,port=boot()
 try:
  with sqlite3.connect(db) as c:
   row=c.execute("""SELECT p.name_fa,p.brand_fa,perf.sku,sample.sku FROM products p
     JOIN variants perf ON perf.product_id=p.id AND perf.type='EDP' AND perf.volume_ml=30 AND perf.price_toman>0
     JOIN variants sample ON sample.product_id=p.id AND sample.type='SAMPLE' AND sample.volume_ml=5 AND sample.price_toman>0
     WHERE p.supply_mode='MADE_TO_ORDER' LIMIT 1""").fetchone();assert row
   name,brand,sku,sample_sku=row
  buyer='09120001111';customer=get_token(port,buyer);other=get_token(port,'09120002222')
  status,a=api(port,'POST','/api/admin/login',{'username':'owner','password':'Journey-Owner-982'});assert status==200,a;admin=a['token']
  status,o=api(port,'POST','/api/orders',{'customer_name':'Test customer','mobile':buyer,'items':[{'sku':sku,'quantity':2},{'sku':sample_sku,'quantity':1}]},customer=customer)
  assert status==201,o;oid=o['order_id']
  status,r=api(port,'POST','/api/payment/verify',{'order_id':oid,'result':'success'});assert status==200,r
  for state in ('PROCESSING','SHIPPED','DELIVERED'):
   status,r=api(port,'PUT',f'/api/orders/{oid}/status',{'status':state},admin=admin);assert status==200,(state,r)
  own=api(port,'GET','/api/auth/orders',customer=customer)[1]['orders'];order=next(x for x in own if x['order_id']==oid)
  items={x['sku']:x for x in order['items']};perf=items[sku];sample=items[sample_sku]
  assert name in perf['product_name'] and name in sample['product_name']
  assert sample['return_info']['reason']=='VOLUME_INELIGIBLE' and perf['return_info']['reason']=='DELIVERY_TIME_UNAVAILABLE'
  request={'item_id':perf['id'],'quantity':2,'description':'محصول تحویل شده و درخواست بررسی دارم','used_under_2ml':True}
  assert api(port,'POST','/api/auth/account-returns',request,customer=customer)[1]['reason']=='DELIVERY_TIME_UNAVAILABLE'
  assert api(port,'POST','/api/auth/account-returns',request,customer=other)[0]==404
  assert api(port,'POST','/api/auth/account-returns',request,customer=customer,origin='https://attacker.example')[0]==403
  time.sleep(.05);delivery=int(time.time()*1000)
  status,r=api(port,'POST','/api/admin/account-returns/delivery',{'order_id':oid,'delivered_at_ms':delivery},admin=admin);assert status==201,r
  own=api(port,'GET','/api/auth/orders',customer=customer)[1]['orders'];perf=next(i for o in own if o['order_id']==oid for i in o['items'] if i['sku']==sku)
  assert perf['return_info']['eligible'] and perf['return_info']['deadlineMs']==delivery+72*3600*1000
  status,r=api(port,'POST','/api/auth/account-returns',request,customer=customer);assert status==201,r;rid=r['request_id']
  status,tickets=api(port,'GET','/api/tickets',admin=admin);assert status==200
  ticket=next(t for t in tickets['tickets'] if t['ticket_id']==rid);assert ticket['order_id']==oid and name in ticket['product_name'] and ticket['volume_ml']==30 and ticket['mobile']==buyer
  status,r=api(port,'PUT','/api/tickets/'+rid,{'status':'ANSWERED','reply':'درخواست شما بررسی شد.'},admin=admin);assert status==200,r
  own=api(port,'GET','/api/auth/orders',customer=customer)[1]['orders'];perf=next(i for o in own if o['order_id']==oid for i in o['items'] if i['sku']==sku)
  assert perf['return_info']['request']['status']=='ANSWERED' and perf['return_info']['request']['reply']=='درخواست شما بررسی شد.'
  with sqlite3.connect(db) as c:
   assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
   assert c.execute('select status from orders where order_id=?',(oid,)).fetchone()[0]=='DELIVERED'
   assert c.execute('select count(*) from account_return_requests where item_id=?',(perf['id'],)).fetchone()[0]==1
 finally:stop(p)
 p,port=boot()
 try:
  own=api(port,'GET','/api/auth/orders',customer=customer)[1]['orders'];perf=next(i for o in own if o['order_id']==oid for i in o['items'] if i['sku']==sku)
  assert perf['return_info']['request']['reply']=='درخواست شما بررسی شد.'
 finally:stop(p)
 print('PASS staged purchase, sandbox payment, verified delivery, owner-only return, admin reply and restart; mocked SMS')
