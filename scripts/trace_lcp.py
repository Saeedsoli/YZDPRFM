#!/usr/bin/env python3
"""ردیابی دقیق LCP — کدام عنصر، و زنجیره درخواست‌ها تا آن لحظه.

بدون این، بهینه‌سازی حدس است. گزارش قبلی می‌گفت «۵.۱۸ ثانیه» ولی
نمی‌گفت *چه چیزی* آن‌قدر طول می‌کشد.

اجرا: python3 scripts/trace_lcp.py [/journal]
"""
import sys, json, time
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:3000'
PATH = sys.argv[1] if len(sys.argv) > 1 else '/journal'
ARGS = ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu',
        '--js-flags=--max-old-space-size=256', '--single-process']

# ۳G کند — همان پروفایلی که بنچمارک قبلی استفاده کرد
THROTTLE = {'offline': False, 'downloadThroughput': 400 * 1024 / 8,
            'uploadThroughput': 400 * 1024 / 8, 'latency': 400}

LCP_JS = """
() => new Promise(resolve => {
  let last = null;
  new PerformanceObserver(list => {
    for (const e of list.getEntries()) last = e;
  }).observe({ type: 'largest-contentful-paint', buffered: true });
  // کمی صبر تا آخرین LCP تثبیت شود
  setTimeout(() => {
    if (!last) return resolve(null);
    const el = last.element;
    resolve({
      time: Math.round(last.startTime),
      size: last.size,
      url: last.url || null,
      tag: el ? el.tagName : null,
      cls: el ? (el.className || '').toString().slice(0, 60) : null,
      text: el ? (el.textContent || '').trim().slice(0, 70) : null
    });
  }, 2500);
})
"""

with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    ctx = b.new_context(locale='fa-IR', viewport={'width': 390, 'height': 844})
    page = ctx.new_page()

    cdp = ctx.new_cdp_session(page)
    cdp.send('Network.enable')
    cdp.send('Network.emulateNetworkConditions', THROTTLE)

    reqs = []
    t0 = [0]

    def on_req(r):
        reqs.append({'url': r.url, 'type': r.resource_type,
                     'start': (time.time() - t0[0]) * 1000, 'end': None, 'size': 0})

    def on_resp(r):
        for x in reqs:
            if x['url'] == r.url and x['end'] is None:
                x['end'] = (time.time() - t0[0]) * 1000
                try: x['size'] = int(r.headers.get('content-length') or 0)
                except Exception: pass
                break

    page.on('request', on_req)
    page.on('response', on_resp)

    t0[0] = time.time()
    page.goto(BASE + PATH, wait_until='load', timeout=120000)
    lcp = page.evaluate(LCP_JS)

    nav = page.evaluate("""() => {
      const n = performance.getEntriesByType('navigation')[0] || {};
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        ttfb: Math.round(n.responseStart || 0),
        domcl: Math.round(n.domContentLoadedEventEnd || 0),
        load: Math.round(n.loadEventEnd || 0),
        fcp: fcp ? Math.round(fcp.startTime) : null
      };
    }""")

    print(f'\n  صفحه: {PATH}   (۳G کند · ۴۰۰kbps · ۴۰۰ms تأخیر)\n')
    print(f'  TTFB {nav["ttfb"]}ms · FCP {nav["fcp"]}ms · '
          f'DOMContentLoaded {nav["domcl"]}ms · Load {nav["load"]}ms')
    if lcp:
        print(f'\n  ── LCP: {lcp["time"]}ms ──')
        print(f'     عنصر : <{lcp["tag"]}> .{lcp["cls"]}')
        if lcp['url']:
            print(f'     منبع : {lcp["url"].replace(BASE, "")}')
        if lcp['text']:
            print(f'     متن  : {lcp["text"]}')
    else:
        print('\n  LCP ثبت نشد')

    print(f'\n  ── زنجیره درخواست ({len(reqs)} درخواست) ──')
    done = [r for r in reqs if r['end']]
    done.sort(key=lambda x: x['start'])
    for r in done[:22]:
        u = r['url'].replace(BASE, '') or '/'
        if len(u) > 46: u = u[:43] + '…'
        kb = f'{r["size"]/1024:.0f}KB' if r['size'] else '—'
        mark = ' ◀ LCP' if lcp and lcp.get('url') and lcp['url'] == r['url'] else ''
        print(f'   {r["start"]:6.0f} → {r["end"]:6.0f}ms  {kb:>7}  {r["type"]:<10} {u}{mark}')

    total = sum(r['size'] for r in reqs)
    print(f'\n  مجموع حجم اعلام‌شده: {total/1024:.0f}KB')

    ctx.close(); b.close()
