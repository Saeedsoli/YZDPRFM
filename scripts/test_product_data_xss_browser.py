#!/usr/bin/env python3
"""Product renderer: hostile API data and image fallback in a real browser.

Uses only a disposable seeded DB and intercepted responses; no live data.
"""
import json, os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='product-xss-') as tmp:
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':str(Path(tmp)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(240):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=1):break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server did not start')
        with urllib.request.urlopen(base+'/api/products?limit=1') as r: slug=json.load(r)['products'][0]['slug']
        with urllib.request.urlopen(base+'/api/products/'+slug) as r: product=json.load(r)
        payload='<img src=x onerror="window.__productXss=1">'
        image_payload="/images/products/bad' onerror='window.__productXss=2.jpg"
        bad={**product,'name_fa':payload,'brand_fa':payload,'family_fa':payload,'family_slug':'\" onmouseover=\"window.__productXss=3',
             'season':payload,'occasion':payload,'temperature':payload,'notes':{'top':[payload],'middle':[payload],'base':[payload]},'image_url':image_payload}
        img=(root/'public/images/products/variant-sample.jpg').read_bytes()
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
            malicious=bad.copy()
            for width in (390,1440):
                bad.clear();bad.update(malicious)
                context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                def handle(route):
                    url=route.request.url
                    if url==base+'/api/products/'+slug:route.fulfill(status=200,content_type='application/json',body=json.dumps(bad,ensure_ascii=False))
                    elif url==base+'/images/products/fallback-test-sm.jpg':route.fulfill(status=404,body='missing')
                    elif url==base+'/images/products/fallback-test.jpg':route.fulfill(status=200,content_type='image/jpeg',body=img)
                    elif url.startswith(base):route.continue_()
                    else:route.abort()
                page.route('**/*',handle)
                page.goto(base+'/perfume/'+slug,wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible()
                for selector in ['#crumbs','#titleFa','#chips','#quick','#pyramid']:
                    assert page.locator(selector).locator('img,script,svg').count()==0,selector
                    expect(page.locator(selector)).to_contain_text(payload)
                assert page.locator('#track img[onerror]').count()==0
                assert page.locator('#thumbs img').first.get_attribute('data-fallback')==image_payload
                assert page.locator('#thumbs img').first.get_attribute('onerror')=='this.onerror=null;this.src=this.dataset.fallback'
                assert page.evaluate('window.__productXss || 0')==0
                # Re-render ordinary fixture with a missing thumbnail and real full-size fallback.
                bad.update(product);bad['image_url']='/images/products/fallback-test.jpg'
                page.reload(wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible()
                thumb=page.locator('#thumbs img').first
                # Thumbnails are hidden on mobile; force lazy loading for this fixture.
                thumb.evaluate("e => { e.loading = 'eager'; }")
                expect(thumb).to_have_attribute('src','/images/products/fallback-test.jpg',timeout=10000)
                page.wait_for_function("() => { const e=document.querySelector('#thumbs img'); return e && e.complete && e.naturalWidth > 0; }")
                assert page.evaluate('window.__productXss || 0')==0
                assert not errors,errors
                context.close()
            browser.close()
        print('PASS product HTML escaping and thumbnail fallback in Chromium mobile and desktop (disposable DB)')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
