#!/usr/bin/env python3
"""Chromium same-site sibling-origin CSRF test; isolated DB, fake SMS."""
import http.server,json,os,socket,sqlite3,subprocess,tempfile,threading,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
class Attacker(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<!doctype html><title>other origin</title>')
 def log_message(self,*args):pass
with tempfile.TemporaryDirectory(prefix='csrf-browser-') as td:
 td=Path(td);db=td/'shop.sqlite';mock=td/'sms.js';mock.write_text("const s=require("+json.dumps(str(root/'src/sms.js'))+");s.sendOtp=async()=>({ok:true});")
 s=socket.socket();s.bind(('127.0.0.1',0));port=s.getsockname()[1];s.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(db),'BACKUP_DISABLED':'1','NODE_ENV':'test','ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Origin-Test-Owner-981','PORT':str(port),'NODE_OPTIONS':'--require='+str(mock)}
 server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 attacker=http.server.ThreadingHTTPServer(('127.0.0.1',0),Attacker);thread=threading.Thread(target=attacker.serve_forever,daemon=True);thread.start();evil=f'http://127.0.0.1:{attacker.server_port}'
 try:
  for _ in range(240):
   if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROME_EXECUTABLE') or None,headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page()
    page.goto(base+'/',wait_until='domcontentloaded')
    login=page.evaluate("""async()=>{const r=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'Origin-Test-Owner-981'})});return {status:r.status,body:await r.json()}}""")
    assert login['status']==200;token=login['body']['token'];assert any(c['name']=='yazd_admin' for c in context.cookies())
    page.goto(evil+'/',wait_until='domcontentloaded')
    # Different ports are different origins but the same site: SameSite=Lax
    # cookies are sent. Both requests use simple no-cors content types.
    page.evaluate("""async base=>{for(const path of ['/api/admin/logout','/api/auth/request-code'])await fetch(base+path,{method:'POST',mode:'no-cors',credentials:'include',headers:{'Content-Type':'text/plain'},body:JSON.stringify({mobile:'09120001234'})})}""",base)
    with sqlite3.connect(db) as c:
     assert c.execute('select count(*) from sessions where token=?',(token,)).fetchone()[0]==1
     assert c.execute("select count(*) from otp_codes where mobile='09120001234'").fetchone()[0]==0
    page.goto(base+'/',wait_until='domcontentloaded');r=page.evaluate("""async()=>{const r=await fetch('/api/auth/request-code',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mobile:'09120001234'})});return r.status}""")
    assert r==200,r
    with sqlite3.connect(db) as c:c.execute("delete from otp_codes where mobile='09120001234'")
    context.close()
   browser.close()
  print('PASS Chromium same-site cross-origin forms blocked; same-origin login and OTP work (fake SMS)')
 finally:
  attacker.shutdown();attacker.server_close();server.terminate()
  try:server.wait(timeout=5)
  except subprocess.TimeoutExpired:server.kill();server.wait()
