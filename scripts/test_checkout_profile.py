#!/usr/bin/env python3
"""Checkout prefill reads only the verified owner's latest paid order."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='checkout-profile-') as tmp:
 td=Path(tmp);db=td/'db.sqlite';mock=td/'sms.js';mock.write_text("const s=require("+json.dumps(str(root/'src/sms.js'))+");s.sendOtp=async()=>({ok:true});")
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'NODE_OPTIONS':'--require='+str(mock)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body=None,token=None):
  h={'Content-Type':'application/json'}
  if token:h['X-Customer-Token']=token
  req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def login(phone):
  assert api('POST','/api/auth/request-code',{'mobile':phone})[0]==200
  with sqlite3.connect(db) as c:code=c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
  status,body,_=api('POST','/api/auth/verify-code',{'mobile':phone,'code':code});assert status==200;return body['token']
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  a,b,c='09120001001','09120001002','09120001003'
  with sqlite3.connect(db) as con:
   def row(oid,mobile,status,when,address,name='مریم احمدی'):
    con.execute("insert into orders(order_id,created_at,customer_name,mobile,first_name,last_name,email,province,city,address,postal_code,subtotal,shipping_fee,total_paid,status,admin_note,customer_note,payment_ref) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(oid,when,name,mobile,'مریم','احمدی','fixture@example.test','یزد','یزد',address,'8916100000',1000,0,1000,status,'SECRET-ADMIN','SECRET-NOTE','SECRET-REF'))
   row('A-PAID',a,'PAID','2026-01-01','نشانی پرداخت‌شده الف')
   row('A-PENDING',a,'PENDING','2026-02-01','نشانی نامعتبر در انتظار')
   row('A-CANCEL',a,'CANCELLED','2026-03-01','نشانی لغوشده')
   row('B-DELIVERED',b,'DELIVERED','2026-01-02','نشانی مشتری ب')
   before=con.execute('select * from orders order by order_id').fetchall()
  status,_,h=api('GET','/api/auth/checkout-profile');assert status==401 and h.get('Cache-Control')=='no-store'
  ta,tb,tc=login(a),login(b),login(c)
  status,r,h=api('GET','/api/auth/checkout-profile',token=ta);assert status==200 and h.get('Cache-Control')=='no-store'
  assert set(r)=={'profile'} and set(r['profile'])=={'customer_name','first_name','last_name','email','province','city','address','postal_code'}
  assert r['profile']['address']=='نشانی پرداخت‌شده الف' and all(v not in json.dumps(r,ensure_ascii=False) for v in ['SECRET-ADMIN','SECRET-NOTE','SECRET-REF','نامعتبر','لغوشده'])
  assert api('GET','/api/auth/checkout-profile',token=tb)[1]['profile']['address']=='نشانی مشتری ب'
  assert api('GET','/api/auth/checkout-profile',token=tc)[1]['profile'] is None
  orders=api('GET','/api/auth/orders',token=ta)[1]['orders'];assert all('address' not in o and 'admin_note' not in o for o in orders)
  with sqlite3.connect(db) as con:
   assert con.execute('select * from orders order by order_id').fetchall()==before
   con.execute('update sessions set expires_at=0 where token=?',(ta,))
  assert api('GET','/api/auth/checkout-profile',token=ta)[0]==401
  print('PASS verified-owner checkout profile, paid-only selection, isolation, no-store and historical order preservation')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
