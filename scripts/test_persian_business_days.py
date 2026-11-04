#!/usr/bin/env python3
"""Shop civil-day boundaries for coupons, campaigns, notices and admin clock."""
import csv,datetime,io,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='shop-day-boundary-') as td:
 t=Path(td);db=t/'shop.sqlite';clock=t/'clock.txt';patch=t/'clock.js'
 epoch=lambda x:int(datetime.datetime.fromisoformat(x.replace('Z','+00:00')).timestamp()*1000)
 clock.write_text(str(epoch('2026-11-03T20:29:59Z')))
 patch.write_text("const fs=require('fs'),Real=Date;class Fake extends Real{constructor(...a){super(...(a.length?a:[Number(fs.readFileSync(process.env.TEST_CLOCK,'utf8'))]))}static now(){return Number(fs.readFileSync(process.env.TEST_CLOCK,'utf8'))}}global.Date=Fake;")
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Shop-Day-Owner-982','NODE_OPTIONS':'--require='+str(patch),'TEST_CLOCK':str(clock)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def call(method,path,body=None,token=None):
  h={'Content-Type':'application/json'}
  if token:h['Authorization']='Bearer '+token
  req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method)
  try:
   with urllib.request.urlopen(req,timeout=10) as r:return r.status,r.read(),dict(r.headers)
  except urllib.error.HTTPError as e:return e.code,e.read(),dict(e.headers)
 def api(method,path,body=None,token=None):
  st,b,h=call(method,path,body,token);return st,json.loads(b),h
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:
   sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()[0]
   c.execute("insert into coupons(code,type,value,min_subtotal,per_user_once,starts_at,expires_at,active) values('BOUNDARY','PERCENT',10,0,0,'2026-11-04','2026-11-04',1)")
   c.execute("insert into coupons(code,type,value,min_subtotal,per_user_once,expires_at,active) values('BAD-DATE','PERCENT',10,0,0,'2026-02-30',1)")
   c.execute("insert into campaigns(title,percent,starts_at,ends_at,active) values('Boundary campaign',10,'2026-11-04','2026-11-04',1)")
   c.execute("insert into notices(text,tone,starts_at,ends_at,active) values('Boundary notice','gold','2026-11-04','2026-11-04',1)")
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values('DATE-CSV','2026-11-03T21:00:00.000Z','Fixture','09120001111',100,0,100,'PAID')");c.commit()
  assert api('GET','/api/admin/clock')[0]==401
  status,login,_=api('POST','/api/admin/login',{'username':'owner','password':'Shop-Day-Owner-982'});assert status==200;admin=login['token']
  status,clockData,h=api('GET','/api/admin/clock',token=admin);assert status==200 and clockData['now_ms']==epoch('2026-11-03T20:29:59Z') and h['Cache-Control']=='no-store'
  # Invalid date ordering and an insert failure must not disable the existing notice.
  invalid={'text':'Invalid notice','starts_at':'2026-11-05','ends_at':'2026-11-04'}
  assert api('POST','/api/admin/notices',invalid,token=admin)[0]==400
  with sqlite3.connect(db) as c:
   assert c.execute("select active from notices where text='Boundary notice'").fetchone()[0]==1
   c.execute("create trigger fail_notice before insert on notices when new.text='FAIL-NOTICE' begin select raise(abort,'fixture'); end");c.commit()
  assert api('POST','/api/admin/notices',{'text':'FAIL-NOTICE'},token=admin)[0]==500
  with sqlite3.connect(db) as c:
   assert c.execute("select active from notices where text='Boundary notice'").fetchone()[0]==1
   c.execute('drop trigger fail_notice');c.commit()
  calc={'items':[{'sku':sku,'quantity':1}],'coupon_code':'BOUNDARY'}
  assert api('GET','/api/coupons/public?code=BOUNDARY')[0]==404
  assert api('POST','/api/cart/calculate',calc)[1]['discount']==0
  assert not any(x['title']=='Boundary campaign' for x in api('GET','/api/campaigns')[1]['campaigns'])
  assert api('GET','/api/notice')[1]['notice'] is None
  # Only two seconds pass: the campaign cache must still roll over at the
  # shop's midnight instead of waiting for the UTC date or the cache TTL.
  clock.write_text(str(epoch('2026-11-03T20:30:01Z')))
  assert api('GET','/api/admin/clock',token=admin)[1]['now_ms']==epoch('2026-11-03T20:30:01Z')
  assert api('GET','/api/coupons/public?code=BOUNDARY')[0]==200
  assert api('POST','/api/cart/calculate',calc)[1]['discount']>0
  assert any(x['title']=='Boundary campaign' for x in api('GET','/api/campaigns')[1]['campaigns'])
  assert api('GET','/api/notice')[1]['notice']['text']=='Boundary notice'
  assert api('GET','/api/coupons/public?code=BAD-DATE')[0]==404
  assert api('POST','/api/cart/calculate',{**calc,'coupon_code':'BAD-DATE'})[1]['discount']==0
  st,raw,h=call('GET','/api/admin/export/csv',token=admin);assert st==200 and h['Cache-Control']=='no-store'
  rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'),newline='')));row=next(r for r in rows if r[0]=='DATE-CSV');assert row[1]=='۱۳ / ۰۸ / ۱۴۰۵',row[1]
  clock.write_text(str(epoch('2026-11-04T20:30:01Z')))
  assert api('GET','/api/coupons/public?code=BOUNDARY')[0]==404
  assert api('POST','/api/cart/calculate',calc)[1]['discount']==0
  assert not any(x['title']=='Boundary campaign' for x in api('GET','/api/campaigns')[1]['campaigns'])
  assert api('GET','/api/notice')[1]['notice'] is None
  with sqlite3.connect(db) as c:assert c.execute('pragma integrity_check').fetchone()[0]=='ok'
  print('PASS coupon, campaign, notice and admin clock around shop midnight; CSV date is Persian')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
