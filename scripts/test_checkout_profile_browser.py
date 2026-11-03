#!/usr/bin/env python3
"""Checkout prefill and slow-response protection with mocked profile data."""
import json,os,socket,subprocess,tempfile,time,urllib.request,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='checkout-profile-browser-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  profile={'customer_name':'مریم احمدی','first_name':'مریم','last_name':'احمدی','email':'fixture@example.test','province':'یزد','city':'یزد','address':'<img src=x onerror="window.__profileXss=1">','postal_code':'8916100000'}
  item={'sku':'TEST-SKU','name':'رایحه آزمون','price':100000,'quantity':1,'image':'/images/products/variant-sample.jpg'}
  init="""localStorage.setItem('yazd_cart_v1',CART);
  const originalFetch=window.fetch.bind(window);window.fetch=(u,o)=>{
   if(String(u)==='/api/auth/checkout-profile'){
    window.__profileHeaders=o.headers;return new Promise(resolve=>{window.__releaseProfile=()=>resolve(new Response(PROFILE,{status:200,headers:{'Content-Type':'application/json'}}))});
   }return originalFetch(u,o);
  };""".replace('CART',json.dumps(json.dumps([item],ensure_ascii=False))).replace('PROFILE',json.dumps(json.dumps({'profile':profile},ensure_ascii=False)))
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    for touched in (False,True):
     context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
     def route(r):
      u=urllib.parse.urlsplit(r.request.url)
      if u.netloc!=f'127.0.0.1:{port}':return r.abort()
      if u.path=='/api/auth/me':return r.fulfill(status=200,content_type='application/json',body='{"authenticated":true,"mobile":"09120001111"}')
      if u.path=='/api/cart/calculate':return r.fulfill(status=200,content_type='application/json',body='{"discount":0,"campaign_discount":0,"campaign_lines":[],"shipping_fee":100000,"shipping_label":"ارسال","gift_wrap_fee":0,"total_payable":200000}')
      return r.continue_()
     page.route('**/*',route);context.add_cookies([{'name':'yazd_customer','value':'c'*48,'url':base,'httpOnly':True,'sameSite':'Lax'}]);page.add_init_script(init);page.goto(base+'/checkout',wait_until='domcontentloaded');expect(page.locator('#fMobile')).to_have_value('09120001111')
     page.wait_for_function('typeof window.__releaseProfile === "function"')
     if touched:
      page.locator('#fFirst').fill('نام دلخواه');page.locator('#fCity').fill('تهران')
      page.locator('#fAddress').fill('نوشتن');page.locator('#fAddress').fill('');page.locator('#fPostal').focus()
     page.evaluate('window.__releaseProfile()')
     expect(page.locator('#fLast')).to_have_value('احمدی');expect(page.locator('#fProvince')).to_have_value('یزد')
     if touched:
      expect(page.locator('#fFirst')).to_have_value('نام دلخواه');expect(page.locator('#fCity')).to_have_value('تهران');expect(page.locator('#fAddress')).to_have_value('')
      # Focused fields are left alone too; the customer is interacting.
      expect(page.locator('#fPostal')).to_have_value('')
     else:
      expect(page.locator('#fFirst')).to_have_value('مریم');expect(page.locator('#fCity')).to_have_value('یزد');expect(page.locator('#fAddress')).to_have_value(profile['address']);expect(page.locator('#fPostal')).to_have_value('8916100000')
     assert page.evaluate("Object.keys(window.__profileHeaders).length") == 0
     assert any(c['name']=='yazd_customer' and c['httpOnly'] for c in context.cookies())
     assert page.evaluate('window.__profileXss || 0')==0 and not errors,errors
     assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
     context.close()
   browser.close()
  print('PASS checkout profile prefill, user edit/focus protection and literal text on mobile and desktop')
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
