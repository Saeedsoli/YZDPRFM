#!/usr/bin/env python3
"""Read-only return metadata is scoped to verified owners and explicit evidence."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='return-account-') as td:
 t=Path(td);db=t/'db.sqlite';mock=t/'sms.js';mock.write_text('const s=require('+json.dumps(str(root/'src/sms.js'))+');s.sendOtp=async()=>({ok:true});')
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'NODE_OPTIONS':'--require='+str(mock)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def api(method,path,body=None,token=None):
  h={'Content-Type':'application/json'}
  if token:h['X-Customer-Token']=token
  req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,json.load(r),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
 def token(phone):
  assert api('POST','/api/auth/request-code',{'mobile':phone})[0]==200
  with sqlite3.connect(db) as c:code=c.execute('select code from otp_codes where mobile=?',(phone,)).fetchone()[0]
  status,data,_=api('POST','/api/auth/verify-code',{'mobile':phone,'code':code});assert status==200,data;return data['token']
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  now=int(time.time()*1000)
  with sqlite3.connect(db) as c:
   sku=c.execute('select sku from variants limit 1').fetchone()[0]
   for oid,mob in [('OWNER','09120001111'),('OTHER','09120002222')]:
    c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values(?,'2026-01-01','Fixture',?,100,0,100,'DELIVERED')",(oid,mob))
   def item(order,name,volume):
    cur=c.execute('insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values(?,?,?,100,1,100)',(order,sku,name));id=cur.lastrowid
    if volume:c.execute('insert into return_item_evidence(item_id,volume_ml) values(?,?)',(id,volume))
    return id
   normal=item('OWNER','own product',30);sample=item('OWNER','own sample',5);unknown=item('OWNER','old product',None);other=item('OTHER','other product',30)
   c.execute("insert into return_delivery_evidence values('OWNER',?,?,?)",(now-1000,now,'staff'))
   c.execute("insert into return_delivery_evidence values('OTHER',?,?,?)",(now-73*3600000,now,'staff'))
   c.commit()
  assert api('GET','/api/auth/orders')[0]==401
  a=token('09120001111');b=token('09120002222')
  status,data,h=api('GET','/api/auth/orders',token=a);assert status==200 and h['Cache-Control']=='no-store'
  assert len(data['orders'])==1 and data['orders'][0]['order_id']=='OWNER'
  items={x['id']:x for x in data['orders'][0]['items']};assert items[normal]['return_info']['eligible'] and items[normal]['return_info']['volume_ml']==30
  assert items[sample]['return_info']['reason']=='VOLUME_INELIGIBLE' and items[unknown]['return_info']['reason']=='VOLUME_UNAVAILABLE'
  assert other not in items
  status,data,_=api('GET','/api/auth/orders',token=b);assert status==200 and len(data['orders'])==1
  assert data['orders'][0]['items'][0]['return_info']['reason']=='EXPIRED'
  with sqlite3.connect(db) as c:
   c.execute("insert into account_return_requests(request_id,item_id,mobile,quantity,description,used_under_2ml,created_at_ms,status) values('RET-TEST',?,'09120001111',1,'valid description',1,?,'NEW_PENDING')",(normal,now));c.commit()
  result=api('GET','/api/auth/orders',token=a)[1];infos={i['id']:i['return_info'] for i in result['orders'][0]['items']};assert infos[normal]['reason']=='REQUEST_OPEN' and infos[normal]['request']['request_id']=='RET-TEST'
  with sqlite3.connect(db) as c:c.execute("delete from settings where key='account_returns_schema_v1'");c.commit()
  result=api('GET','/api/auth/orders',token=a)[1];assert all(i['return_info']['reason']=='SERVICE_UNAVAILABLE' for i in result['orders'][0]['items'])
  print('PASS verified account isolation, explicit evidence, expiry, open request and unavailable schema; mocked SMS')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
