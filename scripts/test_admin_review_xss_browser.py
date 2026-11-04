#!/usr/bin/env python3
"""Admin review replies and invitation URLs remain inert and usable in Chromium."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
payload='<img src=x onerror="window.__xss=1">'
valid='/review/'+'a'*32
malicious="/review/a');window.__xss=2;//"
with tempfile.TemporaryDirectory(prefix='admin-review-xss-') as td:
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(Path(td)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Review-Xss-Owner-982'}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server not ready')
  with sqlite3.connect(env['DB_PATH']) as c:
   c.execute("insert into staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active) select 'support','Support','support',pass_hash,pass_salt,0,1 from staff where username='owner'");c.commit()
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    review={'id':1,'brand_fa':'برند','name_fa':'محصول','display_name':'مشتری','verified':0,'rating':5,'title':'نظر','body':'متن','admin_reply':payload+'\nخط دوم','created_at':'2026-11-04T00:00:00Z'}
    page.route('**/api/admin/reviews?*',lambda r:r.fulfill(json={'reviews':[review],'counts':{'PENDING':1}}))
    invites=[{'id':1,'brand_fa':'معتبر','name_fa':'محصول','mobile':'09120001111','state':'OPEN','url':valid,'created_at':'2026-11-04T00:00:00Z'},
      {'id':2,'brand_fa':'نامعتبر','name_fa':'محصول','mobile':'09120002222','state':'OPEN','url':malicious,'created_at':'2026-11-04T00:00:00Z'}]
    post={'count':0}
    def invite_route(route):
     if route.request.method=='GET':return route.fulfill(json={'invites':invites})
     post['count']+=1;return route.fulfill(status=201,json={'url':valid if post['count']==1 else malicious,'message':'ثبت شد','sms_text':'متن نمونه'})
    page.route('**/api/admin/review-invites',invite_route)
    roleKey="x');window.__xss=3;//";groupKey='group"] .other'
    page.route('**/api/admin/roles',lambda r:r.fulfill(json={'roles':[{'key':roleKey,'name':'نقش آزمون','description':payload,'permissions':[],'staff_count':0,'builtin':False,'locked':False}]}))
    page.route('**/api/admin/permissions',lambda r:r.fulfill(json={'groups':[{'key':groupKey,'label':'گروه آزمون','items':[{'key':'orders.view','label':'نمایش','danger':False}]}]}))
    roleRequests=[]
    def role_update(route):roleRequests.append(route.request.url);route.fulfill(status=200,json={'message':'ثبت شد'})
    page.route('**/api/admin/roles/*',role_update)
    page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Review-Xss-Owner-982');page.locator('#loginView button').click();expect(page.locator('#panel')).to_be_visible()
    expect(page.locator('#health')).to_contain_text('فعال')
    page.locator('.tab[data-t="reviews"]').click();expect(page.locator('#reviewsList')).to_contain_text(payload);expect(page.locator('#reviewsList')).to_contain_text('خط دوم')
    assert page.locator('#reviewsList img, #reviewsList script').count()==0
    expect(page.locator('#ivList')).to_contain_text('نامعتبر')
    good=page.locator('#ivList tr').filter(has_text='معتبر').filter(has_not_text='نامعتبر');bad=page.locator('#ivList tr').filter(has_text='نامعتبر')
    assert good.get_by_role('button',name='کپی',exact=True).count()==1 and bad.get_by_role('button',name='کپی',exact=True).count()==0
    page.evaluate('window.ivCopy = value => { window.__copiedInvite = value }');good.get_by_role('button',name='کپی',exact=True).click();assert page.evaluate('window.__copiedInvite')==base+valid
    page.locator('#ivProduct').fill('product');page.locator('#ivMobile').fill('09120001111');page.get_by_role('button',name='ساخت دعوت‌نامه').click()
    expect(page.locator('#ivResult')).to_contain_text('ثبت شد');assert page.locator('#ivResult a').get_attribute('href')==base+valid
    page.locator('#ivResult').get_by_role('button',name='کپی لینک').click();assert page.evaluate('window.__copiedInvite')==base+valid
    page.locator('#ivMobile').fill('09120001111');page.get_by_role('button',name='ساخت دعوت‌نامه').click();expect(page.locator('#ivResult')).to_have_text('نشانی دعوت‌نامه معتبر نیست.')
    assert page.locator('#ivResult a, #ivResult button').count()==0 and page.evaluate('window.__xss || 0')==0
    page.locator('.tab[data-t="staff"]').click();expect(page.locator('#rolesList')).to_contain_text(payload)
    assert page.locator('#rolesList img').count()==0
    page.locator('#rolesList').get_by_role('button',name='ویرایش اجازه‌ها').click();expect(page.locator('#roleForm')).to_be_visible()
    page.locator('#roleForm').get_by_role('button',name='انتخاب همه').click();assert page.locator('#roleForm .perm-box').is_checked()
    page.locator('#roleForm').get_by_role('button',name='ذخیره اجازه‌ها').click();page.wait_for_function('()=>document.getElementById("roleForm").classList.contains("hidden")')
    encoded=page.evaluate('(x)=>encodeURIComponent(x)',roleKey);assert roleRequests and roleRequests[0].endswith('/api/admin/roles/'+encoded),roleRequests
    assert page.evaluate('window.__xss || 0')==0
    assert not errors,errors;context.close()
    # A support role cannot fetch the private operational health data.
    restricted=browser.new_context(viewport={'width':width,'height':844},service_workers='block');other=restricted.new_page();healthRequests=[]
    other.on('request',lambda r: healthRequests.append(r.url) if r.url.endswith('/api/admin/health') else None)
    other.goto(base+'/admin',wait_until='domcontentloaded');other.locator('#usr').fill('support');other.locator('#pw').fill('Review-Xss-Owner-982');other.locator('#loginView button').click();expect(other.locator('#panel')).to_be_visible()
    expect(other.locator('#health')).to_have_text('برای مشاهده وضعیت سیستم، مجوز لازم است.');assert not healthRequests
    restricted.close()
   browser.close()
  print('PASS admin review replies, invitation URLs and role actions escaped; normal controls preserved; mobile/desktop Chromium')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
