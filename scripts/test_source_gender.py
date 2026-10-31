#!/usr/bin/env python3
"""Unknown gender must not be advertised as unisex, including SSR and browser."""
import os,socket,subprocess,tempfile,time,urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='yazd-gender-') as tmp:
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1];sock.close()
    env={**os.environ,'DB_PATH':str(Path(tmp)/'db.sqlite'),'BACKUP_DISABLED':'1','PORT':str(port)}
    server=subprocess.Popen(['node','src/server.js'],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        base=f'http://127.0.0.1:{port}'
        for _ in range(200):
            if server.poll() is not None:raise RuntimeError(server.stderr.read().decode())
            try:urllib.request.urlopen(base+'/api/health',timeout=1);break
            except OSError:time.sleep(.1)
        else:raise RuntimeError('server not ready')
        html=urllib.request.urlopen(base+'/perfume/louis-vuitton-afternoon-swim').read().decode()
        # SEO metadata for unknown gender must not claim unisex.
        desc=html.split('<meta name="description"',1)[1].split('>',1)[0]
        assert 'یونیسکس' not in desc,desc
        assert 'از ۰ تومان' not in desc,desc
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);page=browser.new_page()
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(base+'/perfume/louis-vuitton-afternoon-swim',wait_until='domcontentloaded')
            expect(page.locator('#gBadge')).to_have_text('نامشخص')
            assert 'یونیسکس' not in page.locator('#chips').inner_text()
            assert not errors,errors;browser.close()
        print('PASS: unknown gender not rendered as unisex in metadata, gallery or chips')
    finally:
        server.terminate()
        try:server.wait(timeout=5)
        except subprocess.TimeoutExpired:server.kill();server.wait()
