#!/usr/bin/env python3
"""Hostile catalog data and wishlist actions in a real isolated browser."""
import json,os,socket,subprocess,tempfile,time,urllib.request,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='catalog-cards-xss-') as td:
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
  with urllib.request.urlopen(base+'/api/products?limit=1') as r:normal=json.load(r)['products'][0]
  payload='<img src=x onerror="window.__cardXss=1">';slug="evil'\" onmouseover=\"window.__cardXss=2";sku="sample'\" );window.__cardXss=3;//"
  image='/images/products/missing" onerror="window.__cardXss=4.jpg'
  product={**normal,'slug':slug,'name_fa':payload,'brand_fa':payload,'name_en':payload,'family_fa':payload,'image_url':image,'notes':{'top':[payload],'middle':[],'base':[]},'notes_top':[payload],
           'sample_price':1000,'min_price':1000,'supply_mode':'MADE_TO_ORDER','in_stock':False,'_score':5,
           'variants':[{'sku':sku,'type':'SAMPLE','type_label':'سمپل','volume_ml':5,'price_toman':1000,'stock':0}]}
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];removed=[];page.on('pageerror',lambda e:errors.append(str(e)))
    def route(r):
     url=urllib.parse.urlsplit(r.request.url)
     if url.netloc!=f'127.0.0.1:{port}':return r.abort()
     if url.path=='/api/auth/me':return r.fulfill(status=200,content_type='application/json',body=json.dumps({'authenticated':True,'mobile':'09120001234'}))
     if url.path=='/api/wishlist':
      if r.request.method=='POST':removed.append(json.loads(r.request.post_data));return r.fulfill(status=200,content_type='application/json',body='{"ok":true}')
      return r.fulfill(status=200,content_type='application/json',body=json.dumps({'products':[product]},ensure_ascii=False))
     if url.path=='/api/products' and urllib.parse.parse_qs(url.query).get('q')==['fixture']:
      return r.fulfill(status=200,content_type='application/json',body=json.dumps({'products':[product],'total':1},ensure_ascii=False))
     return r.continue_()
    page.route('**/*',route);page.add_init_script("localStorage.setItem('yazd_customer_token','test-token')")
    page.goto(base+'/',wait_until='domcontentloaded');expect(page.locator('.product-card').first).to_be_visible()
    page.evaluate("p => { document.querySelector('#grid').innerHTML=productCard(p); }",product)
    card=page.locator('#grid .product-card');expect(card.locator('.card-title')).to_contain_text(payload)
    assert card.locator('.card-title img, .card-notes img, .card-sub img').count()==0
    assert card.locator('.img-wrap img').get_attribute('src')==image and card.locator('.img-wrap img').get_attribute('onerror') is None
    assert card.get_attribute('href').startswith('/perfume/') and '"' not in card.get_attribute('href')
    page.evaluate("p => { document.querySelector('#grid').innerHTML=productCard({...p,in_stock:true,campaign_percent:10}); }",product)
    expect(page.locator('#grid .card-off bdi')).to_have_text('۱۰٪')
    page.evaluate("() => fetchSugg('fixture')");expect(page.locator('#sugg .sugg-item')).to_be_visible()
    assert page.locator('#sugg img').first.get_attribute('src')==image and page.locator('#sugg img').first.get_attribute('onerror') is None
    page.goto(base+'/samples',wait_until='domcontentloaded');expect(page.locator('#grid')).to_be_visible()
    page.evaluate("p => {document.querySelector('#grid').innerHTML=card(p)}",product)
    expect(page.locator('#grid .nm')).to_contain_text(payload);assert page.locator('#grid .nm img').count()==0
    assert page.locator('#grid .sc img').get_attribute('src')==image and page.locator('#grid .sc img').get_attribute('onerror') is None
    page.goto(base+'/quiz',wait_until='domcontentloaded');page.evaluate("p=>{results=[p];renderResults()}",product)
    expect(page.locator('.quiz-result-name')).to_contain_text(payload);assert page.locator('.quiz-result-name img,.quiz-result-notes img,.quiz-result-brand img').count()==0
    assert page.locator('.quiz-result-card img').get_attribute('src')==image and page.locator('.quiz-result-card img').get_attribute('onerror') is None
    page.goto(base+'/wishlist',wait_until='domcontentloaded');expect(page.locator('.wish-card')).to_be_visible()
    expect(page.locator('.card-title')).to_contain_text(payload);assert page.locator('.card-title img,.card-notes img').count()==0
    assert page.locator('.wish-card .img-wrap img').get_attribute('src')==image and page.locator('.wish-card .img-wrap img').get_attribute('onerror') is None
    add=page.locator('[data-action=add-sample]');assert add.get_attribute('data-sku')==sku and add.get_attribute('onclick') is None;add.click()
    cart=page.evaluate("JSON.parse(localStorage.getItem('yazd_cart_v1'))");assert cart[0]['sku']==sku and payload in cart[0]['name'] and '&lt;' not in cart[0]['name']
    remove=page.locator('[data-action=remove]');assert remove.get_attribute('onclick') is None;remove.click();expect(page.locator('#grid')).to_contain_text('هنوز رایحه‌ای ذخیره نکرده‌اید');assert removed and removed[0]['product']==slug
    assert page.evaluate('window.__cardXss || 0')==0
    assert not errors,errors;context.close()
   browser.close()
  print('PASS catalog, suggestions, samples, quiz, wishlist rendering and actions with hostile data on mobile/desktop Chromium')
 finally:
  server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
