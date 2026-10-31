#!/usr/bin/env python3
"""Cross-layer availability regression: API, SEO, product UI and cart (temporary DB)."""
import json,os,re,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-availability-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    ids=['YZD-PROD-0429','YZD-PROD-0430','YZD-PROD-0431','YZD-PROD-0432','YZD-PROD-0436'];modes=['UNAVAILABLE','MADE_TO_ORDER','IN_STOCK','IN_STOCK','IN_STOCK'];stocks=[5,0,0,2,5]
    con.execute('update variants set stock=0')
    skus=[];slugs=[]
    for id,mode,stock in zip(ids,modes,stocks):
        con.execute('update products set supply_mode=? where id=?',(mode,id))
        sku=con.execute("select sku from variants where product_id=? and type='EDP' and volume_ml=10",(id,)).fetchone()[0]
        con.execute('update variants set stock=?,price_toman=? where sku=?',(stock,0 if id==ids[-1] else 100000,sku));skus.append(sku)
        slugs.append(con.execute('select slug from products where id=?',(id,)).fetchone()[0])
    con.execute("update products set supply_mode='MADE_TO_ORDER' where id='SUP-ATKINSONS-OUD-SAVE-THE-KING'");con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        def get(path):
            with urllib.request.urlopen(base+path,timeout=3) as r:return r.read().decode()
        def post(path,payload):
            req=urllib.request.Request(base+path,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
            try:
                with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:get('/api/health');break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        status,sync=post('/api/cart/sync',{'skus':skus});assert status==200
        states={x['sku']:x for x in sync['variants']}
        for i,want in enumerate(['UNAVAILABLE','MADE_TO_ORDER','UNAVAILABLE','IN_STOCK','UNAVAILABLE']):assert states[skus[i]]['state']==want,(i,states[skus[i]])
        assert states[skus[1]]['max_quantity']==5 and states[skus[3]]['max_quantity']==2
        for idx in [0,2,4]: assert post('/api/cart/calculate',{'items':[{'sku':skus[idx],'quantity':1}]})[0]==400
        assert post('/api/cart/calculate',{'items':[{'sku':skus[1],'quantity':1}]})[0]==200
        assert post('/api/cart/calculate',{'items':[{'sku':skus[1],'quantity':6}]})[0]==400
        stock=json.loads(get('/api/products?in_stock=1&limit=100'))
        assert ids[0] not in [x['id'] for x in stock['products']] and ids[3] in [x['id'] for x in stock['products']]
        sitemap=get('/sitemap.xml');assert '/perfume/'+slugs[0]+'<' not in sitemap and '/perfume/'+slugs[1]+'<' in sitemap and '/perfume/'+slugs[2]+'<' not in sitemap
        assert '/perfume/atkinsons-oud-save-the-king<' not in sitemap
        def product_schema(slug):
            html=get('/perfume/'+slug);blocks=re.findall(r'<script type="application/ld\+json">(.*?)</script>',html,re.S)
            return html,next(x for x in map(json.loads,blocks) if x.get('@type')=='Product')
        html,schema=product_schema(slugs[0]);assert schema['offers']['availability'].endswith('OutOfStock') and 'noindex, follow' in html
        html,schema=product_schema(slugs[1]);assert schema['offers']['availability'].endswith('BackOrder') and 'noindex, follow' not in html
        html,schema=product_schema(slugs[2]);assert schema['offers']['availability'].endswith('OutOfStock') and 'noindex, follow' in html
        html,schema=product_schema('atkinsons-oud-save-the-king');assert 'offers' not in schema and 'noindex, follow' in html
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page(viewport={'width':390,'height':844});errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            for index,disabled in [(0,True),(1,False),(2,True),(3,False)]:
                page.goto(base+'/perfume/'+slugs[index],wait_until='domcontentloaded')
                expect(page.locator('#content')).to_be_visible()
                if disabled: expect(page.locator('#addBtn')).to_be_disabled()
                else: expect(page.locator('#addBtn')).to_be_enabled()
                if index==0: expect(page.locator('#stockInfo')).to_have_text('فعلاً امکان تهیه نیست')
                if index==1: expect(page.locator('#addBtn')).to_contain_text('سفارش ساخت')
            page.goto(base+'/perfume/atkinsons-oud-save-the-king',wait_until='domcontentloaded')
            expect(page.locator('#content')).to_be_visible();expect(page.locator('#addBtn')).to_be_disabled();expect(page.locator('#price')).to_have_text('قیمت در دسترس نیست')
            page.goto(base+'/')
            recent=page.evaluate("() => productCard({name_fa:'تست',slug:'test',min_price:100000,image_url:'',notes:{top:[]},availability_unknown:true})")
            assert 'مشاهده قیمت روز' in recent and 'فعلاً نداریم' not in recent and 'مشاهده و خرید' not in recent
            page.evaluate("x => localStorage.setItem('yazd_cart_v1',JSON.stringify(x))",[{'sku':skus[1],'name':'test','price':100000,'image':'','quantity':8}])
            page.goto(base+'/cart',wait_until='domcontentloaded');expect(page.locator('#wrap')).to_contain_text('به سفارش ساخته می‌شود');expect(page.locator('#wrap')).not_to_contain_text('کالای ناموجود را از سبد حذف کنید')
            assert page.evaluate("JSON.parse(localStorage.getItem('yazd_cart_v1'))[0].quantity")==5
            page.evaluate("x => localStorage.setItem('yazd_cart_v1',JSON.stringify(x))",[{'sku':skus[0],'name':'test','price':100000,'image':'','quantity':1}])
            page.reload(wait_until='domcontentloaded');expect(page.locator('#wrap')).to_contain_text('کالای ناموجود را از سبد حذف کنید')
            assert not errors,errors;browser.close()
        print('PASS availability across API, cart, mobile product page, zero-price handling, SEO and sitemap')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
