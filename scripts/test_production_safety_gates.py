#!/usr/bin/env python3
"""Isolated production gates and mocked provider callbacks; no real SMS/payment."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path
root=Path(__file__).resolve().parent.parent
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect)
with tempfile.TemporaryDirectory(prefix='production-safety-') as td:
 td=Path(td);mock=td/'fake_https.js';network=td/'network.log'
 mock.write_text('''const https=require('https'),{EventEmitter}=require('events'),fs=require('fs');
https.request=(opt,cb)=>{const q=new EventEmitter();let body='';q.write=x=>{body+=x};q.destroy=()=>{};q.end=()=>setImmediate(()=>{const b=JSON.parse(body||'{}');fs.appendFileSync(process.env.MOCK_NETWORK_LOG,JSON.stringify({path:opt.path,authority:b.authority||null})+'\\n');if(b.authority==='AUTH-ERR'||(opt.path.includes('/request.json')&&process.env.MOCK_REQUEST_FAIL==='1')){q.emit('error',Error('fixture unavailable'));return}const r=new EventEmitter();cb(r);setImmediate(()=>{r.emit('data',JSON.stringify({data:{code:b.authority==='AUTH-101'?101:100,ref_id:'FAKE-REF-'+(b.authority||'REQUEST'),authority:'AUTH-CREATE'}}));r.emit('end')})});return q};''')
 def freeport():
  s=socket.socket();s.bind(('127.0.0.1',0));p=s.getsockname()[1];s.close();return p
 def setup(mode,extra):
  db=td/f'{mode}.sqlite';port=freeport();log=td/f'{mode}.log'
  env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'production','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Isolated-Production-3827','PORT':str(port),'SITE_URL':'https://shop.example.test'}
  for k in ['PAYMENT_GATEWAY','ZARINPAL_MERCHANT_ID','ZARINPAL_SANDBOX','SMS_PROVIDER','SMS_API_KEY','SMS_USERNAME','SMS_PASSWORD','SMS_API_URL','NODE_OPTIONS']:env.pop(k,None)
  env.update(extra);out=open(log,'w+');p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=out,stderr=out)
  for _ in range(200):
   if p.poll() is not None:raise RuntimeError(log.read_text())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server startup timeout')
  return db,port,p,out,log
 def stop(p,out):p.terminate();p.wait(timeout=10);out.close()
 def api(port,method,path,body=None,token=None):
  h={'Content-Type':'application/json'}
  if token:h['Authorization']='Bearer '+token
  data=None if body is None else json.dumps(body).encode();req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=data,headers=h,method=method)
  try:
   with opener.open(req,timeout=5) as r:return r.status,r.read().decode(),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,e.read().decode(),dict(e.headers)
 def order_rows(db):
  c=sqlite3.connect(db);out=(c.execute('select count(*) from orders').fetchone()[0],c.execute('select count(*) from order_items').fetchone()[0],c.execute('select count(*) from coupon_usage').fetchone()[0]);c.close();return out
 # Default and explicitly sandboxed production cannot create or settle orders.
 for name,settings in [('default',{}),('sandbox',{'PAYMENT_GATEWAY':'sandbox'}),('unknown',{'PAYMENT_GATEWAY':'typo'}),('zp_test',{'PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'12345678-1234-4234-8234-123456789abc','ZARINPAL_SANDBOX':'true'}),('bad_merchant',{'PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'not-a-uuid'}),('bad_url',{'PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'12345678-1234-4234-8234-123456789abc','SITE_URL':'http://example.test'})]:
  db,port,p,out,log=setup(name,settings)
  try:
   c=sqlite3.connect(db);sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()[0];stock=c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,payment_gateway,payment_ref,status) values('HIST-PENDING',?,'Test','09120000001',1000,0,1000,'SANDBOX','SBX-OLD','PENDING')",(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),));c.commit();c.close()
   before=order_rows(db);code,_,_=api(port,'POST','/api/orders',{'customer_name':'Test','mobile':'09120000002','items':[{'sku':sku,'quantity':1}]});assert code==503 and order_rows(db)==before,(name,code)
   code,_,_=api(port,'POST','/api/payment/verify',{'order_id':'HIST-PENDING','result':'success'});assert code==503
   code,_,_=api(port,'GET','/payment/callback?order=HIST-PENDING&Authority=SBX-OLD&Status=OK');assert code==503
   c=sqlite3.connect(db);assert c.execute("select status from orders where order_id='HIST-PENDING'").fetchone()[0]=='PENDING';assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==stock;c.close()
   # No fake OTP success or code logging when SMS is unconfigured in production.
   code,msg,_=api(port,'POST','/api/auth/request-code',{'mobile':'09120001234'});assert code==400 and 'dev_mode' not in msg
   c=sqlite3.connect(db);assert c.execute("select count(*) from otp_codes where mobile='09120001234'").fetchone()[0]==0;c.close();out.flush();assert '[OTP]' not in log.read_text()
   code,login,_=api(port,'POST','/api/admin/login',{'username':'owner','password':'Isolated-Production-3827'});assert code==200;token=json.loads(login)['token']
   code,ready,_=api(port,'GET','/api/admin/readiness',token=token);ready=json.loads(ready);assert code==200
   levels={x['key']:x['level'] for x in ready['items']};assert levels['payment']=='error' and levels['sms']=='error' and levels['stock']=='ok',levels
  finally:stop(p,out)
 # All SMS fallback modes fail without echoing message contents or OTPs.
 for provider in ['console','generic']:
  env={**os.environ,'NODE_ENV':'production','SMS_PROVIDER':provider}
  for k in ['SMS_API_KEY','SMS_USERNAME','SMS_PASSWORD','SMS_API_URL']:env.pop(k,None)
  probe="""(async()=>{let s=require('./src/sms');let a=await s.send('09120001111','PRIVATE-MESSAGE-FIXTURE');let b=await s.sendOtp('09120001111','24680');let c=await s.sendSmart('09120001111','order',[],'PRIVATE-SMART-FIXTURE');let d=await s.testConnection();console.log(JSON.stringify({a:a.ok,b:b.ok,c:c.ok,live:d.live}));})();"""
  r=subprocess.run(['node','-e',probe],cwd=root,env=env,capture_output=True,text=True,timeout=30);assert r.returncode==0,r.stderr
  assert json.loads(r.stdout.strip().splitlines()[-1])=={'a':False,'b':False,'c':False,'live':False}
  assert all(v not in r.stdout+r.stderr for v in ['PRIVATE-MESSAGE-FIXTURE','PRIVATE-SMART-FIXTURE','24680'])
 # A failed provider request releases only physical units actually reserved.
 failsettings={'PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'12345678-1234-4234-8234-123456789abc','NODE_OPTIONS':'--require='+str(mock),'MOCK_NETWORK_LOG':str(network),'MOCK_REQUEST_FAIL':'1'}
 db,port,p,out,log=setup('request_fail',failsettings)
 try:
  c=sqlite3.connect(db);pair=c.execute("select p.id,v.sku from products p join variants v on v.product_id=p.id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 order by p.id limit 2").fetchall()
  (mto_pid,mto),(physical_pid,physical)=pair;c.execute("update products set supply_mode='IN_STOCK' where id=?",(physical_pid,));c.execute('update variants set stock=2 where sku=?',(physical,));c.execute('update variants set stock=0 where sku=?',(mto,));c.commit();c.close()
  code,body,_=api(port,'POST','/api/orders',{'customer_name':'Test','mobile':'09120000005','items':[{'sku':mto,'quantity':2},{'sku':physical,'quantity':1}]});assert code==502,(code,body)
  c=sqlite3.connect(db);assert c.execute('select stock from variants where sku=?',(mto,)).fetchone()[0]==0;assert c.execute('select stock from variants where sku=?',(physical,)).fetchone()[0]==2
  assert c.execute("select count(*) from orders where mobile='09120000005' and status='FAILED'").fetchone()[0]==1;c.close()
 finally:stop(p,out)
 if network.exists():network.unlink()
 # Stubbed provider: authority is bound to the actual pending order.
 settings={'PAYMENT_GATEWAY':'zarinpal','ZARINPAL_MERCHANT_ID':'12345678-1234-4234-8234-123456789abc','NODE_OPTIONS':'--require='+str(mock),'MOCK_NETWORK_LOG':str(network)}
 db,port,p,out,log=setup('live_mock',settings)
 try:
  c=sqlite3.connect(db);now=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
  for oid,auth in [('PAY-A','AUTH-A'),('PAY-B','AUTH-B'),('PAY-101','AUTH-101'),('PAY-ERR','AUTH-ERR'),('PAY-CANCEL','AUTH-CANCEL')]:
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,payment_gateway,payment_ref,status) values(?,?,'Test','09120000001',1000,0,1000,'ZARINPAL',?,'PENDING')",(oid,now,auth))
  # Test a known zero-stock reservation and coupon release on cancellation.
  sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.stock=0 and v.type='EDP' and v.volume_ml=10 limit 1").fetchone()[0]
  item=c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('PAY-CANCEL',?,'Test',1000,1,1000)",(sku,)).lastrowid
  c.execute('insert into order_stock_reservations(item_id,reserved_qty,released) values(?,0,0)',(item,))
  c.execute("insert into coupons(code,type,value,used_count,active) values('TESTCALLBACK','PERCENT',10,1,1)")
  c.execute("insert into coupon_usage(code,mobile,order_id,used_at) values('TESTCALLBACK','09120000001','PAY-CANCEL',?)",(now,));c.commit();c.close()
  code,_,_=api(port,'POST','/api/payment/verify',{'order_id':'PAY-B','authority':'AUTH-A','result':'success'});assert code==405
  for status in ['OK','NOK']:
   code,_,_=api(port,'GET',f'/payment/callback?order=PAY-B&Authority=AUTH-A&Status={status}');assert code==409
  c=sqlite3.connect(db);assert c.execute("select status,payment_ref from orders where order_id='PAY-B'").fetchone()==('PENDING','AUTH-B');c.close();assert not network.exists()
  code,_,h=api(port,'GET','/payment/callback?order=PAY-A&Authority=AUTH-A&Status=OK');assert code==302 and 'ok=1' in h['Location']
  c=sqlite3.connect(db);assert c.execute("select status from orders where order_id='PAY-A'").fetchone()[0]=='PAID';c.close()
  assert api(port,'GET','/payment/callback?order=PAY-A&Authority=AUTH-A&Status=OK')[0]==302
  lines=network.read_text().splitlines();assert len(lines)==1 and json.loads(lines[0])['authority']=='AUTH-A'
  for oid,auth in [('PAY-101','AUTH-101'),('PAY-ERR','AUTH-ERR')]:
   code,_,_=api(port,'GET',f'/payment/callback?order={oid}&Authority={auth}&Status=OK');assert code==503
   c=sqlite3.connect(db);assert c.execute('select status,payment_ref from orders where order_id=?',(oid,)).fetchone()==('VERIFYING',auth);c.close()
  # Unknown bank outcomes must not be cancelled by expiry maintenance.
  c=sqlite3.connect(db);c.execute("update orders set created_at='2000-01-01T00:00:00.000Z' where order_id in ('PAY-101','PAY-ERR')");c.commit();c.close()
  upkeep={**os.environ,'NODE_ENV':'production','DB_PATH':str(db),'BACKUP_DISABLED':'1'}
  subprocess.run(['node','-e',"const x=require('./src/db');x.releaseStaleOrders();x.db.close()"],cwd=root,env=upkeep,check=True,stdout=subprocess.DEVNULL,timeout=120)
  c=sqlite3.connect(db);assert c.execute("select count(*) from orders where order_id in ('PAY-101','PAY-ERR') and status='VERIFYING'").fetchone()[0]==2;c.close()
  code,_,_=api(port,'GET','/payment/callback?order=PAY-CANCEL&Authority=AUTH-CANCEL&Status=NOK');assert code==503
  c=sqlite3.connect(db);assert c.execute("select status from orders where order_id='PAY-CANCEL'").fetchone()[0]=='VERIFYING';assert c.execute("select used_count from coupons where code='TESTCALLBACK'").fetchone()[0]==1;assert c.execute("select count(*) from coupon_usage where order_id='PAY-CANCEL'").fetchone()[0]==1;assert c.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==0;c.close()
  # Existing passwordless account cannot be claimed using legacy sessions.
  c=sqlite3.connect(db);c.execute("insert into customers(mobile,first_name) values('09120009999','Test')");c.execute("insert into sessions(token,kind,subject,expires_at) values(?,?,?,?)",('a'*48,'CUSTOMER','09120009999',int(time.time()*1000)+600000));c.commit();c.close()
  data={'first_name':'Test','mobile':'09120009999','password':'Private-Test-879'}
  assert api(port,'POST','/api/auth/register',data)[0]==400
  req=urllib.request.Request(f'http://127.0.0.1:{port}/api/auth/register',data=json.dumps(data).encode(),headers={'Content-Type':'application/json','X-Customer-Token':'a'*48},method='POST')
  try:opener.open(req,timeout=5);raise AssertionError('unverified legacy token accepted')
  except urllib.error.HTTPError as ex:assert ex.code==400
  c=sqlite3.connect(db);assert c.execute("select pass_hash from customers where mobile='09120009999'").fetchone()[0] is None
  nowms=int(time.time()*1000);c.execute("insert into otp_codes(mobile,code,expires_at,last_sent,attempts) values('09120009999','24680',?,?,0)",(nowms+120000,nowms));c.commit();c.close()
  data['code']='24680';code,_,headers=api(port,'POST','/api/auth/register',data);assert code==200 and headers.get('Cache-Control')=='no-store' and 'Secure' in headers.get('Set-Cookie','') and 'HttpOnly' in headers.get('Set-Cookie','')

 finally:stop(p,out)
print('PASS production payment/OTP fail closed, authority binding, uncertain-payment and coupon preservation and existing-account ownership (fake providers only)')
