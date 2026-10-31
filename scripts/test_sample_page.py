#!/usr/bin/env python3
"""Sample listing: only real sellable 5ml SKUs, correct price and no false stock claims."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-sample-page-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    con.execute('update variants set stock=0')
    scenarios=[('YZD-PROD-0429','MADE_TO_ORDER',260000,0),('YZD-PROD-0430','IN_STOCK',310000,3),('YZD-PROD-0431','IN_STOCK',1000,0),('YZD-PROD-0432','UNAVAILABLE',2000,5),('YZD-PROD-0436','MADE_TO_ORDER',0,1)]
    for id,mode,price,stock in scenarios:
        con.execute('update products set supply_mode=? where id=?',(mode,id))
        con.execute('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)',('test-sample-'+id,id,'SAMPLE','سمپل',5,price,stock))
    con.execute("update variants set price_toman=1 where product_id='YZD-PROD-0429' and type='EDP' and volume_ml=10")
    con.commit();server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:urllib.request.urlopen(base+'/api/health',timeout=1);break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        with urllib.request.urlopen(base+'/api/products?sample_5=1&sort=sample_price_asc&limit=24') as r:data=json.load(r)
        assert data['total']==2,data
        assert [(x['id'],x['sample_price']) for x in data['products']]==[('YZD-PROD-0429',260000),('YZD-PROD-0430',310000)],data
        assert data['products'][0]['min_price']==1 # sample display must not use this
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':844});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/samples',wait_until='domcontentloaded')
            expect(page.locator('#cnt')).to_contain_text('۲ رایحه')
            expect(page.locator('#cntAll')).to_have_text('۲')
            expect(page.locator('#fromPrice')).to_contain_text('۲۶۰,۰۰۰')
            expect(page.locator('#grid article')).to_have_count(2)
            expect(page.locator('#grid article').first).to_contain_text('سمپل ۵ میل')
            assert '۳ میل' not in page.locator('body').inner_text()
            page.goto(base+'/why-us',wait_until='domcontentloaded')
            expect(page.locator('#sampleFrom')).to_contain_text('۲۶۰,۰۰۰')
            assert 'سمپل ۳' not in page.locator('body').inner_text()
            page.goto(base+'/',wait_until='domcontentloaded')
            assert 'سمپل ۳' not in page.locator('body').inner_text()
            page.goto(base+'/essences',wait_until='domcontentloaded')
            assert 'سمپل ۳' not in page.locator('body').inner_text()
            con.execute("update products set supply_mode='UNAVAILABLE'");con.commit()
            page.goto(base+'/samples',wait_until='domcontentloaded')
            expect(page.locator('#cnt')).to_contain_text('۰ رایحه')
            expect(page.locator('#grid')).to_contain_text('فعلاً سمپل قابل سفارش نداریم')
            expect(page.locator('#fromPrice')).to_have_text('قیمت پس از انتخاب رایحه')
            assert not errors,errors;browser.close()
        print('PASS HTTP/browser: correct 5ml price and filtered orderability incl. made-to-order, no 3ml or fake defaults')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
