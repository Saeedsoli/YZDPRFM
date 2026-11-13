#!/usr/bin/env python3
"""Browser test of product essence UI, using a disposable database."""
import os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-essence-ui-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-secret-123','REFERENCE_PRICE_V2_AUTOMIGRATE':'0'}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:urllib.request.urlopen(base+'/api/health',timeout=1);break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':390,'height':844});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/admin.html',wait_until='domcontentloaded')
            page.locator('#usr').fill('owner');page.locator('#pw').fill('test-secret-123');page.locator('button[data-csp-click="login()"]').click()
            page.locator('#tabs [data-t="products"]').click()
            page.locator('#pSearch').fill('Aventus');page.wait_for_timeout(800)
            page.locator("#pResults button[data-csp-click*=\"creed-aventus\"]").first.click()
            expect(page.locator('#essencePriceCard')).to_be_visible()
            expect(page.locator('#essenceMessage')).to_contain_text('هنوز ثبت نشده')
            assert 'قیمت پایه ($)' not in page.locator('#pVariants').inner_text()
            page.locator('#essenceUsd').fill('۰٫۲۸۶')
            page.locator('#essencePreviewBtn').click()
            expect(page.locator('#essencePreview')).to_be_visible()
            expect(page.locator('#essenceToman')).to_have_value('۸۵٬۸۰۰ تومان')
            expect(page.locator('#essencePreview')).to_contain_text('۵٬۱۴۸٬۰۰۰')
            page.locator('#essenceUsd').fill('۰٫۳')
            expect(page.locator('#essenceApplyBtn')).to_be_hidden()
            page.locator('#essenceUsd').fill('۰٫۲۸۶');page.locator('#essencePreviewBtn').click();expect(page.locator('#essenceApplyBtn')).to_be_visible()
            page.once('dialog',lambda dialog:dialog.accept());page.locator('#essenceApplyBtn').click()
            expect(page.locator('#essenceUsd')).to_have_value('0.286')
            expect(page.locator('#essenceToman')).to_have_value('۸۵٬۸۰۰ تومان')
            con=sqlite3.connect(dbfile)
            assert con.execute("select essence_usd_per_kg from products where id='YZD-PROD-0429'").fetchone()[0]=='286'
            assert con.execute("select price_toman from variants where product_id='YZD-PROD-0429' and type='EDP' and volume_ml=100").fetchone()[0]==5148000
            assert con.execute("select count(*) from variants where product_id='YZD-PROD-0429' and ((type='SAMPLE' and volume_ml=5) or (type='BODY_SPLASH' and volume_ml=120))").fetchone()[0]==2
            assert con.execute("select supply_mode from products where id='YZD-PROD-0429'").fetchone()[0]=='UNAVAILABLE'
            con.close();assert not errors,errors;browser.close()
        print('PASS mobile browser: search, new essence editor, Persian decimal, preview invalidation, apply, new volumes, unchanged availability')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
