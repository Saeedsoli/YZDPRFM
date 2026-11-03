#!/usr/bin/env python3
"""Staged return endpoints, OTP ownership and atomic ticket bridge on a throwaway DB."""
import concurrent.futures,itertools,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='returns-api-') as td:
 t=Path(td);db=t/'shop.sqlite';mock=t/'sms.js'
 mock.write_text('const s=require('+json.dumps(str(root/'src/sms.js'))+');s.sendOtp=async()=>({ok:true});s.send=async()=>({ok:true});')
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','RETURNS_API_TEST_ONLY':'1','TRUSTED_PROXY_CIDRS':'127.0.0.1/32','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Return-Owner-982','NODE_OPTIONS':'--require='+str(mock)}
 ips=itertools.count(1)
 def boot(extra={}):
  s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**extra},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return p,port
   except OSError:time.sleep(.05)
  raise RuntimeError('server did not start')
 def api(port,method,path,body=None,customer=None,admin=None):
  h={'Content-Type':'application/json','X-Forwarded-For':f'198.51.100.{next(ips)%250+1}'}
  if customer:h['X-Customer-Token']=customer
  if admin:h['Authorization']='Bearer '+admin
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def login_customer(port,phone):
  assert api(port,'POST','/api/auth/request-code',{'mobile':phone})[0]==200
  with sqlite3.connect(db) as c:code=c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
  status,data,_=api(port,'POST','/api/auth/verify-code',{'mobile':phone,'code':code});assert status==200,data;return data['token']
 def stop(p):
  if p.poll() is None:p.terminate();p.wait(timeout=10)
 p,port=boot()
 try:
  now=int(time.time()*1000)
  with sqlite3.connect(db) as c:
   sku=c.execute('select sku from variants limit 1').fetchone()[0]
   for oid,phone,status in [('OWNER','09120001111','DELIVERED'),('OTHER','09120002222','DELIVERED'),('SHIPPED','09120001111','SHIPPED')]:
    c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values(?,'2026-01-01T00:00:00.000Z','Name',?,100,0,100,?)",(oid,phone,status))
   def item(oid,volume):
    row=c.execute('insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values(?,?,?,100,2,200)',(oid,sku,'Actual product'));i=row.lastrowid
    if volume:c.execute('insert into return_item_evidence(item_id,volume_ml) values(?,?)',(i,volume))
    return i
   good=item('OWNER',30);sample=item('OWNER',5);unknown=item('OWNER',None);other=item('OTHER',30);c.commit()
  a=login_customer(port,'09120001111');b=login_customer(port,'09120002222')
  status,login,_=api(port,'POST','/api/admin/login',{'username':'owner','password':'Return-Owner-982'});assert status==200,login;admin=login['token']
  dp='/api/admin/account-returns/delivery';rp='/api/auth/account-returns';payload={'item_id':good,'quantity':1,'description':'شرح معتبر برای مرجوعی کالا','used_under_2ml':True}
  assert api(port,'POST',dp,{'order_id':'OWNER','delivered_at_ms':now})[0]==401
  assert api(port,'POST',rp,payload)[0]==401
  assert api(port,'POST',rp,{**payload,'item_id':other},customer=a)[0]==404
  assert api(port,'POST',rp,payload,customer=a)[1]['reason']=='DELIVERY_TIME_UNAVAILABLE'
  assert api(port,'POST',dp,{'order_id':'SHIPPED','delivered_at_ms':now},admin=admin)[0]==409
  assert api(port,'POST',dp,{'order_id':'OWNER','delivered_at_ms':now+9999999},admin=admin)[0]==400
  assert api(port,'POST',dp,{'order_id':'OWNER','delivered_at_ms':100},admin=admin)[0]==400
  status,_,h=api(port,'POST',dp,{'order_id':'OWNER','delivered_at_ms':now},admin=admin);assert status==201 and h['Cache-Control']=='no-store'
  assert api(port,'POST',dp,{'order_id':'OWNER','delivered_at_ms':now},admin=admin)[0]==409
  assert api(port,'POST',rp,{**payload,'item_id':sample},customer=a)[1]['reason']=='VOLUME_INELIGIBLE'
  assert api(port,'POST',rp,{**payload,'item_id':unknown},customer=a)[1]['reason']=='VOLUME_UNAVAILABLE'
  hp='/api/admin/account-returns/historical-volume';hist={'item_id':unknown,'volume_ml':30,'evidence_note':'تصویر فاکتور معتبر بررسی شد','confirmed':True}
  assert api(port,'POST',hp,hist)[0]==401
  assert api(port,'POST',hp,{**hist,'confirmed':False},admin=admin)[0]==400
  assert api(port,'POST',hp,{**hist,'evidence_note':'x'},admin=admin)[0]==400
  assert api(port,'POST',hp,hist,admin=admin)[0]==201
  assert api(port,'POST',hp,{**hist,'volume_ml':50},admin=admin)[0]==409
  with sqlite3.connect(db) as c:
   assert c.execute('select volume_ml,confirmed_by,evidence_note from return_historical_evidence where item_id=?',(unknown,)).fetchone()==(30,'owner','تصویر فاکتور معتبر بررسی شد')
  data=api(port,'GET','/api/auth/orders',customer=a)[1];entry=next(i for o in data['orders'] for i in o['items'] if i['id']==unknown);assert entry['return_info']['eligible']

  assert api(port,'POST',rp,{**payload,'quantity':3},customer=a)[1]['reason']=='INVALID_QUANTITY'
  assert api(port,'POST',rp,{**payload,'used_under_2ml':'true'},customer=a)[1]['reason']=='INVALID_INPUT'
  def submit(_):return api(port,'POST',rp,payload,customer=a)
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(submit,range(2)))
  assert sorted(r[0] for r in results)==[201,400],results
  req=next(r[1]['request_id'] for r in results if r[0]==201)
  with sqlite3.connect(db) as c:
   row=c.execute('select t.order_id,t.product_name,t.volume_ml,t.mobile,r.item_id,r.quantity,t.status,r.status from tickets t join account_return_requests r on r.request_id=t.ticket_id where t.ticket_id=?',(req,)).fetchone()
   assert row==('OWNER','Actual product',30,'09120001111',good,1,'NEW_PENDING','NEW_PENDING'),row
   assert c.execute("select count(*) from tickets where ticket_id=?",(req,)).fetchone()[0]==1
   assert c.execute('select description from tickets where ticket_id=?',(req,)).fetchone()[0].startswith('تعداد: 1\n')
  items=api(port,'GET','/api/auth/orders',customer=a)[1]['orders'][0]['items'];assert next(i for i in items if i['id']==good)['return_info']['request']['request_id']==req
  assert api(port,'PUT','/api/tickets/'+req,{'reply':'response','status':'INVALID'},admin=admin)[0]==400
  assert api(port,'PUT','/api/tickets/'+req,{'reply':'response','status':'ANSWERED'},admin=admin)[0]==200
  with sqlite3.connect(db) as c:assert c.execute('select t.status,r.status,t.reply from tickets t join account_return_requests r on r.request_id=t.ticket_id where t.ticket_id=?',(req,)).fetchone()==('ANSWERED','ANSWERED','response')
  assert api(port,'PUT','/api/tickets/'+req,{'status':'CLOSED'},admin=admin)[0]==200
  with sqlite3.connect(db) as c:assert c.execute('select t.status,r.status from tickets t join account_return_requests r on r.request_id=t.ticket_id where t.ticket_id=?',(req,)).fetchone()==('CLOSED','CLOSED')
  assert api(port,'POST',rp,{**payload,'item_id':good},customer=b)[0]==404
  with sqlite3.connect(db) as c:
   c.execute("delete from settings where key='account_returns_schema_v1'");c.commit()
  assert api(port,'PUT','/api/tickets/'+req,{'reply':'no update'},admin=admin)[0]==503
  with sqlite3.connect(db) as c:assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
 finally:stop(p)
 # Feature is inaccessible by default, even in test mode.
 p,port=boot({'RETURNS_API_TEST_ONLY':''})
 try:assert api(port,'POST','/api/auth/account-returns',{})[0]==404 and api(port,'POST','/api/admin/account-returns/delivery',{})[0]==404
 finally:stop(p)
 print('PASS staged OTP owner-only return and admin evidence API, race, ticket linkage and default-off gate; mocked SMS')
