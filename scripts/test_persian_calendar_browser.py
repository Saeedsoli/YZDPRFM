#!/usr/bin/env python3
"""Admin Jalali picker, server-synced today and ISO API contract in Chromium."""
import datetime,json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='jalali-admin-browser-') as td:
 db=str(Path(td)/'shop.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Calendar-Owner-982'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  before=int(datetime.datetime(2026,11,3,20,29,45,tzinfo=datetime.timezone.utc).timestamp()*1000)
  after=int(datetime.datetime(2026,11,3,20,30,15,tzinfo=datetime.timezone.utc).timestamp()*1000)
  expected=json.loads(subprocess.check_output(['node','-e',"const d=require('./public/assets/persian-date');let x=[];for(let y=1200;y<=1600;y++)for(const [m,k] of [[1,1],[12,29],[12,30]])x.push(d.toISO(y,m,k));console.log(JSON.stringify(x))"],cwd=root,env=env,text=True))
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width,tz in [(390,'America/New_York'),(1440,'Pacific/Auckland')]:
    context=browser.new_context(viewport={'width':width,'height':844},timezone_id=tz,service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    clock={'now':before,'calls':0}
    def clock_route(route):clock['calls']+=1;route.fulfill(status=200,json={'now_ms':clock['now']},headers={'Cache-Control':'no-store'})
    page.route('**/api/admin/clock',clock_route)
    page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Calendar-Owner-982');page.locator('#loginView button').click();expect(page.locator('#panel')).to_be_visible()
    expect(page.locator('#adminToday')).to_have_text('۱۲ / ۰۸ / ۱۴۰۵');assert 'تهران' not in page.locator('.admin-top').inner_text()
    clock['now']=after;page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    expect(page.locator('#adminToday')).to_have_text('۱۳ / ۰۸ / ۱۴۰۵');assert clock['calls']>=2
    browserDates=page.evaluate("()=>{const x=[];for(let y=1200;y<=1600;y++)for(const [m,k] of [[1,1],[12,29],[12,30]])x.push(YazdDate.toISO(y,m,k));return x}");assert browserDates==expected,[(1200+i//3,i%3,browserDates[i],expected[i]) for i in range(len(expected)) if browserDates[i]!=expected[i]][:15]
    page.locator('.tab[data-t="coupons"]').click();assert page.locator('input[type=date]').count()==0
    page.locator('#tab-coupons details.scope-box summary').first.click()
    def choose(field,y,m,d,iso):
     page.locator(field).click();expect(page.locator('.jalali-picker')).to_be_visible()
     page.locator('.jalali-year').select_option(str(y));page.locator('.jalali-month').select_option(str(m))
     page.locator('.jalali-day[data-iso="'+iso+'"]').click();assert page.evaluate('(el)=>YazdDate.inputISO(el)',page.locator(field).element_handle())==iso
    choose('#cStart',1403,12,30,'2025-03-20');expect(page.locator('#cStart')).to_have_value('۳۰ / ۱۲ / ۱۴۰۳')
    choose('#cExp',1404,1,1,'2025-03-21');expect(page.locator('#cExp')).to_have_value('۰۱ / ۰۱ / ۱۴۰۴')
    page.locator('#cCode').fill('CAL'+str(width));page.locator('#cValue').fill('10')
    with page.expect_response(lambda r:r.url.endswith('/api/admin/coupons') and r.request.method=='POST') as event:page.get_by_role('button',name='ایجاد کد تخفیف').click()
    assert event.value.status==201,event.value.text()
    with sqlite3.connect(db) as c:assert c.execute('select starts_at,expires_at from coupons where code=?',('CAL'+str(width),)).fetchone()==('2025-03-20','2025-03-21')
    expect(page.locator('#cStart')).to_have_value('');assert page.evaluate("YazdDate.inputISO(document.getElementById('cStart'))") is None
    page.locator('#nStart').click();expect(page.locator('.jalali-picker')).to_be_visible();page.get_by_role('button',name='امروز',exact=True).click()
    expect(page.locator('#nStart')).to_have_value('۱۳ / ۰۸ / ۱۴۰۵');assert page.evaluate("YazdDate.inputISO(document.getElementById('nStart'))")=='2026-11-04'
    page.locator('#fStart').click();page.locator('.jalali-year').select_option('1404');page.locator('.jalali-month').select_option('12');assert page.locator('.jalali-day[data-iso="2026-03-21"]').count()==0
    assert page.get_by_role('button',name='۳۰ اسفند ۱۴۰۴').count()==0
    page.keyboard.press('Escape');assert page.locator('.jalali-picker').count()==0
    choose('#fStart',1403,12,30,'2025-03-20');choose('#fEnd',1404,1,1,'2025-03-21')
    page.locator('#fTitle').fill('CAL-CAMPAIGN-'+str(width));page.locator('#fPct').fill('10');page.once('dialog',lambda dialog:dialog.accept())
    with page.expect_response(lambda r:r.url.endswith('/api/admin/campaigns') and r.request.method=='POST') as event:page.get_by_role('button',name='راه‌اندازی جشنواره').click()
    assert event.value.status==201,event.value.text();expect(page.locator('#campaignsTable')).to_contain_text('۳۰ / ۱۲ / ۱۴۰۳')
    with sqlite3.connect(db) as c:assert c.execute('select starts_at,ends_at from campaigns where title=?',('CAL-CAMPAIGN-'+str(width),)).fetchone()==('2025-03-20','2025-03-21')
    choose('#nEnd',1405,8,14,'2026-11-05');page.locator('#nText').fill('CAL-NOTICE-'+str(width))
    with page.expect_response(lambda r:r.url.endswith('/api/admin/notices') and r.request.method=='POST') as event:page.get_by_role('button',name='انتشار اعلان').click()
    assert event.value.status==201,event.value.text();expect(page.locator('#noticesTable')).to_contain_text('۱۳ / ۰۸ / ۱۴۰۵')
    with sqlite3.connect(db) as c:assert c.execute('select starts_at,ends_at from notices where text=?',('CAL-NOTICE-'+str(width),)).fetchone()==('2026-11-04','2026-11-05')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1') and not errors,errors
    page.route('**/api/contact-info',lambda route:route.fulfill(status=200,json={},headers={'Date':'Sat, 20 Mar 2027 20:31:00 GMT'}))
    page.goto(base+'/contact',wait_until='domcontentloaded');expect(page.locator('[data-footer-year]')).to_be_visible()
    assert page.evaluate("footerYear(Date.parse('2026-03-20T20:29:59Z'))")=='۱۴۰۴'
    assert page.evaluate("footerYear(Date.parse('2026-03-20T20:30:01Z'))")=='۱۴۰۵'
    expect(page.locator('[data-footer-year]')).to_have_text('۱۴۰۶',timeout=10000)
    assert page.locator('[data-footer-year]').inner_text()==page.evaluate('footerYear()')
    assert not errors,errors;context.close()
   browser.close()
  print('PASS Jalali admin date picker, today, leap year, server-synced midnight, ISO persistence and mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
