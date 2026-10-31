#!/usr/bin/env python3
"""End-to-end rate UI test with an isolated seeded database."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-rate-ui-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-rate-secret-123','REFERENCE_PRICE_V2_AUTOMIGRATE':'0'}
    init="const {db}=require('./src/db');require('./src/import-supplier-prices').importSupplierPrices(db,require('./seed/supplier_exact_prices_staged.json'));"
    subprocess.run(['node','-e',init],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    expected_products=(len(json.loads((root/'seed/supplier_exact_prices_staged.json').read_text(encoding='utf8'))['prices'])+len(json.loads((root/'seed/lv_reference_prices_v1.json').read_text(encoding='utf8'))['items'])+len(json.loads((root/'seed/official_reference_prices_v1.json').read_text(encoding='utf8'))['items'])+len(json.loads((root/'seed/official_reference_prices_v3.json').read_text(encoding='utf8'))['items']))
    expected_fa=str(expected_products*6).translate(str.maketrans('0123456789','۰۱۲۳۴۵۶۷۸۹'))
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        for _ in range(200):
            if server.poll() is not None: raise RuntimeError(server.stderr.read().decode())
            try:urllib.request.urlopen(base+'/api/health',timeout=1);break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
            page=browser.new_page(viewport={'width':390,'height':844})
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/admin.html',wait_until='domcontentloaded')
            page.locator('#usr').fill('owner');page.locator('#pw').fill('test-rate-secret-123');page.locator('button[onclick="login()"]').click()
            page.locator('#tabs [data-t="settings"]').click()
            expect(page.locator('#exchangeRateCard')).to_be_visible()
            expect(page.locator('#exchangeRateCurrent')).to_contain_text('۳۰۰٬۰۰۰')
            page.locator('#exchangeRateInput').fill('۲۵۰٬۰۰۰')
            page.locator('#exchangePreviewBtn').click()
            expect(page.locator('#exchangeRatePreview')).to_be_visible()
            expect(page.locator('#exchangeRatePreview')).to_contain_text(expected_fa)
            expect(page.locator('#exchangeApplyBtn')).to_be_visible()
            page.locator('#exchangeRateInput').fill('۲۶۰۰۰۰')
            expect(page.locator('#exchangeApplyBtn')).to_be_hidden()
            page.locator('#exchangeRateInput').fill('۲۵۰٬۰۰۰')
            page.locator('#exchangePreviewBtn').click();expect(page.locator('#exchangeApplyBtn')).to_be_visible()
            page.once('dialog',lambda dialog:dialog.accept())
            page.locator('#exchangeApplyBtn').click()
            expect(page.locator('#exchangeRateCurrent')).to_contain_text('۲۵۰٬۰۰۰')
            expect(page.locator('#exchangeRateMessage')).to_contain_text(expected_fa)
            expect(page.locator('#exchangeApplyBtn')).to_be_hidden()
            con=sqlite3.connect(dbfile)
            assert con.execute("select value from settings where key='essence_usd_rate_toman'").fetchone()[0]=='250000'
            assert con.execute("select price_toman from variants where product_id='YZD-PROD-0429' and type='EDP' and volume_ml=100").fetchone()[0]==10643000
            con.close();assert not errors,errors
            browser.close()
        print('PASS browser mobile: login, Persian digits, preview, stale-preview invalidation, confirmation, rate and price persistence')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
