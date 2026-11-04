#!/usr/bin/env python3
"""Checkout CSP, out-of-order pricing and duplicate-click guard in Chromium."""
import json,os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='checkout-async-') as td:
 sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close();base=f'http://127.0.0.1:{port}'
 env={**os.environ,'DB_PATH':str(Path(td)/'db.sqlite'),'BACKUP_DISABLED':'1','NODE_ENV':'test','PORT':str(port)}
 p=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  for _ in range(240):
   if p.poll() is not None:raise RuntimeError(p.stderr.read().decode())
   try:
    with urllib.request.urlopen(base+'/api/health',timeout=1):break
   except OSError:time.sleep(.05)
  else:raise RuntimeError('server did not start')
  item={'sku':'TEST-SKU','name':'رایحه آزمون','price':100000,'quantity':1,'image':'/images/products/variant-sample.jpg'}
  init='''localStorage.setItem('yazd_cart_v1',CART);
  window.__calcs=[];window.__orders=[];const f=window.fetch.bind(window);
  window.fetch=(u,o={})=>{
   if(String(u)==='/api/cart/calculate')return new Promise(resolve=>window.__calcs.push({body:JSON.parse(o.body),resolve:x=>resolve(new Response(JSON.stringify(x),{status:200,headers:{'Content-Type':'application/json'}}))}));
   if(String(u)==='/api/orders')return new Promise((resolve,reject)=>window.__orders.push({body:JSON.parse(o.body),resolve:()=>resolve(new Response(JSON.stringify({error:'پرداخت آزمایشی ناموفق'}),{status:400,headers:{'Content-Type':'application/json'}})),reject:()=>reject(new Error('network lost')),conflict:()=>resolve(new Response(JSON.stringify({error:'تعارض',order_id:'ORDER-TEST'}),{status:409,headers:{'Content-Type':'application/json'}}))}));
   return f(u,o);
  };'''.replace('CART',json.dumps(json.dumps([item],ensure_ascii=False)))
  with sync_playwright() as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox'])
   for width in (390,1440):
    context=browser.new_context(viewport={'width':width,'height':844},service_workers='block');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.add_init_script(init)
    response=page.goto(base+'/checkout',wait_until='domcontentloaded');policy=response.headers['content-security-policy']
    assert "script-src-attr 'none'" in policy
    fallback=next(x.strip() for x in policy.split(';') if x.strip().startswith('script-src '));assert "'unsafe-inline'" not in fallback
    attack=page.evaluate('''() => new Promise(resolve=>{
      let blocked=false;document.addEventListener('securitypolicyviolation',e=>{if(e.effectiveDirective==='script-src-attr')blocked=true});
      const b=document.createElement('button');b.setAttribute('onclick','window.__bad=1');document.body.appendChild(b);b.click();setTimeout(()=>resolve({blocked,executed:window.__bad||0}),200);
    })''');assert attack=={'blocked':True,'executed':0},attack
    assert page.evaluate("safePaymentUrl('javascript:alert(1)')") is None
    assert page.evaluate("safePaymentUrl('https://payment.zarinpal.com.attacker.example/pg/StartPay/x')") is None
    assert page.evaluate("safePaymentUrl('https://payment.zarinpal.com/pg/StartPay/example')").startswith('https://payment.zarinpal.com/')
    page.wait_for_function('()=>window.__calcs.length>=1')
    page.evaluate("window.__calcs[0].resolve({discount:0,campaign_discount:0,campaign_lines:[],shipping_fee:100000,shipping_label:'پست',gift_wrap_fee:0,total_payable:200000})")
    expect(page.locator('#fGift')).to_be_visible();page.locator('#fGift').check();page.wait_for_function('()=>window.__calcs.length>=2');page.locator('#fGift').uncheck();page.wait_for_function('()=>window.__calcs.length>=3')
    assert page.evaluate('window.__calcs[1].body.gift_wrap') is True and page.evaluate('window.__calcs[2].body.gift_wrap') is False
    page.evaluate("window.__calcs[2].resolve({discount:0,campaign_discount:0,campaign_lines:[],shipping_fee:100000,shipping_label:'پست',gift_wrap_fee:0,total_payable:200000})")
    expect(page.locator('.sum-total')).to_contain_text('۲۰۰,۰۰۰')
    page.evaluate("window.__calcs[1].resolve({discount:0,campaign_discount:0,campaign_lines:[],shipping_fee:100000,shipping_label:'پست',gift_wrap_fee:70000,total_payable:270000})")
    page.wait_for_timeout(250);expect(page.locator('.sum-total')).to_contain_text('۲۰۰,۰۰۰');assert not page.locator('#fGift').is_checked()
    page.locator('#fFirst').fill('مریم');page.locator('#fLast').fill('احمدی');page.locator('#fMobile').fill('09120001111');page.locator('#fProvince').select_option(label='یزد');page.locator('#fCity').fill('یزد');page.locator('#fAddress').fill('خیابان نمونه کوچه نمونه پلاک ۱۲');page.locator('#fPostal').fill('8916100000')
    page.wait_for_function('()=>window.__calcs.length>=5');page.evaluate("window.__calcs.at(-1).resolve({discount:0,campaign_discount:0,campaign_lines:[],shipping_fee:100000,shipping_label:'پست',gift_wrap_fee:0,total_payable:200000})")
    expect(page.locator('#payBtn')).to_be_enabled();page.locator('#payBtn').click();page.wait_for_function('()=>window.__orders.length===1')
    assert page.evaluate('window.__orders[0].body.gift_wrap') is False
    page.locator('#fCity').fill('میبد');page.wait_for_function('()=>window.__calcs.length>=6')
    page.evaluate("window.__calcs.at(-1).resolve({discount:0,campaign_discount:0,campaign_lines:[],shipping_fee:100000,shipping_label:'پست',gift_wrap_fee:0,total_payable:200000})")
    expect(page.locator('#payBtn')).to_be_disabled()
    page.evaluate('submitOrder()');page.wait_for_timeout(200);assert page.evaluate('window.__orders.length')==1
    page.evaluate('window.__orders[0].resolve()');expect(page.locator('#err')).to_have_text('پرداخت آزمایشی ناموفق');expect(page.locator('#payBtn')).to_be_enabled()
    page.locator('#payBtn').click();page.wait_for_function('()=>window.__orders.length===2');page.evaluate('window.__orders[1].reject()')
    expect(page.locator('#attemptNotice')).to_contain_text('سفارش قبلی در حال بررسی است');expect(page.locator('#attemptNotice')).to_contain_text('ثبت تکراری');expect(page.locator('#payBtn')).to_be_enabled()
    page.locator('#payBtn').click();page.wait_for_function('()=>window.__orders.length===3');page.evaluate('window.__orders[2].conflict()')
    expect(page.locator('#attemptNotice')).to_contain_text('سفارش قبلی در حال بررسی است');assert not errors,errors;context.close()
   browser.close()
  print('PASS checkout strict CSP, out-of-order totals, rerendered submit guard and retry on mobile/desktop Chromium; mocked APIs')
 finally:
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait()
