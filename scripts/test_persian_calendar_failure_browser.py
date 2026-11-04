#!/usr/bin/env python3
"""Calendar asset failure: unrelated admin/invoice work, dates fail closed."""
import os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='calendar-failure-') as td:
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(Path(td)/'shop.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Calendar-Failure-982'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  fixture={'order':{'order_id':'SAFE-1','created_at':'2026-11-04T00:00:00Z','status':'PAID','customer_name':'نام نمونه','mobile':'09120001111','province':'یزد','city':'یزد','address':'نشانی نمونه','postal_code':'8916100000'},'items':[{'product_name':'محصول','sku':'SKU','quantity':1,'unit_price':100,'line_total':100}],'settings':{'shop_name':'فروشگاه','address':'نشانی','phone':'035'},'totals':{'subtotal':100,'campaign':0,'coupon':0,'shipping':0,'gift_wrap':0,'grand_total':100},'invoice_no':'123'}
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width,blocked in [(390,'jalaali-core.js'),(1440,'persian-date.js')]:
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];posts=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/assets/'+blocked,lambda r:r.fulfill(status=503,body='unavailable'))
    def coupons(route):
     if route.request.method=='POST':posts.append(True);return route.fulfill(status=500,json={'error':'must not submit'})
     route.continue_()
    page.route('**/api/admin/coupons',coupons);page.route('**/api/orders/*/invoice',lambda r:r.fulfill(status=200,json=fixture))
    page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Calendar-Failure-982');page.locator('#loginView button').click();expect(page.locator('#panel')).to_be_visible()
    assert page.evaluate('YazdDate.ready') is False;expect(page.locator('#adminToday')).to_have_text('—')
    page.locator('.tab[data-t="coupons"]').click();expect(page.locator('#cExp')).to_be_disabled();page.locator('#cCode').fill('SHOULD-NOT-SEND');page.locator('#cValue').fill('10');page.get_by_role('button',name='ایجاد کد تخفیف').click()
    expect(page.locator('.toast')).to_contain_text('تقویم در دسترس نیست');assert not posts
    page.goto(base+'/invoice?order=SAFE-1',wait_until='domcontentloaded');expect(page.locator('#sheet')).to_contain_text('نام نمونه');expect(page.locator('#sheet')).to_contain_text('تاریخ: —')
    page.goto(base+'/label?order=SAFE-1',wait_until='domcontentloaded');expect(page.locator('#label')).to_contain_text('نام نمونه');expect(page.locator('#label')).to_contain_text('—')
    assert not errors,errors;context.close()
   browser.close()
  print('PASS calendar dependency failures: admin remains usable, scheduling blocked and invoice/label render without guessed dates')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
