#!/usr/bin/env python3
"""Verify generated/draft maker notes never reach public API or server-rendered HTML."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-maker-review-') as tmp:
    dbfile=str(Path(tmp)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-secret-123'}
    subprocess.run(['node','-e',"require('./src/db')"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
    con=sqlite3.connect(dbfile);pid,slug=con.execute("select id,slug from products where id='YZD-PROD-0429'").fetchone()
    draft='این متن پیش‌نویس صرفاً برای آزمون است و تجربه تأییدشده نیست.'
    con.execute('update products set maker_note=?,maker_note_by=?,maker_note_approved=0 where id=?',(draft,'نویسنده آزمایشی',pid));con.commit()
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        def call(method,path,data=None,token=None,as_json=True):
            headers={'Content-Type':'application/json'}
            if token:headers['Authorization']='Bearer '+token
            req=urllib.request.Request(base+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
            try:
                with urllib.request.urlopen(req,timeout=3) as r:return r.status,(json.load(r) if as_json else r.read().decode())
            except urllib.error.HTTPError as e:return e.code,json.load(e)
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:call('GET','/api/health');break
            except (OSError,urllib.error.URLError):time.sleep(.1)
        else:raise RuntimeError('server not ready')
        status,public=call('GET','/api/products/'+slug);assert status==200 and public['maker_note'] is None,public
        status,html=call('GET','/perfume/'+slug,as_json=False);assert status==200 and draft not in html
        status,login=call('POST','/api/admin/login',{'username':'owner','password':'test-secret-123'});assert status==200,login
        token=login['token'];route='/api/admin/products/'+slug
        status,admin=call('GET',route,token=token);assert status==200 and admin['maker_note']==draft and admin['maker_note_approved'] is False,admin
        approved='یادداشت بازبینی و تأییدشده برای آزمون.'
        status,_=call('PUT',route,{'maker_note':approved,'maker_note_by':'مدیر'},token);assert status==200
        status,public=call('GET','/api/products/'+slug);assert public['maker_note']==approved,public
        status,html=call('GET','/perfume/'+slug,as_json=False);assert approved in html
        status,_=call('PUT',route,{'maker_note':'','maker_note_by':''},token);assert status==200
        status,public=call('GET','/api/products/'+slug);assert public['maker_note'] is None
        assert con.execute('select maker_note_approved from products where id=?',(pid,)).fetchone()[0]==0
        print('PASS: drafts hidden in public API/SSR, visible in admin, explicit save publishes, clearing hides')
    finally:
        con.close();server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
