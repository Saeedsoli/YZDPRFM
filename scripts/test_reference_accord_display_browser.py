#!/usr/bin/env python3
"""Reference-only accords: fresh store, tamper guard and browser rendering."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='accord-display-') as td:
    db=Path(td)/'shop.sqlite';sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
    env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    def get(slug):
        with urllib.request.urlopen(base+'/api/products/'+slug) as r:return json.load(r)
    try:
        for _ in range(240):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:
                with urllib.request.urlopen(base+'/api/health',timeout=1):break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server startup timed out')
        p=get('creed-aventus');assert p['reference_accords']==['ترنج','آکورد آناناس','آکورد چوب درخت غان'] and p['notes']=={'top':[],'middle':[],'base':[]}
        normal=get('ariana-grande-ari');assert normal['notes']['top'] and not normal['reference_accords']
        generic=get('generic-yas');assert not generic['reference_accords'] and not any(generic['notes'].values())
        with sqlite3.connect(db) as c:
            before=c.execute('select count(*) from orders').fetchone()[0];price=c.execute('select essence_usd_per_kg from products where id=?',(p['id'],)).fetchone()[0]
            old=c.execute('select accords from products where id=?',(p['id'],)).fetchone()[0];c.execute('update products set accords=? where id=?',(json.dumps(['changed']),p['id']))
        assert get('creed-aventus')['reference_accords']==[]
        with sqlite3.connect(db) as c:
            c.execute('update products set accords=? where id=?',(old,p['id']))
            assert c.execute('select count(*) from orders').fetchone()[0]==before
            assert c.execute('select essence_usd_per_kg from products where id=?',(p['id'],)).fetchone()[0]==price
        payload='<img src=x onerror="window.__accordXss=1">'
        with sync_playwright() as pw:
            browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
            for width in (390,1440):
                context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base+'/perfume/creed-aventus',wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible()
                expect(page.locator('#referenceAccords')).to_be_visible();expect(page.locator('#referenceAccords')).to_contain_text('آکورد آناناس')
                assert 'اسانس دست‌ساز' not in page.locator('#referenceAccords').inner_text()
                assert page.locator('#pyramid .layer').count()==0
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
                page.goto(base+'/perfume/ariana-grande-ari',wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible();expect(page.locator('#referenceAccords')).to_be_hidden();assert page.locator('#pyramid .layer').count()==3
                page.goto(base+'/perfume/generic-yas',wait_until='domcontentloaded');expect(page.locator('#content')).to_be_visible();expect(page.locator('#referenceAccords')).to_be_hidden();expect(page.locator('#pyramid')).to_contain_text('هرم نُت برای این رایحه ثبت نشده است')
                bad={**p,'reference_accords':[payload]}
                page.route('**/api/products/creed-aventus',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(bad,ensure_ascii=False)))
                page.goto(base+'/perfume/creed-aventus',wait_until='domcontentloaded');expect(page.locator('#referenceAccords')).to_contain_text(payload)
                assert page.locator('#referenceAccords img, #referenceAccords script').count()==0
                assert page.evaluate('window.__accordXss || 0')==0
                assert not errors,errors;context.close()
            browser.close()
        print('PASS scoped reference-accord API, tamper guard, disclosures and XSS in mobile/desktop Chromium')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
