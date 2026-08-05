#!/usr/bin/env bash
# آزمون دود — بررسی خودکار روی کل سیستم
# اجرا: bash scripts/smoke_test.sh
#
# ریشه پروژه از محل خودِ اسکریپت حساب می‌شود، نه مسیر ثابت.
# پیش‌تر اینجا `cd /home/user` بود که فقط روی ماشین توسعه کار
# می‌کرد؛ روی هر کلون دیگری آزمون در پوشه اشتباه اجرا می‌شد.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
pkill -f "node src/server" 2>/dev/null; sleep 1
node -e "const {db}=require('./src/db');db.prepare('DELETE FROM rate_limits').run()" 2>/dev/null
BACKUP_DISABLED=1 node src/server.js > /tmp/fin.log 2>&1 &
sleep 8
P=0; F=0
chk(){ if [ "$1" = "$2" ]; then P=$((P+1)); else F=$((F+1)); echo "  X $3 (want $2 got $1)"; fi }

# اجرای یک آزمون Node با مکث کوتاه پس از آن.
#
# چرا مکث: هر آزمون سرور خودش را بالا می‌آورد و در پایان می‌کشد،
# ولی `kill` فوری برنمی‌گردد — پردازه چند صد میلی‌ثانیه طول
# می‌کشد تا حافظه‌اش آزاد شود. روی این محیط (~۲GB) بدون مکث،
# آزمون‌ها روی هم انباشته می‌شدند و OOM باعث شکست‌های زنجیره‌ای
# می‌شد که ربطی به خود کد نداشت.
run_test() {
  local script="$1" label="$2"
  if node "scripts/$script" >"/tmp/${script%.js}.log" 2>&1; then
    P=$((P+1))
  else
    F=$((F+1)); echo "  X $label"
  fi
  sleep 1
}


echo "== canonical page URLs"
for p in / /cart /checkout /account /wishlist /track /contact /terms /privacy \
         /quiz /brands /essences /journal /login /admin /check; do
  chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$p)" "200" "$p"
done

echo "== print pages (no redirect)"
for p in /invoice.html /label.html /404.html /payment-result.html; do
  chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$p)" "200" "$p"
done

echo "== .html redirects to canonical (301)"
for p in /terms.html /cart.html /journal.html /brands.html /quiz.html; do
  chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000$p)" "301" "$p"
done
chk "$(curl -s -o /dev/null -w '%{redirect_url}' 'http://localhost:3000/cart.html?x=1')" \
    "http://localhost:3000/cart?x=1" "query preserved"

echo "== dynamic routes"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/perfume/creed-aventus)" "200" "perfume"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/journal/vetiver-note)" "200" "article"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/nope)" "404" "404"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/sitemap.xml)" "200" "sitemap"
SMBAD=$(curl -s http://localhost:3000/sitemap.xml | grep -c '\.html' || true)
chk "$SMBAD" "0" "sitemap has no .html urls"
SMOK=$(curl -s http://localhost:3000/sitemap.xml | python3 -c "
import sys,xml.etree.ElementTree as ET
try:
    ET.fromstring(sys.stdin.read()); print('valid')
except Exception: print('broken')")
chk "$SMOK" "valid" "sitemap is valid XML"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/robots.txt)" "200" "robots"

echo "== new endpoints"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/contact-info)" "200" "contact-info"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/cart/sync -H 'Content-Type: application/json' -d '{"skus":[]}')" "200" "cart-sync"
chk "$(curl -s -o /dev/null -w '%{http_code}' 'http://localhost:3000/api/products?sort=price_asc&limit=1')" "200" "sort"

ATOK=$(curl -s -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' \
  -d '{"username":"owner","password":"yazd1404"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).token||'')}catch{console.log('')}})")

