#!/usr/bin/env python3
"""Real-browser cart/checkout hostile data and normal controls; disposable DB only."""
import json,os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='cart-xss-') as td:
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':str(Path(td)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(240):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=1):break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server did not start')
        payload='<img src=x onerror="window.__cartXss=1">'
        sku="sku'\");window.__cartXss=2;//"
        image='/images/products/missing" onerror="window.__cartXss=3.jpg'
        item={'sku':sku,'name':payload,'price':100000,'quantity':1,'image':image}
        calc={'campaign_discount':1000,'campaign_lines':[{'title':payload,'percent':5}],
              'discount':1000,'coupon':{'code':payload,'description':payload,'free_shipping':False},
              'shipping_fee':100000,'shipping_label':payload,'gift_wrap_fee':0,'total_payable':198000}
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
            for width in (390,1440):
                context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[]
                page.on('pageerror',lambda e:errors.append(str(e)))
                def route(r):
                    url=r.request.url
                    if url==base+'/api/cart/sync':r.fulfill(status=200,content_type='application/json',body=json.dumps({'variants':[{'sku':sku,'name':payload,'price':100000,'stock':0,'state':'MADE_TO_ORDER','max_quantity':5}]},ensure_ascii=False))
                    elif url==base+'/api/cart/calculate':r.fulfill(status=200,content_type='application/json',body=json.dumps(calc,ensure_ascii=False))
                    elif url.startswith(base):r.continue_()
                    else:r.abort()
                page.route('**/*',route)
                page.add_init_script("localStorage.setItem('yazd_cart_v1',"+json.dumps(json.dumps([item],ensure_ascii=False))+ ");localStorage.setItem('yazd_coupon','test');")
                page.goto(base+'/cart',wait_until='domcontentloaded');expect(page.locator('.cart-item')).to_be_visible()
                expect(page.locator('.ci-name')).to_have_text(payload)
                assert page.locator('.ci-name img').count()==0
                assert page.locator('.cart-item img').first.get_attribute('src')==image
                assert page.locator('.cart-item img').first.get_attribute('onerror') is None
                expect(page.locator('.camp-note')).to_contain_text(payload);expect(page.locator('.coupon-applied')).to_contain_text(payload)
                inc=page.locator('[data-action=increment]');assert inc.get_attribute('data-sku')==sku and inc.get_attribute('onclick') is None
                inc.click();expect(page.locator('.qty-ctrl span')).to_have_text('۲')
                page.locator('[data-action=decrement]').click();expect(page.locator('.qty-ctrl span')).to_have_text('۱')
                assert page.evaluate('window.__cartXss || 0')==0
                page.goto(base+'/checkout',wait_until='domcontentloaded');expect(page.locator('#summary')).to_contain_text(payload)
                assert page.locator('#summary img, #summary script').count()==0
                expect(page.locator('#summary')).to_contain_text('ارسال — '+payload)
                assert page.evaluate('window.__cartXss || 0')==0
                page.goto(base+'/cart',wait_until='domcontentloaded');expect(page.locator('.cart-item')).to_be_visible()
                page.locator('[data-action=remove]').click();expect(page.locator('#wrap')).to_contain_text('سبد خرید شما خالی است')
                assert page.evaluate('window.__cartXss || 0')==0
                assert not errors,errors
                context.close()
            browser.close()
        print('PASS cart and checkout XSS escaping, SKU controls and removal: Chromium mobile and desktop')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
