#!/usr/bin/env python3
"""Unverified product performance stays in admin, not public API or HTML."""
import json,os,socket,sqlite3,subprocess,tempfile,time,urllib.request,urllib.error,urllib.parse
from pathlib import Path
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-performance-gate-') as tmp:
 dbfile=str(Path(tmp)/'db.sqlite');sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
 env={**os.environ,'DB_PATH':dbfile,'BACKUP_DISABLED':'1','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'test-secret-123'}
 subprocess.run(['node','-e',"require('./src/db').db.close()"],cwd=root,env=env,check=True,stdout=subprocess.DEVNULL,timeout=120)
 con=sqlite3.connect(dbfile);pid,slug=con.execute("select id,slug from products where id='YZD-PROD-1798'").fetchone()
 longevity='آزمون ماندگاری ادعای تأییدنشده';sillage='آزمون پخش ادعای تأییدنشده'
 con.execute('update products set longevity=?,sillage=? where id=?',(longevity,sillage,pid));con.commit()
 before=con.execute('select longevity,sillage from products where id=?',(pid,)).fetchone()
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
  status,public=call('GET','/api/products/'+slug);assert status==200 and public['longevity'] is None and public['sillage'] is None
  status,listing=call('GET','/api/products?full=1&limit=100&q='+urllib.parse.quote('بوس ۹۸'));assert status==200
  found=[p for p in listing['products'] if p['id']==pid];assert found and found[0]['longevity'] is None and found[0]['sillage'] is None
  status,html=call('GET','/perfume/'+slug,as_json=False);assert status==200 and longevity not in html and sillage not in html
  status,login=call('POST','/api/admin/login',{'username':'owner','password':'test-secret-123'});assert status==200,login
  status,admin=call('GET','/api/admin/products/'+slug,token=login['token']);assert status==200 and (admin['longevity'],admin['sillage'])==before
  assert con.execute('select longevity,sillage from products where id=?',(pid,)).fetchone()==before
  print('PASS public API/list/SSR suppress unverified performance; admin and stored drafts preserved')
 finally:
  con.close();server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
