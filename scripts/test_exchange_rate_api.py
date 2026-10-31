#!/usr/bin/env python3
"""Real HTTP tests; an isolated temporary database is always used."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-rate-api-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-rate-secret-123','REFERENCE_PRICE_V2_AUTOMIGRATE':'0'}
    init="const {db}=require('./src/db');require('./src/import-supplier-prices').importSupplierPrices(db,require('./seed/supplier_exact_prices_staged.json'));"
    subprocess.run(['node','-e',init],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    con.execute("INSERT INTO roles(key,name,permissions) VALUES('rate_test','Rate test',?)",(json.dumps(['settings.view','settings.edit']),))
    cur=con.execute("INSERT INTO staff(username,display_name,role_key,pass_hash,pass_salt,must_change,active) VALUES('rate_test','Rate test','rate_test','x','x',0,1)")
    con.execute("INSERT INTO sessions(token,kind,subject,expires_at) VALUES(?,?,?,?)",('a'*48,'ADMIN',str(cur.lastrowid),int(time.time()*1000)+600000));con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        def api(method,path,data=None,token=None):
            headers={'Content-Type':'application/json'}
            if token:headers['Authorization']='Bearer '+token
            req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
            try:
                with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:status,_=api('GET','/api/health');break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else:raise RuntimeError('server not ready')
        route='/api/admin/essence-pricing/rate';preview='/api/admin/essence-pricing/preview'
        status,_=api('GET',route);assert status in (401,403),status
        assert api('GET',route,token='a'*48)[0]==403
        assert api('POST',preview,{'rate_toman':250000},'a'*48)[0]==403
        assert api('PUT',route,{'rate_toman':250000,'expected_rate_toman':300000},'a'*48)[0]==403
        status,login=api('POST','/api/admin/login',{'username':'owner','password':'test-rate-secret-123'});assert status==200 and login.get('token'),login
        token=login['token'];assert api('GET',route,token=token)==(200,{'rate_toman':300000})
        status,view=api('POST',preview,{'rate_toman':250000},token);assert status==200,(status,view)
        expected_products=(len(json.loads((root/'seed/supplier_exact_prices_staged.json').read_text(encoding='utf8'))['prices'])+len(json.loads((root/'seed/lv_reference_prices_v1.json').read_text(encoding='utf8'))['items'])+len(json.loads((root/'seed/official_reference_prices_v1.json').read_text(encoding='utf8'))['items'])+len(json.loads((root/'seed/official_reference_prices_v3.json').read_text(encoding='utf8'))['items'])+len(json.loads((root/'seed/official_reference_prices_v4.json').read_text(encoding='utf8'))['items']))
        assert view['products']==expected_products and view['variants_repriced']==expected_products*6 and view['current_rate_toman']==300000,view
        old=con.execute("select price_toman from variants where product_id='YZD-PROD-0429' and type='EDP' and volume_ml=100").fetchone()[0];assert old==12771000
        assert api('PUT',route,{'rate_toman':250000,'expected_rate_toman':123456},token)[0]==409
        assert api('PUT',route,{'rate_toman':0,'expected_rate_toman':300000},token)[0]==400
        assert con.execute("select price_toman from variants where product_id='YZD-PROD-0429' and type='EDP' and volume_ml=100").fetchone()[0]==old
        status,result=api('PUT',route,{'rate_toman':250000,'expected_rate_toman':300000},token);assert status==200,(status,result)
        assert result['variants_repriced']==expected_products*6
        assert con.execute("select price_toman from variants where product_id='YZD-PROD-0429' and type='EDP' and volume_ml=100").fetchone()[0]==10643000
        assert con.execute("select value from settings where key='essence_usd_rate_toman'").fetchone()[0]=='250000'
        assert con.execute("select count(*) from audit_log where action='products.exchange_rate'").fetchone()[0]==1
        print('PASS HTTP: unauthenticated denied, preview read-only, invalid rate rejected, conflict rejected, atomic repricing and audit')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
