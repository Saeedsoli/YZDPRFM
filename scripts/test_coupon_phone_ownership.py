#!/usr/bin/env python3
"""Restricted coupons require a verified matching phone; isolated DB and fake SMS."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='coupon-phone-') as tmp:
 td=Path(tmp);db=td/'shop.sqlite';mock=td/'sms.js';mock.write_text("const s=require("+json.dumps(str(root/'src/sms.js'))+");s.sendOtp=async()=>({ok:true});")
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox','NODE_OPTIONS':'--require='+str(mock)}
 def boot(extra=None):
  sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();proc=subprocess.Popen(['node','src/server.js'],cwd=root,env={**env,'PORT':str(port),**(extra or {})},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):return proc,port
   except OSError:time.sleep(.05)
  raise RuntimeError('server startup timeout')
 def stop(proc):
  if proc.poll() is None:proc.terminate();proc.wait(timeout=10)
 def api(port,method,path,body,token=None):
  h={'Content-Type':'application/json'}
  if token:h['X-Customer-Token']=token
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def login(port,phone):
  status,_=api(port,'POST','/api/auth/request-code',{'mobile':phone});assert status==200
  with sqlite3.connect(db) as c:code=c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
  status,r=api(port,'POST','/api/auth/verify-code',{'mobile':phone,'code':code});assert status==200;return r['token']
 p,port=boot();owner='09120001111';other='09120002222'
 try:
  with sqlite3.connect(db) as c:
   sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()[0]
   c.execute("insert into coupons(code,type,value,assigned_mobile,per_user_once,active) values('MINE-TEST','FIXED',1000,?,0,1)",(owner,))
   c.execute("insert into coupons(code,type,value,first_order_only,per_user_once,active) values('FIRST-TEST','FIXED',1000,1,0,1)")
   c.execute("insert into coupons(code,type,value,assigned_mobile,per_user_once,active) values('REVOKE-TEST','FIXED',1000,?,0,1)",(owner,))
   c.execute("insert into coupons(code,type,value,per_user_once,active) values('PUBLIC-TEST','FIXED',1000,0,1)")
  items=[{'sku':sku,'quantity':1}]
  def calc(code,mobile=owner,token=None):return api(port,'POST','/api/cart/calculate',{'items':items,'mobile':mobile,'coupon_code':code},token)
  def validate(code,mobile=owner,token=None):return api(port,'POST','/api/coupons/validate',{'items':items,'mobile':mobile,'code':code},token)
  def order(code,mobile=owner,token=None):return api(port,'POST','/api/orders',{'customer_name':'Fixture','mobile':mobile,'coupon_code':code,'items':items},token)
  for code in ['MINE-TEST','FIRST-TEST']:
   status,r=calc(code);assert status==200 and r['discount']==0 and r['coupon_error']
   assert validate(code)[0]==400 and order(code)[0]==400
  assert calc('PUBLIC-TEST')[1]['discount']==1000 and validate('PUBLIC-TEST')[0]==200
  with sqlite3.connect(db) as c:assert c.execute('select count(*) from orders').fetchone()[0]==0
  token=login(port,owner);wrong=login(port,other)
  assert calc('MINE-TEST',token=token)[1]['discount']==1000 and validate('MINE-TEST',token=token)[0]==200
  assert calc('MINE-TEST',token=wrong)[1]['discount']==0
  assert order('MINE-TEST',mobile=other,token=token)[0]==400
  assert order('FIRST-TEST',mobile=other,token=token)[0]==400
  status,r=order('MINE-TEST',token=token);assert status==201,(status,r);oid=r['order_id']
  with sqlite3.connect(db) as c:
   assert c.execute('select mobile,discount_code from orders where order_id=?',(oid,)).fetchone()==(owner,'MINE-TEST')
   assert c.execute("select mobile,order_id from coupon_usage where code='MINE-TEST'").fetchone()==(owner,oid)
   c.execute("update orders set status='PAID' where order_id=?",(oid,))
  assert calc('FIRST-TEST',token=token)[1]['discount']==0
 finally:stop(p)
 # Deterministically revoke the session between prevalidation and the locked
 # order transaction. The inner check must reject without creating an order.
 patch=td/'revoke.js';patch.write_text("require("+json.dumps(str(mock))+");const d=require("+json.dumps(str(root/'src/db.js'))+");const f=d.validateCoupon;d.validateCoupon=(...a)=>{const r=f(...a);if(a[0]==='REVOKE-TEST'&&r.ok&&!d.db.inTransaction)d.db.prepare('delete from sessions where token=?').run(process.env.REVOKE_TOKEN);return r};")
 p,port=boot({'NODE_OPTIONS':'--require='+str(patch),'REVOKE_TOKEN':token})
 try:
  with sqlite3.connect(db) as c:before=c.execute('select count(*) from orders').fetchone()[0]
  status,r=api(port,'POST','/api/orders',{'customer_name':'Fixture','mobile':owner,'coupon_code':'REVOKE-TEST','items':items},token)
  assert status==409 and 'کد تخفیف' in r['error'],(status,r)
  with sqlite3.connect(db) as c:
   assert c.execute('select count(*) from orders').fetchone()[0]==before
   assert c.execute("select count(*) from coupon_usage where code='REVOKE-TEST'").fetchone()[0]==0
   assert c.execute("select used_count from coupons where code='REVOKE-TEST'").fetchone()[0]==0
 finally:stop(p)
 print('PASS assigned/first-order coupons require verified matching phone; guest coupons work and revoked-session race rolls back')
