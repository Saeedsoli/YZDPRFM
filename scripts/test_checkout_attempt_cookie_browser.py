#!/usr/bin/env python3
"""Real browsers share an HttpOnly order capability across two tabs."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='attempt-cookie-browser-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  with sqlite3.connect(db) as c:sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()[0]
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width,mobile in [(390,'09120001111'),(1440,'09120002222')]:
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');a=context.new_page();b=context.new_page()
    a.goto(base+'/contact',wait_until='domcontentloaded');b.goto(base+'/contact',wait_until='domcontentloaded')
    first=a.evaluate('''async()=>{const r=await fetch('/api/orders/attempt',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')}}''')
    assert first=={'status':201,'data':{'ready':True},'cache':'no-store'}
    cookies=[x for x in context.cookies() if x['name']=='yazd_order_attempt'];assert len(cookies)==1 and cookies[0]['httpOnly'] and cookies[0]['sameSite']=='Lax' and cookies[0]['path']=='/api/orders'
    assert 'yazd_order_attempt=' not in a.evaluate('document.cookie') and cookies[0]['value'] not in str(first)
    check=b.evaluate("async()=>{const r=await fetch('/api/orders/attempt/status');return {status:r.status,data:await r.json()}}")
    assert check=={'status':200,'data':{'ready':True}}
    body={'customer_name':'Browser','mobile':mobile,'items':[{'sku':sku,'quantity':1}]}
    js='''body=>{window.__attempt=fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(async r=>({status:r.status,data:await r.json()}));}'''
    a.evaluate(js,body);b.evaluate(js,body)
    r1=a.evaluate('()=>window.__attempt');r2=b.evaluate('()=>window.__attempt')
    assert sorted([r1['status'],r2['status']]) in ([200,201],[201,409]),(r1,r2)
    oid=next(x['data']['order_id'] for x in (r1,r2) if x['status']==201)
    assert all(x['data'].get('order_id')==oid for x in (r1,r2))
    assert a.evaluate("async()=>{const r=await fetch('/api/orders/attempt/rotate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status}")==409
    paid=a.evaluate("""async id=>{const r=await fetch('/api/payment/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:id,result:'success'})});return r.status}""",oid);assert paid==200
    old=cookies[0]['value'];rotated=b.evaluate("async()=>{const r=await fetch('/api/orders/attempt/rotate',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return r.status}");assert rotated==200
    new=[x for x in context.cookies() if x['name']=='yazd_order_attempt'];assert len(new)==1 and new[0]['httpOnly'] and new[0]['value']!=old
    with sqlite3.connect(db) as c:assert c.execute('select count(*) from orders where mobile=?',(mobile,)).fetchone()[0]==1
    context.close()
   browser.close()
  print('PASS HttpOnly capability shared across two tabs, one sandbox order, controlled rotation and no script-readable cookie (mobile/desktop)')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