echo "== security headers"
HDR=$(curl -sI http://localhost:3000/)
chk "$(echo "$HDR" | grep -ci 'X-Frame-Options: SAMEORIGIN')" "1" "x-frame-options"
chk "$(echo "$HDR" | grep -ci 'X-Content-Type-Options: nosniff')" "1" "nosniff"
chk "$(echo "$HDR" | grep -ci 'Referrer-Policy')" "1" "referrer-policy"
chk "$(echo "$HDR" | grep -ci 'Permissions-Policy')" "1" "permissions-policy"
# مسیر مدیریتی نباید CORS باز داشته باشد
chk "$(curl -sI http://localhost:3000/api/admin/me | grep -ci 'Access-Control-Allow-Origin')" "0" "admin has no open CORS"
# کاتالوگ عمومی باید داشته باشد
chk "$(curl -sI http://localhost:3000/api/products | grep -ci 'Access-Control-Allow-Origin')" "1" "public CORS open"
# HSTS فقط پشت HTTPS
chk "$(curl -sI -H 'X-Forwarded-Proto: https' http://localhost:3000/ | grep -ci 'Strict-Transport-Security')" "1" "hsts behind https"
chk "$(curl -sI http://localhost:3000/ | grep -ci 'Strict-Transport-Security')" "0" "no hsts on plain http"

echo "== security"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X DELETE http://localhost:3000/api/articles/ART-1001)" "401" "del-no-token"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/admin/settings)" "401" "settings-401"
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/wishlist)" "401" "wishlist-401"
SQLI=$(curl -s "http://localhost:3000/api/products?sort=id%3BDROP+TABLE+products--&limit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).total))")
chk "$SQLI" "2106" "sqli-sort"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/tickets -H 'Content-Type: application/json' -d '{"order_id":"FAKE-999","product_name":"x","volume_ml":30,"used_under_2ml":true,"description":"long enough description"}')" "404" "fake-order-ticket"

echo "== assets & fonts"
for f in Regular Medium SemiBold Bold ExtraBold; do
  SZ=$(curl -s -o /dev/null -w '%{size_download}' http://localhost:3000/fonts/Vazirmatn-$f.woff2)
  if [ "$SZ" -gt 0 ] && [ "$SZ" -lt 40000 ]; then P=$((P+1)); else F=$((F+1)); echo "  X font-$f ($SZ bytes)"; fi
done
for f in hero-cinematic.webp hero-cinematic-sm.webp hero-cinematic.jpg; do
  chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/images/$f)" "200" "$f"
done
WEBP=$(curl -s -H "Accept: image/webp,*/*" -o /dev/null -w '%{content_type}' http://localhost:3000/images/hero-cinematic.jpg)
chk "$WEBP" "image/webp" "auto-webp serving"

echo "== backup endpoints"
BK=$(curl -s http://localhost:3000/api/admin/backups -H "Authorization: Bearer $ATOK" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const b=JSON.parse(d).backups[0];console.log(b?b.name:'none')}catch{console.log('err')}})")
if [ "$BK" != "err" ]; then P=$((P+1)); else F=$((F+1)); echo "  X backup list"; fi
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/admin/backups)" "401" "backups-401"
chk "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ATOK" 'http://localhost:3000/api/admin/backups/..%2F..%2Fsrc%2Fserver.js')" "400" "path-traversal-blocked"
chk "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ATOK" 'http://localhost:3000/api/admin/backups/yazd.db')" "400" "arbitrary-name-blocked"

echo "== purchase journey"
SKU=$(curl -s "http://localhost:3000/api/products?limit=1&full=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).products[0].variants[2].sku))")
# موجودی موقت برای همین یک SKU.
# موجودی تولید عمداً صفر است (کالا تا تأیید انبار فروخته نمی‌شود)،
# پس آزمون خرید باید موجودی خودش را بسازد و در پایان برگرداند.
PREV_STOCK=$(node -e "
const D=require('better-sqlite3');const db=new D('data/yazd.db');
const r=db.prepare('SELECT stock FROM variants WHERE sku=?').get('$SKU');
console.log(r?r.stock:0);
db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(50,'$SKU');db.close();")
OID=$(curl -s -X POST http://localhost:3000/api/orders -H 'Content-Type: application/json' \
  -d "{\"customer_name\":\"سارا کریمی\",\"mobile\":\"09195554433\",\"province\":\"اصفهان\",\"city\":\"اصفهان\",\"address\":\"خیابان چهارباغ، کوچه ۷، پلاک ۲۲\",\"postal_code\":\"8134567890\",\"items\":[{\"sku\":\"$SKU\",\"quantity\":2}]}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).order_id||'')}catch{console.log('')}})")
if [ -n "$OID" ]; then P=$((P+1)); echo "  order: $OID"; else F=$((F+1)); echo "  X order failed"; fi
chk "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/api/orders/track?mobile=09195554433")" "200" "track"
# موجودی به مقدار پیشین برگردانده می‌شود
node -e "
const D=require('better-sqlite3');const db=new D('data/yazd.db');
db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(${PREV_STOCK:-0},'$SKU');db.close();" 2>/dev/null

