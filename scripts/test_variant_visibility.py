#!/usr/bin/env python3
"""HTTP tests for old and new sample/body volumes, with isolated fixture pricing."""
import json, os, socket, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-volumes-') as tmp:
    dbfile=str(Path(tmp)/'test.db')
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    pid='YZD-PROD-0429';old='TEST-OLD-SAMPLE-3'
    con.execute('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)',(old,pid,'SAMPLE','قدیمی',3,123000,0))
    oldbody=con.execute("select sku from variants where product_id=? and type='BODY_SPLASH' and volume_ml=150",(pid,)).fetchone()[0]
    con.execute("update products set supply_mode='MADE_TO_ORDER' where id=?",(pid,))
    con.execute("update variants set stock=5 where product_id=?",(pid,))
    for sku,kind,vol in [('TEST-SAMPLE-5','SAMPLE',5),('TEST-BODY-120','BODY_SPLASH',120)]:
        con.execute('insert into variants(sku,product_id,type,type_label,volume_ml,price_toman,stock) values(?,?,?,?,?,?,?)',(sku,pid,kind,kind,vol,123000,5))
    con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        def call(path,data=None):
            req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'},method='GET' if data is None else 'POST')
            try:
                with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:status,p=call('/api/products/'+pid);break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else:raise RuntimeError('server not ready')
        assert status==200
        got={v['sku'] for v in p['variants']}
        assert old not in got and oldbody not in got and {'TEST-SAMPLE-5','TEST-BODY-120'}<=got,got
        status,sync=call('/api/cart/sync',{'skus':[old,oldbody,'TEST-SAMPLE-5','TEST-BODY-120']})
        assert status==200 and {x['sku'] for x in sync['variants']}=={'TEST-SAMPLE-5','TEST-BODY-120'}
        for sku in [old,oldbody]:
            status,_=call('/api/cart/calculate',{'items':[{'sku':sku,'quantity':1}]});assert status==400,(sku,status)
        for sku in ['TEST-SAMPLE-5','TEST-BODY-120']:
            status,body=call('/api/cart/calculate',{'items':[{'sku':sku,'quantity':1}]});assert status==200,(sku,status,body)
        assert con.execute('select count(*) from variants where sku in (?,?)',(old,oldbody)).fetchone()[0]==2
        print('PASS: retired sample 3/body 150 hidden and blocked; fixture sample 5/body 120 visible and purchasable; history retained')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
