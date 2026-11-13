#!/usr/bin/env python3
"""HttpOnly administrator session, invoice/label and logout in real Chromium."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='admin-cookie-browser-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Cookie-Test-Owner-981','TRUSTED_PROXY_CIDRS':'','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  with sqlite3.connect(db) as c:
   sku=c.execute('select sku from variants limit 1').fetchone()[0]
   c.execute("insert into orders(order_id,created_at,customer_name,mobile,province,city,address,postal_code,subtotal,shipping_fee,total_paid,status) values('FIXTURE-ORDER','2026-01-01','نام نمونه','09120001111','یزد','یزد','نشانی آزمایشی','8916100000',1000,0,1000,'PAID')")
   c.execute("insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values('FIXTURE-ORDER',?,'رایحه نمونه',1000,1,1000)",(sku,))
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block',accept_downloads=True);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(base) else r.abort())
    page.goto(base+'/',wait_until='domcontentloaded');page.evaluate("localStorage.setItem('yazd_admin_token','legacy-fixture-token')")
    page.goto(base+'/admin',wait_until='domcontentloaded');expect(page.locator('#loginView')).to_be_visible()
    assert page.evaluate("localStorage.getItem('yazd_admin_token')") is None
    page.locator('#usr').fill('owner');page.locator('#pw').fill('Cookie-Test-Owner-981')
    with page.expect_response(lambda r:r.url.endswith('/api/admin/login') and r.request.method=='POST') as login_response:
     page.locator('#loginView button').click()
    assert login_response.value.status==200 and 'token' not in login_response.value.json()
    expect(page.locator('#panel')).to_be_visible()
    cookies=[c for c in context.cookies() if c['name']=='yazd_admin'];assert len(cookies)==1 and cookies[0]['httpOnly'] and cookies[0]['sameSite']=='Lax'
    assert page.evaluate("localStorage.getItem('yazd_admin_token')") is None and 'yazd_admin=' not in page.evaluate('document.cookie')
    who=page.evaluate("async()=>{const r=await fetch('/api/admin/whoami');return {status:r.status,cache:r.headers.get('cache-control')}}");assert who=={'status':200,'cache':'no-store'}
    page.evaluate("localStorage.setItem('yazd_admin_token','stale-legacy-token')")
    page.reload(wait_until='domcontentloaded');expect(page.locator('#panel')).to_be_visible();assert page.evaluate("localStorage.getItem('yazd_admin_token')") is None
    page.locator('.tab[data-t="settings"]').click();page.locator('button[data-csp-click="loadReadiness(false)"]').click()
    expect(page.locator('#readyList')).to_contain_text('آدرس IP و پروکسی');expect(page.locator('#readyList')).to_contain_text('پروکسی مورد اعتماد تنظیم نشده')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    page.locator('.tab[data-t="reports"]').click()
    with page.expect_download() as download_event:page.locator('#tab-reports button[data-csp-click="downloadReport()"]').click()
    download=download_event.value;assert download.suggested_filename.endswith('.csv') and Path(download.path()).read_bytes().startswith(b'\xef\xbb\xbf')
    page.goto(base+'/invoice?order=FIXTURE-ORDER',wait_until='domcontentloaded');expect(page.locator('#sheet')).to_contain_text('نام نمونه')
    page.goto(base+'/label?order=FIXTURE-ORDER',wait_until='domcontentloaded');expect(page.locator('#label')).to_contain_text('نام نمونه')
    page.goto(base+'/admin',wait_until='domcontentloaded');expect(page.locator('#panel')).to_be_visible();page.locator('button[data-csp-click="logout()"]').click();expect(page.locator('#loginView')).to_be_visible()
    assert not any(c['name']=='yazd_admin' for c in context.cookies())
    # Errors from the invoice API must remain literal text, not executable HTML.
    payload='<img src=x onerror="window.__invoiceXss=1">';requests=[]
    def fake_invoice(route):
     requests.append(route.request.url);route.fulfill(status=403,content_type='application/json',body=json.dumps({'error':payload}))
    page.route('**/api/orders/*/invoice',fake_invoice)
    for screen,selector in [('invoice','#sheet'),('label','#label')]:
     page.goto(base+'/'+screen+'?order=foo%2Fbar',wait_until='domcontentloaded');expect(page.locator(selector)).to_contain_text(payload)
     assert page.locator(selector+' img, '+selector+' script').count()==0 and page.evaluate('window.__invoiceXss || 0')==0
    assert len(requests)==2 and all('foo%2Fbar' in url for url in requests)
    assert not errors,errors;context.close()
   # A browser that cannot establish the session must not see a false login.
   context=browser.new_context(service_workers='block');page=context.new_page()
   page.route('**/api/admin/whoami',lambda r:r.fulfill(status=401,content_type='application/json',body='{"error":"no session"}'))
   page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Cookie-Test-Owner-981');page.locator('#loginView button').click()
   expect(page.locator('#loginErr')).to_contain_text('نشست مدیریت برقرار نشد');expect(page.locator('#panel')).to_be_hidden();context.close()
   browser.close()
  # Non-browser integrations retain explicit Bearer compatibility.
  req=urllib.request.Request(base+'/api/admin/login',data=json.dumps({'username':'owner','password':'Cookie-Test-Owner-981'}).encode(),headers={'Content-Type':'application/json'},method='POST')
  with urllib.request.urlopen(req,timeout=10) as r:token=json.load(r)['token']
  req=urllib.request.Request(base+'/api/admin/whoami',headers={'Authorization':'Bearer '+token})
  with urllib.request.urlopen(req,timeout=10) as r:assert r.status==200
  print('PASS admin HttpOnly cookie, reload, invoice/label, logout and Bearer API compatibility on mobile/desktop')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
