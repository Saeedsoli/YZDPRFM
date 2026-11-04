#!/usr/bin/env python3
"""Staged admin delivery evidence: actual form, Tehran conversion and role gate."""
import datetime,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

def select_jalali(page,field,iso):
    jalali=page.evaluate('(iso)=>YazdDate.toPersian(iso)',iso)
    field.click();expect(page.locator('.jalali-picker')).to_be_visible()
    page.locator('.jalali-year').select_option(str(jalali['year']))
    page.locator('.jalali-month').select_option(str(jalali['month']))
    page.locator('.jalali-day[data-iso="'+iso+'"]').click()
    assert page.evaluate('(el)=>YazdDate.inputISO(el)',field.element_handle())==iso
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='return-delivery-browser-') as td:
 db=str(Path(td)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','RETURNS_API_TEST_ONLY':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Delivery-Test-Owner-982'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:
   for oid in ('DELIVERY-MOBILE','DELIVERY-DESKTOP'):
    c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values(?,'2023-01-01T00:00:00.000Z','Test','09120001111',100,0,100,'DELIVERED')",(oid,))
   c.commit()
  local=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3,minutes=30)))-datetime.timedelta(minutes=3)
  date=local.strftime('%Y-%m-%d');clock=local.strftime('%H:%M');expected=int(datetime.datetime.strptime(date+' '+clock,'%Y-%m-%d %H:%M').replace(tzinfo=datetime.timezone(datetime.timedelta(hours=3,minutes=30))).timestamp()*1000)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width,oid in [(390,'DELIVERY-MOBILE'),(1440,'DELIVERY-DESKTOP')]:
    context=browser.new_context(viewport={'width':width,'height':844},timezone_id='America/New_York',service_workers='block');page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Delivery-Test-Owner-982');page.locator('#loginView button').click();expect(page.locator('#panel')).to_be_visible()
    button=page.locator(f'[data-delivery-toggle="{oid}"]');expect(button).to_be_visible();button.click()
    form=page.locator(f'[data-delivery-form="{oid}"]');expect(form).to_be_visible();assert 'تهران' not in form.inner_text();expect(form).to_contain_text('حدس نزنید')
    select_jalali(page,form.locator('[name=date]'),date);form.locator('[name=time]').fill(clock)
    with page.expect_response(lambda r:r.url.endswith('/api/admin/account-returns/delivery') and r.request.method=='POST') as event:form.locator('[type=submit]').click()
    assert event.value.status==201,event.value.text()
    expect(page.locator(f'[data-delivery-toggle="{oid}"]')).to_have_count(0)
    with sqlite3.connect(db) as c:assert c.execute('select delivered_at_ms,recorded_by from return_delivery_evidence where order_id=?',(oid,)).fetchone()==(expected,'owner')
    assert page.evaluate("tehranDeliveryMs('2026-02-31','10:30')") is None
    assert page.evaluate("tehranDeliveryMs('2022-01-01','10:30')") is None
    assert page.evaluate("tehranDeliveryMs('2026-11-04','10:30')")==int(datetime.datetime(2026,11,4,10,30,tzinfo=datetime.timezone(datetime.timedelta(hours=3,minutes=30))).timestamp()*1000)
    assert not errors,errors;context.close()
   browser.close()
  print('PASS staged admin delivery form and Tehran time conversion independent of browser timezone, mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
