#!/usr/bin/env python3
"""HTTP test of product essence-price preview, permissions and transactional update."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-product-essence-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-secret-123'}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    # A synthetic unsold product keeps the empty-variant test independent of catalog imports.
    con.execute("insert into products(id,slug,name_fa,name_en,brand_fa,supply_mode) values('SUP-TEST-NEW','test-new-product','تست','Test','تست','UNAVAILABLE')")
    # Simulate an existing deployment that still contains a retired 3ml SKU.
    con.execute("insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values('OLD-SAMPLE-3','YZD-PROD-0429','SAMPLE','قدیمی',3,123000,0)")
    con.execute("INSERT INTO roles(key,name,permissions) VALUES('stock_test','Stock test',?)",(json.dumps(['products.view','products.stock']),))
    cur=con.execute("INSERT INTO staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active) VALUES('stock_test','Stock test','stock_test','x','x',0,1)")
    con.execute("INSERT INTO sessions(token,kind,subject,expires_at) VALUES(?,?,?,?)",('b'*48,'ADMIN',str(cur.lastrowid),int(time.time()*1000)+600000));con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        def api(method,path,data=None,token=None):
            h={'Content-Type':'application/json'}
            if token:h['Authorization']='Bearer '+token
            req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=h,method=method)
            try:
                with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:api('GET','/api/health');break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else:raise RuntimeError('server not ready')
        pid='YZD-PROD-0429';route='/api/admin/essence-pricing/products/'+pid
        assert api('GET',route)[0] in (401,403)
        assert api('GET',route,token='b'*48)[0]==403
        assert api('POST',route+'/preview',{'usd_per_gram':'0.286'},'b'*48)[0]==403
        assert api('PUT',route,{'usd_per_gram':'0.286','expected_rate_toman':300000,'expected_usd_per_kg':None},'b'*48)[0]==403
        status,login=api('POST','/api/admin/login',{'username':'owner','password':'test-secret-123'});assert status==200,login
        token=login['token'];status,state=api('GET',route,token=token);assert status==200 and state['usd_per_gram'] is None,state
        assert api('POST',route+'/preview',{'usd_per_gram':'0'},token)[0]==400
        status,view=api('POST',route+'/preview',{'usd_per_gram':'0.286'},token);assert status==200,(status,view)
        assert view['proposed_usd_per_kg']=='286' and view['proposed_toman_per_gram']=='85800',view
        assert len(view['changes'])==6
        assert con.execute('select essence_usd_per_kg from products where id=?',(pid,)).fetchone()[0] is None
        data={'usd_per_gram':'0.286','expected_rate_toman':299999,'expected_usd_per_kg':None}
        assert api('PUT',route,data,token)[0]==409
        data['expected_rate_toman']=300000
        status,result=api('PUT',route,data,token);assert status==200,(status,result)
        assert result['variants_updated']==4 and result['variants_created']==2,result
        assert con.execute("select price_toman from variants where product_id=? and type='EDP' and volume_ml=100",(pid,)).fetchone()[0]==5148000
        assert con.execute("select price_toman,stock from variants where product_id=? and type='SAMPLE' and volume_ml=5",(pid,)).fetchone()==(257000,0)
        assert con.execute("select price_toman,stock from variants where product_id=? and type='BODY_SPLASH' and volume_ml=120",(pid,)).fetchone()==(1287000,0)
        assert con.execute("select supply_mode from products where id=?",(pid,)).fetchone()[0]=='UNAVAILABLE'
        assert con.execute("select count(*) from variants where product_id=? and type='SAMPLE' and volume_ml=3",(pid,)).fetchone()[0]==1
        assert api('PUT',route,data,token)[0]==409
        status,state=api('GET',route,token=token);assert state['usd_per_gram']=='0.286' and state['toman_per_gram']=='85800',state
        assert con.execute("select count(*) from audit_log where action='products.essence_price'").fetchone()[0]==1
        # New sourced catalog product initially has no variants: generate all six with one price update.
        new_id='SUP-TEST-NEW';new_route='/api/admin/essence-pricing/products/'+new_id
        status,new_preview=api('POST',new_route+'/preview',{'usd_per_gram':'0.4037'},token)
        assert status==200 and len(new_preview['changes'])==6,(status,new_preview)
        status,new_result=api('PUT',new_route,{'usd_per_gram':'0.4037','expected_rate_toman':300000,'expected_usd_per_kg':None},token)
        assert status==200 and new_result['variants_created']==6,(status,new_result)
        assert con.execute('select count(*) from variants where product_id=?',(new_id,)).fetchone()[0]==6
        assert con.execute("select price_toman from variants where product_id=? and type='EDP' and volume_ml=100",(new_id,)).fetchone()[0]==7267000
        assert con.execute('select supply_mode from products where id=?',(new_id,)).fetchone()[0]=='UNAVAILABLE'
        print('PASS HTTP: per-gram USD/toman, safe preview, validation, conflict, new volumes, repricing, unchanged availability and audit')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
