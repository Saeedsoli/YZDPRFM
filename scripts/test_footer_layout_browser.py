#!/usr/bin/env python3
import os, socket, subprocess, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix='footer-layout-') as td:
    db = str(Path(td) / 'db.sqlite')
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    sock.close()
    env = {
        **os.environ,
        'DB_PATH': db,
        'BACKUP_DISABLED': '1',
        'NODE_ENV': 'test',
        'ADMIN_USERNAME': 'owner',
        'ADMIN_PASSWORD': 'footer-layout-test-only-2026',
        'PORT': str(port),
    }
    server = subprocess.Popen(
        ['node', 'src/server.js'], cwd=ROOT, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
    )
    base = f'http://127.0.0.1:{port}'
    try:
        for _ in range(180):
            if server.poll() is not None:
                raise RuntimeError(server.stderr.read().decode('utf-8', 'replace'))
            try:
                urllib.request.urlopen(base + '/api/health', timeout=1)
                break
            except OSError:
                time.sleep(.1)
        else:
            raise RuntimeError('server did not start')

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=['--no-sandbox'])
            errors = []
            desktop = browser.new_page(viewport={'width': 1440, 'height': 960}, service_workers='block')
            desktop.on('pageerror', lambda e: errors.append(str(e)))
            desktop.goto(base + '/', wait_until='domcontentloaded', timeout=30000)
            desktop.wait_for_selector('footer .footer-grid', timeout=15000)
            desktop.wait_for_timeout(600)
            layout = desktop.evaluate('''() => {
              const grid=document.querySelector('footer .footer-grid');
              const get=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
              const children=['.foot-links','.foot-facts','.foot-essence'].map(get);
              return {cols:getComputedStyle(grid).gridTemplateColumns.split(/\\s+/).length,
                brand:get('.foot-brand'), children,
                sentence:[...document.querySelectorAll('.foot-essence p')].map(x=>x.innerText),
                scrollW:document.documentElement.scrollWidth,clientW:document.documentElement.clientWidth};
            }''')
            assert layout['cols'] == 3, layout
            assert layout['brand']['h'] > 0, layout
            assert max(x['y'] for x in layout['children']) - min(x['y'] for x in layout['children']) < 3, layout
            assert max(x['x'] for x in layout['children']) - min(x['x'] for x in layout['children']) > 250, layout
            assert layout['sentence'] == [], layout
            assert layout['scrollW'] <= layout['clientW'] + 1, layout

            mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, service_workers='block')
            mobile.on('pageerror', lambda e: errors.append(str(e)))
            mobile.goto(base + '/', wait_until='domcontentloaded', timeout=30000)
            mobile.wait_for_selector('footer .footer-grid', timeout=15000)
            m = mobile.evaluate('''() => ({cols:getComputedStyle(document.querySelector('footer .footer-grid')).gridTemplateColumns.split(/\\s+/).length,
                scrollW:document.documentElement.scrollWidth,clientW:document.documentElement.clientWidth})''')
            assert m['cols'] == 1 and m['scrollW'] <= m['clientW'] + 1, m
            assert not errors, errors
            print('PASS footer browser: desktop intro + 3 aligned columns; removed essence note; mobile single column/no overflow')
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
