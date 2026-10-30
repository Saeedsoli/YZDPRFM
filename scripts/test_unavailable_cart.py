#!/usr/bin/env python3
"""HTTP regression: unavailable product cannot be purchased even with positive stock."""
import json, os, socket, sqlite3, subprocess, tempfile, time, urllib.error, urllib.request
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-unavailable-') as tmp:
    dbfile=str(Path(tmp)/'test.db')
    s=socket.socket(); s.bind(('127.0.0.1',0)); port=s.getsockname()[1]; s.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port)}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile)
    sku,pid=con.execute("SELECT sku,product_id FROM variants WHERE type='EDP' LIMIT 1").fetchone()
    con.execute("UPDATE products SET supply_mode='UNAVAILABLE' WHERE id=?",(pid,))
    con.execute('UPDATE variants SET stock=5 WHERE sku=?',(sku,));con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        url=f'http://127.0.0.1:{port}/api/cart/calculate'
        def call():
            req=urllib.request.Request(url,data=json.dumps({'items':[{'sku':sku,'quantity':1}]}).encode(),headers={'Content-Type':'application/json'},method='POST')
            try:
                with urllib.request.urlopen(req,timeout=2) as r:return r.status,json.load(r)
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None: raise RuntimeError(server.stderr.read().decode())
            try: status,body=call();break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else:raise RuntimeError('server not ready')
        assert status==400,(status,body)
        assert 'فعلاً قابل تهیه نیست' in body.get('error',''),body
        con.execute("UPDATE products SET supply_mode='MADE_TO_ORDER' WHERE id=?",(pid,));con.commit()
        status,body=call();assert status==200,(status,body)
        print('PASS HTTP: UNAVAILABLE rejected despite positive stock; MADE_TO_ORDER remains purchasable')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
