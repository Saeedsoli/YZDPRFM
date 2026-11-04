#!/usr/bin/env python3
"""Real admin UI, manual review, customer new attempt and delivery correction."""
import datetime,os,re,socket,sqlite3,subprocess,tempfile,time,urllib.request
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
with tempfile.TemporaryDirectory(prefix='recon-browser-') as td:
 db=str(Path(td)/'shop.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'PAYMENT_GATEWAY':'sandbox','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Browser-Recon-Owner-982','RL_ORDER_LIMIT':'1000'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 def fill(pg,phone):
  expect(pg.locator('#payBtn')).to_be_visible();pg.locator('#fFirst').fill('مریم');pg.locator('#fLast').fill('احمدی');pg.locator('#fMobile').fill(phone)
  pg.locator('#fProvince').select_option(label='یزد');pg.locator('#fCity').fill('یزد');pg.locator('#fAddress').fill('خیابان نمونه کوچه نمونه پلاک ۱۲');pg.locator('#fPostal').fill('8916100000');expect(pg.locator('#payBtn')).to_be_enabled()
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(db) as c:sku,name,price=c.execute("select v.sku,p.name_fa,v.price_toman from variants v join products p on p.id=v.product_id where p.supply_mode='MADE_TO_ORDER' and v.type='EDP' and v.volume_ml=30 and v.price_toman>0 limit 1").fetchone()
  item={'sku':sku,'name':name,'price':price,'quantity':1,'image':'/images/products/variant-sample.jpg'}
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for index,width in enumerate((390,1440),1):
    phone=f'0912000666{index}';buyer=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=buyer.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/contact',wait_until='domcontentloaded');page.evaluate("x=>localStorage.setItem('yazd_cart_v1',JSON.stringify([x]))",item)
    page.goto(base+'/checkout',wait_until='domcontentloaded');fill(page,phone);page.locator('#payBtn').click();expect(page).to_have_url(re.compile(r'/payment/sandbox\?order='),timeout=15000)
    oid=page.evaluate("new URL(location.href).searchParams.get('order')")
    page.get_by_role('button',name='انصراف از پرداخت').click();expect(page.locator('#gate')).to_contain_text('سفارش لغو')
    page.goto(base+'/checkout',wait_until='domcontentloaded');fill(page,phone);page.locator('#payBtn').click();expect(page.locator('#attemptNotice')).to_contain_text('سفارش قبلی در حال بررسی')
    now=int(time.time()*1000);old=now-7200000;deliv=f'DELIVERY-{index}'
    with sqlite3.connect(db) as c:
     created=datetime.datetime.fromtimestamp((now-86400000)/1000,datetime.timezone.utc).isoformat()
     c.execute("insert into orders(order_id,created_at,customer_name,mobile,subtotal,shipping_fee,total_paid,status) values(?,?,'Test','09120007777',100,0,100,'DELIVERED')",(deliv,created))
     id=c.execute('insert into order_items(order_id,sku,product_name,unit_price,quantity,line_total) values(?,?,?,100,1,100)',(deliv,sku,'Actual')).lastrowid
     c.execute('insert into return_item_evidence values(?,30)',(id,));c.execute('insert into return_delivery_evidence values(?,?,?,?)',(deliv,old,now,'owner'))
     c.execute("insert into account_return_requests values(?,?,?,1,'valid explanation',1,?,'NEW_PENDING')",(f'RET-{index}',id,'09120007777',now));c.commit()
    staff=browser.new_context(viewport={'width':width,'height':844},service_workers='block');admin=staff.new_page();admin.on('pageerror',lambda e:errors.append(str(e)))
    admin.goto(base+'/admin',wait_until='domcontentloaded');admin.locator('#usr').fill('owner');admin.locator('#pw').fill('Browser-Recon-Owner-982');admin.locator('#loginView button').click();expect(admin.locator('#panel')).to_be_visible()
    review=admin.locator(f'[data-review-toggle="{oid}"]')
    expect(review).to_be_visible();review.click();form=admin.locator(f'[data-review-form="{oid}"]');expect(form).to_be_visible();expect(form).to_contain_text('وضعیت پرداخت را تغییر نمی‌دهد')
    form.locator('[name=evidence]').fill('درگاه بررسی شد و پیوند پیشین به صورت قطعی غیرفعال است');form.locator('[name=confirmed]').check()
    with admin.expect_response(lambda r:r.url.endswith('/api/admin/reconciliation/payment-review') and r.request.method=='POST') as response:form.locator('[type=submit]').click()
    assert response.value.status==201,response.value.text();expect(admin.locator(f'[data-review-toggle="{oid}"]')).to_have_count(0)
    with sqlite3.connect(db) as c:
     assert c.execute('select status from orders where order_id=?',(oid,)).fetchone()[0]=='CANCELLED'
     assert c.execute('select reviewed_by from order_attempt_reviews where order_id=?',(oid,)).fetchone()[0]=='owner'
    # A reviewed outcome lets the customer explicitly start a fresh attempt.
    page.locator('#payBtn').click();expect(page.locator('#attemptNotice')).to_contain_text('سفارش قبلی بررسی شد');page.locator('[data-attempt-new]').click();expect(page.locator('#attemptNotice')).to_be_hidden();expect(page.locator('#payBtn')).to_be_enabled()
    page.locator('#payBtn').click();expect(page).to_have_url(re.compile(r'/payment/sandbox\?order='),timeout=15000);assert page.evaluate("new URL(location.href).searchParams.get('order')")!=oid
    # Correct an independently entered delivery time with an audit note.
    correction=admin.locator(f'[data-correction-toggle="{deliv}"]');expect(correction).to_be_visible();correction.click();f=admin.locator(f'[data-correction-form="{deliv}"]');expect(f).to_be_visible()
    local=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=3,minutes=30)))-datetime.timedelta(minutes=45)
    date=local.strftime('%Y-%m-%d');clock=local.strftime('%H:%M');expected=int(datetime.datetime.strptime(date+' '+clock,'%Y-%m-%d %H:%M').replace(tzinfo=datetime.timezone(datetime.timedelta(hours=3,minutes=30))).timestamp()*1000)
    select_jalali(admin,f.locator('[name=date]'),date);f.locator('[name=time]').fill(clock);f.locator('[name=evidence]').fill('زمان تحویل از رسید شرکت پستی بررسی شد')
    with admin.expect_response(lambda r:r.url.endswith('/api/admin/reconciliation/delivery-correction') and r.request.method=='POST') as response:f.locator('[type=submit]').click()
    assert response.value.status==201,response.value.text()
    with sqlite3.connect(db) as c:
     assert c.execute('select delivered_at_ms from return_delivery_evidence where order_id=?',(deliv,)).fetchone()[0]==expected
     assert c.execute('select old_delivered_at_ms,new_delivered_at_ms,corrected_by from return_delivery_corrections where order_id=?',(deliv,)).fetchone()==(old,expected,'owner')
     assert c.execute('select count(*) from account_return_requests where request_id=?',(f'RET-{index}',)).fetchone()[0]==1
    assert not errors,errors;staff.close();buyer.close()
   browser.close()
  print('PASS mobile/desktop admin review and delivery correction, customer explicit new attempt, preserved return; sandbox only')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
