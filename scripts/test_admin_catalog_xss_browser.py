#!/usr/bin/env python3
"""Admin catalog, variant and article renderers treat untrusted text as data."""
import os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent
payload='<img src=x onerror="window.__xss=1">'
key="A');window.__xss=1;//"
with tempfile.TemporaryDirectory(prefix='admin-catalog-xss-') as td:
    s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':str(Path(td)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Catalog-Xss-Owner-981'}
    p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(240):
            if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=1):break
            except OSError:time.sleep(.05)
        else:raise RuntimeError('server did not start')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
            for width in (390,1440):
                context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                product={'slug':key,'brand_fa':payload,'name_fa':payload,'name_en':payload,'family_fa':payload,'variants':[{'stock':1}],'min_price':1000}
                article={'id':key,'title':payload,'slug':key,'category':payload}
                page.route('**/api/articles',lambda route:route.fulfill(json={'total':1,'articles':[article]}))
                page.route('**/api/products?*',lambda route:route.fulfill(json={'total':1,'products':[product]}))
                page.route('**/api/admin/low-stock?*',lambda route:route.fulfill(json={'total':1,'threshold':15,'items':[{'slug':key,'brand_fa':payload,'name_fa':payload,'type_label':payload,'sku':payload,'stock':1,'price_toman':1000,'volume_ml':5}]}))
                page.goto(base+'/admin',wait_until='domcontentloaded');page.locator('#usr').fill('owner');page.locator('#pw').fill('Catalog-Xss-Owner-981');page.locator('#loginView button').click();expect(page.locator('#panel')).to_be_visible()
                page.locator('.tab[data-t="articles"]').click();expect(page.locator('#articlesTable')).to_contain_text(payload)
                assert page.locator('#articlesTable img').count()==0
                assert page.locator('#articlesTable a').get_attribute('href')=='/journal/'+__import__('urllib.parse',fromlist=['quote']).quote(key,safe="~()*!.'-")
                page.evaluate('window.editArticle = x => { window.__article = x }');page.locator('#articlesTable button').first.click();assert page.evaluate('window.__article')==key
                page.locator('.tab[data-t="products"]').click();page.locator('#pSearch').fill('sample');page.evaluate('searchProducts(true)')
                expect(page.locator('#pResults')).to_contain_text(payload);assert page.locator('#pResults img').count()==0
                page.evaluate('window.editProduct = x => { window.__product = x }');page.locator('#pResults button').click();assert page.evaluate('window.__product')==key
                page.evaluate('showLowStock()');expect(page.locator('#pResults')).to_contain_text(payload);assert page.locator('#pResults img').count()==0
                page.locator('#pResults button').click();assert page.evaluate('window.__product')==key
                page.evaluate('''([key,payload]) => { document.getElementById('pEditCard').classList.remove('hidden'); currentProduct={variants:[{sku:key,type_label:payload,volume_ml:5,price_toman:1000,stock:1}]}; renderVariants(); window.stepStock=(sku,n)=>{window.__sku=sku;window.__delta=n}; }''',[key,payload])
                assert page.locator('#pVariants img').count()==0;expect(page.locator('#pVariants')).to_contain_text(payload)
                page.locator('#pVariants button[aria-label="افزایش موجودی"]').click();assert page.evaluate('window.__sku')==key and page.evaluate('window.__delta')==1
                page.locator('.tab[data-t="reviews"]').click();page.locator('#ivProduct').fill('sample');page.evaluate('ivSearch()')
                expect(page.locator('#ivResults button')).to_be_visible();assert page.locator('#ivResults img').count()==0
                page.locator('#ivResults button').click();assert page.locator('#ivProduct').input_value()==payload+' — '+payload
                assert page.evaluate('ivPicked')==key
                page.wait_for_timeout(250);assert page.evaluate('window.__xss || 0')==0;assert not errors,errors
                context.close()
            browser.close()
        print('PASS admin article, product search, stock table, variants and review picker XSS; actions preserved on mobile and desktop Chromium')
    finally:
        p.terminate()
        try:p.wait(timeout=5)
        except subprocess.TimeoutExpired:p.kill();p.wait()