# ── هم‌راستایی نسخه Node ──
# چهار جا نسخه تعریف می‌شود و هیچ‌کدام دیگری را نمی‌بیند.
# ناسازگاری‌شان خاموش است: کد روی یک نسخه آزموده و روی نسخه
# دیگری اجرا می‌شود.
echo "== node version alignment"
node scripts/check_node_version.js > /tmp/nodever.log 2>&1
chk "$?" "0" "node version aligned (see /tmp/nodever.log)"

echo "== concurrency, otp, alerts, coupons, xss, rbac"
pkill -f "node src/server" 2>/dev/null; sleep 2
run_test test_concurrency.js "stock concurrency"
run_test test_payment_race.js "payment idempotency"
run_test test_callback_race.js "gateway callback idempotency"
run_test test_otp_persistence.js "otp persistence"
run_test test_stock_alerts.js "stock alert paths"
run_test test_coupon_limits.js "coupon usage limits"
run_test test_xss.js "xss sanitization"
run_test test_rbac.js "roles and permissions"
run_test test_rbac_escalation.js "privilege escalation"
run_test test_search.js "search quality"
run_test test_cold_deploy.js "cold deploy (Liara disk mount)"
run_test test_analytics.js "analytics and showcase"
run_test test_images.js "product images"
run_test test_brand_names.js "persian brand names"
run_test test_notifications.js "panel notifications"
run_test test_profile.js "staff profile"
run_test test_content.js "journal content and quiz"
run_test test_accounts.js "customer and staff accounts"

