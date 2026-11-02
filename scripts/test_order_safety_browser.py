#!/usr/bin/env python3
"""Real browser regression: private tracking, safe payment result and DOM escaping."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='order-safety-browser-') as td:
 db=str(Path(td)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_PASSWORD':'Browser-Order-Owner-837'}
 proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE);base=f'http://127.0.0.1:{port}'
 def post(path,data):
  req=urllib.request.Request(base+path,data=json.dumps(data).encode(),headers={'Content-Type':'application/json'},method='POST')
  with urllib.request.urlopen(req,timeout=5) as r:return json.load(r)
 try:
  for _ in range(200):
   if proc.poll() is not None:raise RuntimeError(proc.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server not ready')
  c=sqlite3.connect(db);sku=c.execute("select v.sku from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=10 and v.price_toman>0 limit 1").fetchone()[0];c.close()
  mobile='09120001111';body={'customer_name':'Browser Test','mobile':mobile,'items':[{'sku':sku,'quantity':1}]}
  paid=post('/api/orders',body)['order_id'];pending=post('/api/orders',body)['order_id'];post('/api/payment/verify',{'order_id':paid,'result':'success'})
  c=sqlite3.connect(db);c.execute("update orders set status='VERIFYING',tracking_code=?,carrier=? where order_id=?",("x');window.__attack=1;//",'<svg onload=window.__attack=2>',pending));c.execute("update order_items set product_name=? where order_id=?",('<img src=x onerror=window.__attack=3>',pending));c.commit();c.close()
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width in [390,1440]:
    c=sqlite3.connect(db);c.execute("delete from rate_limits where bucket like 'track-%'");c.commit();c.close()
    page=browser.new_page(viewport={'width':width,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    page.goto(base+'/track',wait_until='domcontentloaded');expect(page.locator('#orderId')).to_be_visible();page.locator('#m').fill(mobile);page.get_by_role('button',name='مشاهده سفارش',exact=True).click();expect(page.locator('.toast')).to_contain_text('شماره سفارش');assert page.locator('#out .order-card').count()==0
    page.locator('#orderId').fill(pending);page.get_by_role('button',name='مشاهده سفارش',exact=True).click();expect(page.locator('#out .order-card')).to_have_count(1);expect(page.locator('#out')).to_contain_text('در حال بررسی پرداخت');expect(page.locator('#out')).to_contain_text('<img src=x onerror=window.__attack=3>');assert page.locator('#out img').count()==0 and page.evaluate('window.__attack || 0')==0
    page.evaluate("Object.defineProperty(navigator,'clipboard',{value:{writeText:()=>Promise.resolve()},configurable:true})");page.locator('.track-box button').click();assert page.evaluate('window.__attack || 0')==0
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),('track overflow',width)
    # URL flags, untrusted msg and ref cannot assert success or delete the basket.
    page.evaluate("v=>{sessionStorage.setItem('yazd_last_mobile',v.mobile);sessionStorage.setItem('yazd_last_order',v.oid);localStorage.setItem('yazd_cart_v1',JSON.stringify([{sku:'TEST',quantity:1}]))}",{'mobile':mobile,'oid':pending})
    payload=urllib.parse.quote('<svg onload=window.__attack=9>')
    page.goto(base+f'/payment/result?order={pending}&ok=1&msg={payload}&ref={payload}',wait_until='domcontentloaded');expect(page.locator('#card')).to_contain_text('در حال بررسی');assert page.evaluate('JSON.parse(localStorage.getItem("yazd_cart_v1")||"[]").length')==1 and page.evaluate('window.__attack || 0')==0;assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),('result overflow',width)
    # A paid older order can be displayed, but must not clear the newer basket.
    page.goto(base+f'/payment/result?order={paid}&ok=0',wait_until='domcontentloaded');expect(page.locator('#card')).to_contain_text('پرداخت با موفقیت');assert page.evaluate('JSON.parse(localStorage.getItem("yazd_cart_v1")||"[]").length')==1
    page.evaluate('x=>sessionStorage.setItem("yazd_last_order",x)',paid);page.reload(wait_until='domcontentloaded');expect(page.locator('#card')).to_contain_text('پرداخت با موفقیت');assert page.evaluate('JSON.parse(localStorage.getItem("yazd_cart_v1")||"[]").length')==0
    attack=urllib.parse.quote('<img src=x onerror=window.__attack=7>');page.goto(base+f'/payment/sandbox?order={attack}',wait_until='domcontentloaded');assert page.locator('#gate img').count()==0 and page.evaluate('window.__attack || 0')==0
    assert not errors,errors;page.close()
   browser.close()
  print('PASS browser mobile/desktop: private tracking, escaped content, server-confirmed payment and cart preservation')
 finally:proc.terminate();proc.wait(timeout=10)
