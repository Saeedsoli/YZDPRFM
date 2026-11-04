#!/usr/bin/env python3
"""Two-tab checkout with real shared HttpOnly cookie; sandbox gateway only."""
import json,os,re,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='checkout-two-tabs-') as td:
 t=Path(td);db=t/'shop.sqlite';hook=t/'gateway.js';start=t/'start';go=t/'go';calls=t/'calls'
 hook.write_text('''const fs=require('fs'),pay=require('''+json.dumps(str(root/'src/payment.js'))+'''),original=pay.requestPayment;
pay.requestPayment=async (...args)=>{fs.appendFileSync(process.env.CALLS,'x');fs.writeFileSync(process.env.START,'x');while(!fs.existsSync(process.env.GO))await new Promise(r=>setTimeout(r,10));return original(...args)};''')
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PAYMENT_GATEWAY':'sandbox','RL_ORDER_LIMIT':'1000','PORT':str(port),'NODE_OPTIONS':'--require='+str(hook),'START':str(start),'GO':str(go),'CALLS':str(calls)}
 def boot():
  p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):return p
   except OSError:time.sleep(.05)
  raise RuntimeError('server not ready')
 def stop(p):
  if p.poll() is None:p.terminate();p.wait(timeout=10)
 def waitfile(file):
  for _ in range(500):
   if file.exists():return
   time.sleep(.01)
  raise RuntimeError('gateway not reached')
 def fill(page,mobile):
  expect(page.locator('#payBtn')).to_be_visible();page.locator('#fFirst').fill('مریم');page.locator('#fLast').fill('احمدی');page.locator('#fMobile').fill(mobile)
  page.locator('#fProvince').select_option(label='یزد');page.locator('#fCity').fill('یزد');page.locator('#fAddress').fill('خیابان نمونه کوچه نمونه پلاک ۱۲');page.locator('#fPostal').fill('8916100000');expect(page.locator('#payBtn')).to_be_enabled()
 def setcart(page,item):
  page.goto(base+'/contact',wait_until='domcontentloaded');page.evaluate("x=>localStorage.setItem('yazd_cart_v1',JSON.stringify([x]))",item)
 def order_count(phone):
  with sqlite3.connect(db) as c:return c.execute('select count(*) from orders where mobile=?',(phone,)).fetchone()[0]
 p=boot()
 try:
  with sqlite3.connect(db) as c:sku,name,price=c.execute("select v.sku,p.name_fa,v.price_toman from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()
  item={'sku':sku,'name':name,'price':price,'quantity':1,'image':'/images/products/variant-sample.jpg'}
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width,mobile in [(390,'09120001111'),(1440,'09120002222')]:
    start.unlink(missing_ok=True);go.unlink(missing_ok=True);before=len(calls.read_text()) if calls.exists() else 0
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');a=context.new_page();b=context.new_page();errors=[]
    for pg in (a,b):pg.on('pageerror',lambda e:errors.append(str(e)))
    setcart(a,item);a.goto(base+'/checkout',wait_until='domcontentloaded');b.goto(base+'/checkout',wait_until='domcontentloaded');fill(a,mobile);fill(b,mobile)
    assert a.evaluate('window.isSecureContext && !!navigator.locks')
    a.locator('#payBtn').click();waitfile(start);b.locator('#payBtn').click();expect(b.locator('#attemptNotice')).to_contain_text('در تب دیگری سفارش در حال ثبت است')
    assert order_count(mobile)==1 and len(calls.read_text())==before+1
    cookie=[x for x in context.cookies() if x['name']=='yazd_order_attempt'];assert len(cookie)==1 and cookie[0]['httpOnly'];assert cookie[0]['value'] not in a.evaluate('JSON.stringify(localStorage)')
    go.touch();expect(a).to_have_url(re.compile(r'/payment/sandbox\?order='),timeout=15000)
    oid=a.evaluate("new URL(location.href).searchParams.get('order')")
    # A different address in the second tab must not reuse the same attempt
    # for a different payload or silently create another order.
    b.locator('#fCity').fill('میبد');expect(b.locator('#payBtn')).to_be_enabled();b.locator('#payBtn').click()
    expect(b.locator('#attemptNotice')).to_contain_text('سفارش قبلی در حال بررسی است')
    assert order_count(mobile)==1 and len(calls.read_text())==before+1
    b.locator('#fCity').fill('یزد');expect(b.locator('#payBtn')).to_be_enabled();b.locator('#payBtn').click();expect(b).to_have_url(re.compile(r'/payment/sandbox\?order='),timeout=15000)
    assert b.evaluate("new URL(location.href).searchParams.get('order')")==oid and order_count(mobile)==1 and len(calls.read_text())==before+1
    paid=a.evaluate("""async id=>{const r=await fetch('/api/payment/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({order_id:id,result:'success'})});return r.status}""",oid);assert paid==200
    b.goto(base+'/checkout',wait_until='domcontentloaded');fill(b,mobile);b.locator('#payBtn').click();expect(b.locator('#attemptNotice')).to_contain_text('سفارش قبلی پرداخت شده است')
    assert order_count(mobile)==1 and len(calls.read_text())==before+1
    b.locator('[data-attempt-new]').click();expect(b.locator('#attemptNotice')).to_be_hidden();expect(b.locator('#payBtn')).to_be_enabled()
    b.locator('#payBtn').click();expect(b).to_have_url(re.compile(r'/payment/sandbox\?order='),timeout=15000)
    assert b.evaluate("new URL(location.href).searchParams.get('order')")!=oid and order_count(mobile)==2 and len(calls.read_text())==before+2
    assert not errors,errors;context.close()
   # Kill the origin after an order is committed but before the gateway
   # responds. After restart the same cookie must hold the buyer in review,
   # not silently create a second order or request another payment.
   start.unlink(missing_ok=True);go.unlink(missing_ok=True);before=len(calls.read_text())
   context=browser.new_context(viewport={'width':390,'height':844},service_workers='block');page=context.new_page()
   setcart(page,item);page.goto(base+'/checkout',wait_until='domcontentloaded');fill(page,'09120005555');page.locator('#payBtn').click();waitfile(start)
   assert order_count('09120005555')==1 and len(calls.read_text())==before+1
   stop(p);expect(page.locator('#attemptNotice')).to_contain_text('سفارش قبلی در حال بررسی است',timeout=15000)
   p=boot();page.goto(base+'/checkout',wait_until='domcontentloaded');fill(page,'09120005555');page.locator('#payBtn').click()
   expect(page.locator('#attemptNotice')).to_contain_text('سفارش قبلی در حال بررسی است');assert page.locator('[data-attempt-new]').count()==0
   assert order_count('09120005555')==1 and len(calls.read_text())==before+1;context.close()
   # A browser lacking the cross-tab lock must fail closed and never post an order.
   context=browser.new_context(viewport={'width':390,'height':844},service_workers='block');context.add_init_script("Object.defineProperty(Navigator.prototype,'locks',{get:()=>undefined})")
   page=context.new_page();setcart(page,item);page.goto(base+'/checkout',wait_until='domcontentloaded');fill(page,'09120003333');page.locator('#payBtn').click()
   expect(page.locator('#attemptNotice')).to_contain_text('امکان ثبت امن سفارش فراهم نیست');assert order_count('09120003333')==0;context.close()
   # If a browser refuses the HttpOnly cookie, status verification prevents POST.
   context=browser.new_context(viewport={'width':390,'height':844},service_workers='block');page=context.new_page();setcart(page,item)
   page.route('**/api/orders/attempt',lambda r:r.fulfill(status=201,json={'ready':True}))
   page.goto(base+'/checkout',wait_until='domcontentloaded');fill(page,'09120004444');page.locator('#payBtn').click()
   expect(page.locator('#attemptNotice')).to_contain_text('امکان ثبت امن سفارش فراهم نیست');assert order_count('09120004444')==0;context.close()
   browser.close()
  print('PASS checkout two-tab first-use lock, shared cookie replay, paid-only rotation, server-crash recovery and fail-closed browsers; sandbox gateway')
 finally:
  go.touch();stop(p)