# آزمون مرورگر واقعی — تنها اگر Chromium واقعاً نصب باشد.
# صرفِ نصب بودن پکیج playwright کافی نیست؛ خودِ مرورگر هم باید
# دانلود شده باشد. پوشه ~/.cache در snapshot ذخیره نمی‌شود، پس
# روی محیط تازه مرورگر نیست و این بخش باید رد شود نه اینکه
# «شکست» گزارش کند.
#   نصب: python3 -m playwright install --with-deps chromium
if python3 -c "import playwright" 2>/dev/null \
   && ls ~/.cache/ms-playwright/chromium*/ >/dev/null 2>&1; then
  # سرورهای قبلی حتماً بسته شوند، وگرنه curl زیر به سرور کهنه
  # پاسخ می‌دهد و آزمون روی نسخه قدیمی کد اجرا می‌شود.
  pkill -f "node src/server" 2>/dev/null; sleep 2
  BACKUP_DISABLED=1 node src/server.js > /tmp/br.log 2>&1 &
  BRPID=$!
  # صبر تا سرور واقعاً پاسخ بدهد — `sleep 8` ثابت روی محیط کند
  # کافی نبود و آزمون به‌صورت متناوب شکست می‌خورد.
  for i in $(seq 1 60); do
    curl -s -o /dev/null http://localhost:3000/api/health && break
    sleep 1
  done
  # /api/health پیش از آماده‌شدن ویترین تحلیلی پاسخ می‌دهد. آزمون
  # مرورگر «۸ محصول در ویترین» می‌خواهد، پس منتظر خودِ ویترین
  # می‌مانیم نه صرفاً بالا آمدن سرور — وگرنه آزمون گاه‌به‌گاه و
  # بی‌دلیل شکست می‌خورد.
  for i in $(seq 1 30); do
    N=$(curl -s http://localhost:3000/api/showcase \
        | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    print(sum(len(v) for v in d.values() if isinstance(v,list)))
except Exception: print(0)" 2>/dev/null)
    [ "${N:-0}" -ge 8 ] && break
    sleep 1
  done
  # خروجی نگه داشته می‌شود؛ بدون آن، تشخیص علت شکست ممکن نیست.
  #
  # چرا یک تلاش دوباره؟ این محیط ~۲GB حافظه دارد. وقتی Chromium
  # کنار چند سرور Node بالا می‌آید، هسته گاهی سرور را می‌کشد و
  # آزمون با ERR_CONNECTION_REFUSED شکست می‌خورد — یعنی شکستِ
  # محیط، نه شکستِ محصول. یک تلاش با محیط تمیز آن را از شکست
  # واقعی جدا می‌کند. اگر بار دوم هم افتاد، ایراد جدی است.
  BR_OK=0
  for attempt in 1 2; do
    if python3 scripts/test_browser.py >/tmp/browser.log 2>&1; then
      BR_OK=1; break
    fi
    if grep -q "ERR_CONNECTION_REFUSED\|Target page.*closed\|browser has been closed" /tmp/browser.log; then
      echo "  ~ browser test: سرور زیر فشار حافظه افتاد، تلاش دوباره ($attempt)"
      kill $BRPID 2>/dev/null; sleep 3
      BACKUP_DISABLED=1 node src/server.js > /tmp/br.log 2>&1 &
      BRPID=$!
      for i in $(seq 1 60); do
        curl -s -o /dev/null http://localhost:3000/api/health && break
        sleep 1
      done
      sleep 3
    else
      break     # شکست واقعی — تلاش دوباره بی‌فایده است
    fi
  done
  if [ "$BR_OK" = "1" ]; then
    P=$((P+1))
  else
    F=$((F+1))
    echo "  X real browser (JS errors / cart / mobile) — /tmp/browser.log"
    grep '✗' /tmp/browser.log | head -3 | sed 's/^/      /'
  fi
  kill $BRPID 2>/dev/null
else
  echo "  - browser test skipped (playwright not installed)"
fi
run_test audit_permissions.js "permission coverage audit"

# «قیمت اعلام‌شده = قیمت پرداختی» — هیچ مبلغ اضافه‌ای نباید برگردد
if node scripts/test_no_extra_charges.js >/tmp/nec.log 2>&1; then
  P=$((P+1)); else F=$((F+1)); echo "  X no extra charges (vat/tax must stay removed)"; fi

# سامانه تخفیف پیشرفته — کوپن دامنه‌دار، جشنواره، نوار اعلان.
# هر باگ اینجا ضرر مستقیم مالی است.
run_test test_promotions.js "scoped coupons / campaigns / notice bar"
run_test test_campaign_display.js "campaign price display end-to-end"
run_test test_review_invites.js "review invites for in-store customers"
run_test test_readiness.js "launch readiness + no key leakage"
run_test test_journal_lcp.js "journal server-side render + LCP guards"
run_test test_invoice_legal.js "invoice: plain vs formal (legal info)"
run_test test_customer_note.js "customer note + label + real contact"
run_test test_sms_provider.js "sms layer: any provider, no key leak"
run_test test_audit_findings.js "audit: no hash leak, rate limits"

# صفحات «چرا ما؟» و «سمپل» — پاسخ به شکاف‌های تحلیل رقابتی
run_test test_new_pages.js "why-us / samples pages"

# چهار خواسته مرداد ۱۴۰۵: موجودی صفر · کنترل ± · حجم ۱۵۰ · پیشنهاد جستجو
run_test test_stock_and_suggest.js "stock default / volume 150 / search suggest"

# یکتایی شماره سفارش زیر بار همزمان — باگی که بنچمارک پیدا کرد
run_test test_order_id_race.js "order id uniqueness under concurrency"

# استقرار روی «پلتفرم Node» لیارا — سناریویی که واقعاً اجرا می‌شود.
# test_cold_deploy فقط مسیر Docker را می‌سنجد.
if node scripts/test_node_platform_deploy.js >/tmp/npd.log 2>&1; then
  P=$((P+1)); else F=$((F+1)); echo "  X node-platform deploy (see /tmp/npd.log)"; fi

# مستندات با واقعیت هم‌خوان باشد — دو لایه
#   audit_docs.js       فایلی که سند نام برده وجود دارد؟
#   audit_docs_truth.js عددی که سند ادعا کرده درست است؟
if node scripts/audit_docs.js >/tmp/docs.log 2>&1; then
  P=$((P+1)); else F=$((F+1)); echo "  X docs match reality (see /tmp/docs.log)"; fi

if node scripts/audit_docs_truth.js >/tmp/docs_truth.log 2>&1; then
  P=$((P+1)); else F=$((F+1)); echo "  X docs numbers are true (see /tmp/docs_truth.log)"; fi

# هیچ لینک شکسته‌ای در هیچ صفحه‌ای نباشد — سرور باید بالا باشد
pkill -f "node src/server" 2>/dev/null; sleep 2
BACKUP_DISABLED=1 node src/server.js > /tmp/lnk.log 2>&1 &
LNKPID=$!
for i in $(seq 1 60); do
  curl -s -o /dev/null http://localhost:3000/api/health && break
  sleep 1
done
if node scripts/audit_links.js >/tmp/links.log 2>&1; then
  P=$((P+1)); else F=$((F+1)); echo "  X broken links (see /tmp/links.log)"; fi
kill $LNKPID 2>/dev/null

echo ""
echo "===== RESULT: $P pass / $F fail"
pkill -f "node src/server"
