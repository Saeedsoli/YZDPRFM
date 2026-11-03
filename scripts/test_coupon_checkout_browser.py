#!/usr/bin/env python3
"""Checkout passes the customer session for restricted coupons; mocked APIs only."""
import json,os,socket,subprocess,tempfile,time,urllib.request,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='coupon-checkout-browser-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server startup timed out')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();sent=[];errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    item={'sku':'TEST-SKU','name':'رایحه آزمون','price':100000,'quantity':1,'image':'/images/products/variant-sample.jpg'}
    page.add_init_script("localStorage.setItem('yazd_customer_token','verified-fixture');localStorage.setItem('yazd_cart_v1',"+json.dumps(json.dumps([item],ensure_ascii=False))+");localStorage.setItem('yazd_coupon','MINE-TEST');")
    def route(r):
     u=urllib.parse.urlsplit(r.request.url)
     if u.netloc!=f'127.0.0.1:{port}':return r.abort()
     if u.path=='/api/auth/me':return r.fulfill(status=200,content_type='application/json',body='{"authenticated":true,"mobile":"09120001111"}')
     if u.path=='/api/auth/orders':return r.fulfill(status=200,content_type='application/json',body='{"orders":[]}')
     if u.path=='/api/cart/calculate':return r.fulfill(status=200,content_type='application/json',body='{"discount":1000,"campaign_discount":0,"campaign_lines":[],"shipping_fee":100000,"shipping_label":"ارسال","gift_wrap_fee":0,"total_payable":199000}')
     if u.path=='/api/orders' and r.request.method=='POST':
      sent.append({'headers':r.request.headers,'body':json.loads(r.request.post_data)});return r.fulfill(status=400,content_type='application/json',body='{"error":"آزمون پرداخت"}')
     return r.continue_()
    page.route('**/*',route);page.goto(base+'/checkout',wait_until='domcontentloaded');expect(page.locator('#fMobile')).to_have_value('09120001111');expect(page.locator('#fMobile')).to_have_attribute('readonly','')
    page.locator('#fFirst').fill('مریم');page.locator('#fLast').fill('احمدی');page.locator('#fProvince').select_option(label='یزد');page.locator('#fCity').fill('یزد');page.locator('#fAddress').fill('خیابان نمونه کوچه نمونه پلاک ۱۲');page.locator('#fPostal').fill('8916100000')
    expect(page.locator('#payBtn')).to_be_enabled();page.locator('#payBtn').click();expect(page.locator('#err')).to_have_text('آزمون پرداخت')
    assert len(sent)==1 and sent[0]['headers'].get('x-customer-token')=='verified-fixture' and sent[0]['body']['coupon_code']=='MINE-TEST' and sent[0]['body']['mobile']=='09120001111',sent
    assert not errors,errors;context.close()
   browser.close()
  print('PASS checkout sends verified customer token and coupon on mobile/desktop; mock payment only')
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
