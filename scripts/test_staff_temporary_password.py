#!/usr/bin/env python3
"""Staff onboarding: random one-time credential, no SMS/log leak, forced change."""
import json,os,socket,sqlite3,subprocess,tempfile,threading,time,urllib.request,urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
root=Path(__file__).resolve().parent.parent
class FakeSMS(BaseHTTPRequestHandler):
 received=[];status=200
 def do_POST(self):
  n=int(self.headers.get('Content-Length','0'));self.received.append(self.rfile.read(n).decode());body=json.dumps({'status':self.status,'message':'fixture'}).encode()
  self.send_response(self.status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
fake=ThreadingHTTPServer(('127.0.0.1',0),FakeSMS);thread=threading.Thread(target=fake.serve_forever,daemon=True);thread.start()
with tempfile.TemporaryDirectory(prefix='staff-credential-') as td:
 try:
  for mode in ['console','missing','provider']:
   db=str(Path(td)/f'{mode}.sqlite');log=Path(td)/f'{mode}.log';sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
   env={**os.environ,'DB_PATH':db,'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port),'ADMIN_USERNAME':'owner','ADMIN_PASSWORD':'Isolated-Owner-2379'}
   for k in ['SMS_USERNAME','SMS_PASSWORD','SMS_API_KEY','SMS_API_URL','SMS_SENDER','SMS_AUTH_MODE']:env.pop(k,None)
   env['SMS_PROVIDER']='console' if mode=='console' else 'generic'
   if mode=='provider':env.update(SMS_API_URL=f'http://127.0.0.1:{fake.server_address[1]}/send',SMS_API_KEY='fake-test-key')
   out=open(log,'w+');proc=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=out,stderr=out)
   def call(method,path,data=None,token=None):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if data is None else json.dumps(data).encode(),headers=headers,method=method)
    try:
     with urllib.request.urlopen(req,timeout=5) as r:return r.status,json.load(r),dict(r.headers)
    except urllib.error.HTTPError as e:return e.code,json.load(e),dict(e.headers)
   try:
    for _ in range(200):
     if proc.poll() is not None:raise RuntimeError(log.read_text())
     try:
      with urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health',timeout=1):break
     except Exception:time.sleep(.1)
    else:raise RuntimeError('server not ready')
    code,login,_=call('POST','/api/admin/login',{'username':'owner','password':'Isolated-Owner-2379'});assert code==200;token=login['token']
    def create(nid,mobile):return call('POST','/api/admin/staff',{'first_name':'آزمایشی','last_name':'کارمند','national_id':nid,'mobile':mobile,'role_key':'warehouse'},token)
    FakeSMS.received.clear();FakeSMS.status=200
    code,a,h=create('1000000001','09120001111');assert code==201,a
    pw=a['temp_password'];assert len(pw)>=20 and pw!='9120001111' and pw not in a['message'];assert h.get('Cache-Control')=='no-store' and h.get('Pragma')=='no-cache'
    if mode=='provider':
     assert a['sms_sent'] is True and len(FakeSMS.received)==1 and pw not in FakeSMS.received[0] and '1000000001' not in FakeSMS.received[0]
     assert 'پذیرفته' in a['message'];FakeSMS.status=500
    else:assert a['sms_sent'] is False and not FakeSMS.received
    code,b,h2=create('1000000002','09120002222');assert code==201 and b['temp_password']!=pw and b['sms_sent'] is False and h2.get('Cache-Control')=='no-store'
    if mode=='provider':assert len(FakeSMS.received)==2 and all(pw not in v and b['temp_password'] not in v for v in FakeSMS.received)
    code,_,_=call('POST','/api/admin/login',{'username':'1000000001','password':'9120001111'});assert code==401
    code,staff,_=call('POST','/api/admin/login',{'username':'1000000001','password':pw});assert code==200 and staff['user']['must_change'];staff_token=staff['token']
    code,_,_=call('GET','/api/admin/staff',token=staff_token);assert code==403
    code,_,_=call('POST','/api/admin/change-password',{'current':pw,'new_password':'Staff-Changed-2384'},staff_token);assert code==200
    assert call('POST','/api/admin/login',{'username':'1000000001','password':pw})[0]==401
    assert call('POST','/api/admin/login',{'username':'1000000001','password':'Staff-Changed-2384'})[0]==200
    code,staff_list,_=call('GET','/api/admin/staff',token=token);serialized=json.dumps(staff_list,ensure_ascii=False);assert code==200 and pw not in serialized and b['temp_password'] not in serialized and 'pass_hash' not in serialized
    c=sqlite3.connect(db)
    for table in ['app_logs','audit_log']:
     blob=' '.join(str(r) for r in c.execute(f'select * from {table}'));assert pw not in blob and b['temp_password'] not in blob
    c.close();out.flush();text=log.read_text();assert pw not in text and b['temp_password'] not in text
   finally:proc.terminate();proc.wait(timeout=10);out.close()
 finally:fake.shutdown();fake.server_close();thread.join(timeout=5)
print('PASS random distinct credentials, no-store, no logs/SMS secrets, forced change, provider acceptance and failure')
