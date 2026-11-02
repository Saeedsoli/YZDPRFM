#!/usr/bin/env python3
"""Selected independent references: supplier maxima, fresh activation and guards."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from decimal import Decimal
from pathlib import Path
from supplier_coverage import read_rows,group_rows
root=Path(__file__).resolve().parent.parent
m=json.loads((root/'seed/owner_reference_selection_v1.json').read_text());items=m['items']
rows,sha=read_rows(root/'uploads/لیست_قیمت_عمده.md');assert sha==m['supplier_file_sha256'];groups=group_rows(rows)
assert len(items)==4 and len({x['product_id'] for x in items})==4
for x in items:
 rs=groups[x['supplier_brand'],x['supplier_model'],x['supplier_gender']];maximum=max(r['price'] for r in rs)
 assert maximum==Decimal(x['usd_per_kg']) and any(r['price']==maximum and r['quality']==x['quality'] for r in rs)
with tempfile.TemporaryDirectory(prefix='owner-ref-') as td:
 db=str(Path(td)/'fresh.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'LEGACY_REFERENCES_AUTOSTART':'0','OWNER_REFERENCE_V3_AUTOSTART':'0','GENERIC_SCENTS_V2_AUTOSTART':'0','OWNER_REFERENCE_V2_AUTOSTART':'0','DB_PATH':db,'BACKUP_DISABLED':'1','PORT':str(port)}
 for k in ['APPROVED_MTO_AUTOSTART','GENERIC_SCENTS_AUTOSTART','OWNER_REFERENCE_AUTOSTART']+[f'APPROVED_MTO_V{i}_AUTOSTART' for i in range(2,18)]:env.pop(k,None)
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/products',timeout=1):break
   except Exception:time.sleep(.1)
  else:raise RuntimeError('server timeout')
  c=sqlite3.connect(db);assert c.execute("select count(*) from products where supply_mode='MADE_TO_ORDER'").fetchone()[0]==254
  for x in items:
   p=c.execute('select name_en,brand_en,supply_mode,essence_usd_per_kg,transparency_notice from products where id=?',(x['product_id'],)).fetchone();assert p[:4]==(x['name_en'],x['brand_en'],'MADE_TO_ORDER',x['usd_per_kg']) and 'تأیید نمی‌کند' in p[4]
   e=c.execute('select provider,source_url,status from owner_reference_price_evidence where product_id=?',(x['product_id'],)).fetchone();assert e==(x['provider'],x['source_url'],'owner_selected_independent_supplier_essence_unverified')
   assert c.execute('select count(*) from official_identity_evidence where product_id=?',(x['product_id'],)).fetchone()[0]==0
   vs=c.execute('select sku,stock,price_toman from variants where product_id=?',(x['product_id'],)).fetchall();assert len(vs)==6 and all(v[1]==0 and v[2]>0 for v in vs)
   def cart(n):
    req=urllib.request.Request(f'http://127.0.0.1:{port}/api/cart/calculate',data=json.dumps({'items':[{'sku':vs[0][0],'quantity':n}]}).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
     with urllib.request.urlopen(req,timeout=3) as r:return r.status
    except urllib.error.HTTPError as e:return e.code
   assert cart(1)==200 and cart(6)!=200
  c.execute("update products set supply_mode='UNAVAILABLE' where id=?",(items[0]['product_id'],));c.commit();c.close()
  out=subprocess.check_output(['node','scripts/apply_owner_references.js',db],cwd=root,text=True);assert json.loads(out)['reason']=='already_applied'
  c=sqlite3.connect(db);assert c.execute('select supply_mode from products where id=?',(items[0]['product_id'],)).fetchone()[0]=='UNAVAILABLE';c.close()
 finally:proc.terminate();proc.wait(timeout=10)
 collision=str(Path(td)/'collision.sqlite');e={**env,'DB_PATH':collision,'APPROVED_MTO_AUTOSTART':'0'}
 subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=e,check=True,stdout=subprocess.DEVNULL)
 c=sqlite3.connect(collision);c.execute("insert into products(id,slug,name_fa,name_en) values('collision',?,'x','x')",(items[1]['slug'],));c.commit();c.close()
 assert subprocess.run(['node','scripts/apply_owner_references.js',collision],cwd=root,capture_output=True).returncode!=0
 c=sqlite3.connect(collision);assert not c.execute("select 1 from products where id like 'OWNER-REF-%'").fetchone();assert not c.execute('select 1 from settings where key=?',(m['version'],)).fetchone();c.close()
print('PASS: four owner selections, supplier maxima, independent provenance, fresh boot, carts, replay and collision')
