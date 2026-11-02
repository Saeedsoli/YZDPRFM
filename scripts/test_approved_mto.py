#!/usr/bin/env python3
"""Owner approval, HTTP purchase and edit guards on disposable databases only."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'seed/approved_made_to_order_v1.json').read_text());ids={x['product_id'] for x in manifest['items']};assert len(ids)==192
with tempfile.TemporaryDirectory(prefix='approved-mto-') as td:
 db=str(Path(td)/'store.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
 env={**os.environ,'OWNER_REFERENCE_V3_AUTOSTART':'0','GENERIC_SCENTS_V2_AUTOSTART':'0','OWNER_REFERENCE_V2_AUTOSTART':'0','OWNER_REFERENCE_AUTOSTART':'0','GENERIC_SCENTS_AUTOSTART':'0','DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port)};env.pop('APPROVED_MTO_AUTOSTART',None);env['APPROVED_MTO_V2_AUTOSTART']='0';env['APPROVED_MTO_V3_AUTOSTART']='0';env['APPROVED_MTO_V4_AUTOSTART']='0';env['APPROVED_MTO_V5_AUTOSTART']='0';env['APPROVED_MTO_V6_AUTOSTART']='0';env['APPROVED_MTO_V7_AUTOSTART']='0';env['APPROVED_MTO_V8_AUTOSTART']='0';env['APPROVED_MTO_V9_AUTOSTART']='0';env['APPROVED_MTO_V10_AUTOSTART']='0';env['APPROVED_MTO_V11_AUTOSTART']='0';env['APPROVED_MTO_V12_AUTOSTART']='0';env['APPROVED_MTO_V13_AUTOSTART']='0';env['APPROVED_MTO_V14_AUTOSTART']='0';env['APPROVED_MTO_V15_AUTOSTART']='0';env['APPROVED_MTO_V16_AUTOSTART']='0';env['APPROVED_MTO_V17_AUTOSTART']='0'
 server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 base='http://127.0.0.1:'+str(port)
 def get(p):
  with urllib.request.urlopen(base+p,timeout=3) as r:return json.load(r)
 def post(p,data):
  req=urllib.request.Request(base+p,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'},method='POST')
  try:
   with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 try:
  for _ in range(200):
   if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
   try:get('/api/health');break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server not ready')
  con=sqlite3.connect(db)
  active={r[0] for r in con.execute("select id from products where supply_mode='MADE_TO_ORDER'")};assert active==ids,(len(active),len(ids))
  result=json.loads(con.execute("select value from settings where key='approved_made_to_order_2026_11_v1'").fetchone()[0]);assert result['activated']==192 and not result['skipped']
  notice=json.loads(con.execute("select value from settings where key='approved_mto_notice_correction_2026_11_v1'").fetchone()[0]);assert notice['updated']==85
  assert con.execute("select count(*) from products where supply_mode='MADE_TO_ORDER' and transparency_notice like '%عصاره خالص اولیه%'").fetchone()[0]==0
  assert all(con.execute('select supply_mode from products where id=?',(p,)).fetchone()[0]=='UNAVAILABLE' for p in ['YZD-PROD-0145','YZD-PROD-0362'])
  pid=manifest['items'][0]['product_id'];sku=con.execute("select sku from variants where product_id=? and type='EDP' and volume_ml=10",(pid,)).fetchone()[0]
  assert con.execute('select stock from variants where sku=?',(sku,)).fetchone()[0]==0
  status,body=post('/api/cart/sync',{'skus':[sku]});assert status==200 and body['variants'][0]['state']=='MADE_TO_ORDER' and body['variants'][0]['max_quantity']==5,body
  assert post('/api/cart/calculate',{'items':[{'sku':sku,'quantity':1}]})[0]==200
  assert post('/api/cart/calculate',{'items':[{'sku':sku,'quantity':6}]})[0]==400
  listed=get('/api/products?limit=24')['products'];assert len(listed)==24 and all(x['supply_mode']=='MADE_TO_ORDER' for x in listed),[(x['id'],x['supply_mode']) for x in listed]
  samples=get('/api/products?sample_5=1&limit=24');assert samples['total']==192,samples.get('total')
  con.execute("update products set supply_mode='UNAVAILABLE' where id=?",(pid,));con.commit();con.close()
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
 # Restart must not reactivate a product disabled by the owner.
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(db);assert con.execute('select supply_mode from products where id=?',(pid,)).fetchone()[0]=='UNAVAILABLE';con.close()
 # A pre-existing nonempty database with no product table is not a fresh store.
 prior=str(Path(td)/'existing-empty.sqlite');existing=sqlite3.connect(prior);existing.execute('create table owner_sentinel(value text)');existing.execute("insert into owner_sentinel values('preserve')");existing.commit();existing.close()
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env={**env,'DB_PATH':prior},check=True,stdout=subprocess.DEVNULL,timeout=120)
 existing=sqlite3.connect(prior);assert existing.execute("select count(*) from products where supply_mode='MADE_TO_ORDER'").fetchone()[0]==0;assert existing.execute('select value from owner_sentinel').fetchone()[0]=='preserve';existing.close()
 # Existing database is not silently activated, and manually edited prices skip safely.
 db2=str(Path(td)/'guard.sqlite');guard={**env,'DB_PATH':db2,'APPROVED_MTO_AUTOSTART':'0'}
 subprocess.run(['node','-e',"const {db}=require('./src/db');db.close()"],cwd=root,env=guard,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(db2); p1,p2=manifest['items'][0]['product_id'],manifest['items'][1]['product_id'];con.execute('update variants set price_toman=price_toman+1000 where product_id=? and type=\'EDP\' and volume_ml=10',(p1,));con.execute('update products set name_en=? where id=?',('owner edit',p2));p3=con.execute("select id from products where transparency_notice like '%عصاره خالص اولیه%' and id not in (?,?) limit 1",(p1,p2)).fetchone()[0];con.execute('update products set transparency_notice=? where id=?',('owner notice',p3));con.commit();con.close()
 subprocess.run(['node','-e',"const {db}=require('./src/db');const r=require('./src/approved-made-to-order').applyApprovedMadeToOrder(db,'./seed/approved_made_to_order_v1.json');if(r.activated!==190||r.skipped.length!==2)throw Error(JSON.stringify(r));require('./src/approved-made-to-order').correctApprovedNotices(db,'./seed/approved_made_to_order_v1.json');db.close()"],cwd=root,env=guard,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(db2);assert con.execute('select supply_mode from products where id=?',(p1,)).fetchone()[0]=='UNAVAILABLE';assert con.execute('select name_en,supply_mode from products where id=?',(p2,)).fetchone()==('owner edit','UNAVAILABLE');assert con.execute('select transparency_notice from products where id=?',(p3,)).fetchone()[0]=='owner notice';con.close()
print('PASS: 192 approved, ambiguous excluded, fresh boot, 5-item cap, cart, ordering, samples, edit/restart guards')
