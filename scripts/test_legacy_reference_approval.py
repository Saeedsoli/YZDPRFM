#!/usr/bin/env python3
"""Two legacy selections: fresh build, backfill, carts, preservation and guards."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from decimal import Decimal
from pathlib import Path
from supplier_coverage import read_rows,group_rows
root=Path(__file__).resolve().parent.parent
m=json.loads((root/'seed/secondary_reference_prices_v28.json').read_text());items=m['items']
rows,sha=read_rows(root/'uploads/لیست_قیمت_عمده.md');assert sha==m['supplier_file_sha256'];groups=group_rows(rows)
assert len(items)==2
for x in items:
 rs=groups[x['supplier_brand'],x['supplier_model'],x['supplier_gender']];maxp=max(r['price'] for r in rs)
 assert maxp==Decimal(x['usd_per_kg']) and any(r['quality']==x['quality'] and r['price']==maxp for r in rs)
with tempfile.TemporaryDirectory(prefix='legacy-approval-') as td:
 db=str(Path(td)/'fresh.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port)}
 for k in ['APPROVED_MTO_AUTOSTART','LEGACY_REFERENCES_AUTOSTART','GENERIC_SCENTS_AUTOSTART','GENERIC_SCENTS_V2_AUTOSTART','OWNER_REFERENCE_AUTOSTART','OWNER_REFERENCE_V2_AUTOSTART','OWNER_REFERENCE_V3_AUTOSTART']+[f'APPROVED_MTO_V{i}_AUTOSTART' for i in range(2,18)]:env.pop(k,None)
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server timeout')
  c=sqlite3.connect(db);assert c.execute("select count(*) from products where supply_mode='MADE_TO_ORDER'").fetchone()[0]==265
  for x in items:
   p=c.execute('select supply_mode,essence_usd_per_kg,gender,notes_top,notes_middle,notes_base,accords,transparency_notice,maker_note_approved from products where id=?',(x['product_id'],)).fetchone()
   assert p[:3]==('MADE_TO_ORDER',x['usd_per_kg'],x['reference_gender']) and [json.loads(i) for i in p[3:6]]==[x['notes'][k] for k in ['top','middle','base']] and json.loads(p[6])==[] and 'فراگرانتیکا' in p[7] and p[8]==0
   assert c.execute('select source_url,provider,status from secondary_reference_evidence where product_id=?',(x['product_id'],)).fetchone()==(x['source_url'],'Fragrantica',x['status'])
   assert c.execute('select count(*) from official_identity_evidence where product_id=?',(x['product_id'],)).fetchone()[0]==0
   sku,stock=c.execute("select sku,stock from variants where product_id=? and type='EDP' and volume_ml=10",(x['product_id'],)).fetchone();assert stock==0
   def cart(n):
    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/cart/calculate',data=json.dumps({'items':[{'sku':sku,'quantity':n}]}).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
     with urllib.request.urlopen(req,timeout=3) as r:return r.status
    except urllib.error.HTTPError as e:return e.code
   assert cart(1)==200 and cart(6)!=200
  # Correct note index has removed stale note "هل" for Invictus.
  assert c.execute("select count(*) from product_notes where product_id='YZD-PROD-0145' and note='هل'").fetchone()[0]==0
  assert c.execute("select count(*) from product_notes where product_id='YZD-PROD-0145' and note='آکورد ویسکی'").fetchone()[0]==1
  c.execute("update products set supply_mode='UNAVAILABLE' where id=?",(items[0]['product_id'],));c.commit();c.close()
  output=subprocess.check_output(['node','scripts/apply_legacy_references.js',db],cwd=root,text=True);assert json.loads(output.strip().splitlines()[-1])['reason']=='already_applied'
  c=sqlite3.connect(db);assert c.execute('select supply_mode from products where id=?',(items[0]['product_id'],)).fetchone()[0]=='UNAVAILABLE';c.close()
 finally:proc.terminate();proc.wait(timeout=10)
 # Build a previous installation where legacy prices are already present.
 baseline=str(Path(td)/'previous.sqlite');old={**env,'DB_PATH':baseline,'LEGACY_REFERENCES_AUTOSTART':'0'}
 subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=old,check=True,stdout=subprocess.DEVNULL)
 script="""const D=require('better-sqlite3'),d=new D(process.argv[1]),m=require('./seed/secondary_reference_prices_v28.json'),p=require('./src/product-essence-pricing');for(const x of m.items)p.applyProductPrice(d,x.product_id,p.kgToGram(x.usd_per_kg),300000,null);d.prepare(\"insert into settings(key,value) values('supplier_exact_price_import_v1','test') on conflict(key) do nothing\").run();d.close();"""
 subprocess.run(['node','-e',script,baseline],cwd=root,check=True)
 c=sqlite3.connect(baseline);before=c.execute('select * from variants order by sku').fetchall();orders=c.execute('select * from orders').fetchall();c.close()
 output=subprocess.check_output(['node','scripts/apply_legacy_references.js',baseline],cwd=root,text=True);assert json.loads(output.strip().splitlines()[-1])['activated']==2
 c=sqlite3.connect(baseline);assert c.execute('select * from variants order by sku').fetchall()==before and c.execute('select * from orders').fetchall()==orders;c.close()
 # Owner note edit or stock edit blocks both products atomically.
 for kind in ['note','stock']:
  guard=str(Path(td)/f'{kind}.sqlite');ge={**old,'DB_PATH':guard};subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=ge,check=True,stdout=subprocess.DEVNULL)
  c=sqlite3.connect(guard)
  if kind=='note':c.execute("update products set notes_top='[\"ویرایش مدیر\"]' where id=?",(items[0]['product_id'],))
  else:c.execute("update variants set stock=1 where sku='YZD-0145-EDP-010'")
  c.commit();c.close();p=subprocess.run(['node','scripts/apply_legacy_references.js',guard],cwd=root,capture_output=True);assert p.returncode!=0
  c=sqlite3.connect(guard);assert not c.execute("select 1 from settings where key='legacy_reference_approval_2026_11_v1'").fetchone();assert c.execute("select count(*) from products where id in ('YZD-PROD-0145','YZD-PROD-0362') and supply_mode='MADE_TO_ORDER'").fetchone()[0]==0;c.close()
print('PASS two legacy selections: fresh and existing price, cart, note index, owner edits and atomic rollback')
