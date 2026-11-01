#!/usr/bin/env python3
"""Illustration disclosure and made-to-order UI on disposable data and browser."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
x={'product_id':'SUP-CH-900005','slug':'chanel-coco-edp','image_url':'/images/products/generic-neutral-6.jpg'}
with tempfile.TemporaryDirectory(prefix='yazd-generic-browser-') as td:
 db=str(Path(td)/'shop.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={'PATH':os.environ['PATH'],'HOME':os.environ.get('HOME','/tmp'),'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 base='http://127.0.0.1:'+str(port)
 try:
  for _ in range(200):
   if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1) as v:break
   except OSError:time.sleep(.1)
  else:raise RuntimeError('server did not start')
  with urllib.request.urlopen(base+'/api/products/'+x['slug']) as response:p=json.load(response)
  assert p['image_url']==x['image_url'] and p['supply_mode']=='MADE_TO_ORDER'
  con=sqlite3.connect(db);mobile='09120001234';token='c'*48;con.execute('insert into customers(mobile,first_name) values(?,?)',(mobile,'تست'));con.execute('insert into sessions(token,kind,subject,expires_at) values(?,?,?,?)',(token,'CUSTOMER',mobile,int(time.time()*1000)+600000));con.execute('insert into wishlist(mobile,product_id) values(?,?)',(mobile,x['product_id']));con.commit();con.close()
  with sync_playwright() as pw:
   executable=os.environ.get('CHROME_EXECUTABLE');browser=pw.chromium.launch(executable_path=executable or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    page=browser.new_page(viewport={'width':width,'height':844});errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.route('**/*',lambda route:route.continue_() if route.request.url.startswith(base) else route.abort())
    page.goto(base+'/',wait_until='domcontentloaded');expect(page.locator('.product-card').first).to_be_visible()
    card=page.evaluate("p => productCard(p)",{**p,'in_stock':False});assert 'تصویر نمادین' in card and '-sm.jpg' in card
    # Live search suggestions must describe made-to-order instead of unavailable.
    page.locator('#q').fill('کوکو');expect(page.locator('#sugg')).to_be_visible(timeout=7000)
    row=page.locator(f'#sugg a[href="/perfume/{x["slug"]}"]');expect(row).to_be_visible(timeout=7000);expect(row).to_contain_text('به سفارش');expect(row).to_contain_text('تصویر نمادین است')
    page.goto(base+'/perfume/'+x['slug'],wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible();expect(page.locator('#imageDisclosure')).to_be_visible();expect(page.locator('#imageDisclosure')).to_have_text('تصویر نمادین است')
    first=page.locator('#track picture img');expect(first).to_have_attribute('alt', 'تصویر نمادین '+p['brand_fa']+' — '+p['name_fa']);assert first.evaluate('(e)=>e.complete && e.naturalWidth>0')
    expect(page.locator('#addBtn')).to_be_enabled();expect(page.locator('#addBtn')).to_contain_text('سفارش ساخت');page.locator('#addBtn').click();page.goto(base+'/cart',wait_until='domcontentloaded');expect(page.locator('#wrap')).to_contain_text('تصویر نمادین است')
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),('overflow',width)
    page.goto(base+'/samples',wait_until='domcontentloaded');expect(page.locator('.sc').first).to_be_visible();html=page.evaluate("p=>card({...p,sample_price:1000})",p);assert 'تصویر نمادین' in html
    page.evaluate("token=>{localStorage.setItem('yazd_customer_token',token);localStorage.setItem('yazd_customer_mobile','09120001234')}",token);page.goto(base+'/wishlist',wait_until='domcontentloaded');expect(page.locator('.wish-card').first).to_be_visible();expect(page.locator('.wish-card .card-illustrative').first).to_have_text('تصویر نمادین')
    assert not errors,errors;page.close()
   browser.close()
  print('PASS image six mobile/desktop: image disclosure, real image loading, search MTO, product, cart, sample and wishlist')
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
