#!/usr/bin/env bash
# آزمون دود — بررسی خودکار روی کل سیستم
# اجرا: bash scripts/smoke_test.sh
#
# ریشه پروژه از محل خودِ اسکریپت حساب می‌شود، نه مسیر ثابت.
# پیش‌تر اینجا `cd /home/user` بود که فقط روی ماشین توسعه کار
# می‌کرد؛ روی هر کلون دیگری آزمون در پوشه اشتباه اجرا می‌شد.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
# The suite intentionally changes stock, orders, staff and settings. Some legacy
# fixtures hard-code data/yazd.db, so DB_PATH alone is NOT isolation. Always
# run an ephemeral project copy with a clean database and a clean environment.
if [ "${YAZD_SMOKE_STAGE:-}" != "1" ]; then
  ROOT=$(pwd -P)
  if [ ! -d "$ROOT/node_modules" ]; then echo "Dependencies missing; install them before running smoke." >&2; exit 2; fi
  STAGE=$(mktemp -d /tmp/yazd-smoke-XXXXXXXX) || exit 2
  STAGE_PID=
  cleanup_stage() {
    if [ -n "$STAGE_PID" ]; then
      # Every descendant inherits this newly created session/process group;
      # this also reaps a test server orphaned by a crashing test.
      kill -TERM -- "-$STAGE_PID" 2>/dev/null || true
      wait "$STAGE_PID" 2>/dev/null || true
    fi
    rm -rf -- "$STAGE"
  }
  trap cleanup_stage EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if ! tar --exclude='./.git' --exclude='./.ssh' --exclude='./node_modules' --exclude='./data' --exclude='./.cache' --exclude='./.npm' -cf - . | tar -C "$STAGE" -xf -; then echo 'Could not create isolated project' >&2; exit 2; fi
  mkdir -p "$STAGE/data"
  ln -s "$ROOT/node_modules" "$STAGE/node_modules"
  env -i PATH="$PATH" HOME="$HOME" YAZD_SMOKE_STAGE=1 DB_PATH="$STAGE/data/yazd.db" BACKUP_DISABLED=1 NODE_ENV=test setsid bash "$STAGE/scripts/smoke_test.sh" &
  STAGE_PID=$!
  wait "$STAGE_PID"
  STAGE_CODE=$?
  exit "$STAGE_CODE"
fi
STAGE_ROOT=$(pwd -P)
case "$STAGE_ROOT" in /tmp/yazd-smoke-????????) ;; *) echo 'Unsafe smoke stage; refusing to run' >&2; exit 2;; esac
if [ "$(realpath -m "${DB_PATH:-}")" != "$STAGE_ROOT/data/yazd.db" ]; then echo 'Unsafe smoke DB_PATH; refusing to run' >&2; exit 2; fi
# Reject unresolved flagged supplier mappings before seeding even the test DB.
# This is a preflight check, not a runtime importer guard.
if ! python3 scripts/test_supplier_coverage.py; then echo 'Supplier reconciliation preflight failed' >&2; exit 1; fi
if ! python3 scripts/test_audit_reference_notes.py; then echo 'Reference note audit preflight failed' >&2; exit 1; fi
if ! python3 scripts/test_secret_exclusion.py; then echo 'Secret exclusion preflight failed' >&2; exit 1; fi
# Do not kill unrelated servers or accidentally hit an existing service.
if ! python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",3000)); s.close()'; then echo 'Port 3000 is occupied; refusing to run' >&2; exit 2; fi
MAINPID= BRPID= LNKPID=
cleanup_smoke() { for pid in "$MAINPID" "$BRPID" "$LNKPID"; do [ -z "$pid" ] || kill "$pid" 2>/dev/null || true; done; }
trap cleanup_smoke EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node -e "const {db}=require('./src/db');db.prepare('DELETE FROM rate_limits').run()" 2>/dev/null
BACKUP_DISABLED=1 node src/server.js > /tmp/fin.log 2>&1 &
MAINPID=$!
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

# Complete the forced initial password change through the real API in the
# disposable store. Later admin/RBAC tests must not bypass that security gate.
if [ -z "$ATOK" ]; then echo 'Smoke owner login failed' >&2; exit 2; fi
CHANGE_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/admin/change-password \
  -H 'Content-Type: application/json' -H "Authorization: Bearer $ATOK" \
  -d '{"current":"yazd1404","new_password":"SmokeFixture-8372"}')
if [ "$CHANGE_STATUS" != 200 ]; then echo "Smoke owner password change failed: $CHANGE_STATUS" >&2; exit 2; fi
export ADMIN_PASSWORD='SmokeFixture-8372'

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
# شمار محصول از دیتابیس خوانده می‌شود، نه عدد ثابت.
# با تعویض منبع داده (۲۱۰۶ → ۲۱۱۱) این بررسی شکست و معلوم شد
# عدد ثابت، آزمون را به تعداد رکورد گره می‌زند در حالی که چیزی
# که واقعاً باید بسنجد این است: «جدول پس از تزریق سالم مانده؟»
PCOUNT=$(node -e "const D=require('better-sqlite3');const db=new D('data/yazd.db',{readonly:true});console.log(db.prepare('SELECT COUNT(*) c FROM products').get().c);db.close();")
SQLI=$(curl -s "http://localhost:3000/api/products?sort=id%3BDROP+TABLE+products--&limit=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).total))")
chk "$SQLI" "$PCOUNT" "sqli-sort"
chk "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3000/api/tickets -H 'Content-Type: application/json' -d '{"order_id":"FAKE-999","product_name":"x","volume_ml":30,"used_under_2ml":true,"description":"long enough description"}')" "410" "legacy-ticket-endpoint-disabled"

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

# هویت لوگو — باید اینجا اجرا شود چون به سرور زنده نیاز دارد
# (بخش بعدی سرور را می‌کشد).
run_test test_brand_logo.js "brand logo identity"
if node -e "const {withStock}=require('./scripts/lib/test_stock');const {spawnSync}=require('child_process');const lease=withStock('data/yazd.db',1,500,'EDP');try{if(!lease.skus.length)process.exitCode=1;else {const r=spawnSync(process.execPath,['scripts/test_shipping_gift.js'],{stdio:'inherit',env:process.env});process.exitCode=r.status===0?0:1;}}finally{lease.restore();}" > /tmp/test_shipping_gift.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X shipping rates and gift wrap"; fi

echo "== backup endpoints"
BK=$(curl -s http://localhost:3000/api/admin/backups -H "Authorization: Bearer $ATOK" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const b=JSON.parse(d).backups[0];console.log(b?b.name:'none')}catch{console.log('err')}})")
if [ "$BK" != "err" ]; then P=$((P+1)); else F=$((F+1)); echo "  X backup list"; fi
chk "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/admin/backups)" "401" "backups-401"
chk "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ATOK" 'http://localhost:3000/api/admin/backups/..%2F..%2Fsrc%2Fserver.js')" "400" "path-traversal-blocked"
chk "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $ATOK" 'http://localhost:3000/api/admin/backups/yazd.db')" "400" "arbitrary-name-blocked"

echo "== purchase journey"
# Select a real, positively priced 50ml SKU from the isolated database.
# Explicitly mark only its product in stock, since stock alone cannot override
# UNAVAILABLE. This fixture is never applied to the real store.
FIXTURE=$(node -e "const D=require('better-sqlite3');const db=new D('data/yazd.db');const r=db.prepare(\"SELECT v.sku,v.stock,p.id,p.supply_mode FROM variants v JOIN products p ON p.id=v.product_id WHERE v.type='EDP' AND v.volume_ml=50 AND v.price_toman>0 ORDER BY p.id LIMIT 1\").get();if(!r)process.exit(1);console.log([r.sku,r.stock,r.id,r.supply_mode].join('|'));db.prepare('UPDATE variants SET stock=50 WHERE sku=?').run(r.sku);db.prepare(\"UPDATE products SET supply_mode='IN_STOCK' WHERE id=?\").run(r.id);db.close();")
IFS='|' read -r SKU PREV_STOCK FIXTURE_PRODUCT PREV_MODE <<< "$FIXTURE"
OID=$(curl -s -X POST http://localhost:3000/api/orders -H 'Content-Type: application/json' \
  -d "{\"customer_name\":\"سارا کریمی\",\"mobile\":\"09195554433\",\"province\":\"اصفهان\",\"city\":\"اصفهان\",\"address\":\"خیابان چهارباغ، کوچه ۷، پلاک ۲۲\",\"postal_code\":\"8134567890\",\"items\":[{\"sku\":\"$SKU\",\"quantity\":2}]}" \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).order_id||'')}catch{console.log('')}})")
if [ -n "$OID" ]; then P=$((P+1)); echo "  order: $OID"; else F=$((F+1)); echo "  X order failed"; fi
chk "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/api/orders/track?mobile=09195554433&order_id=$OID")" "200" "track"
# Restore both stock and availability (even in the disposable fixture).
node -e "const D=require('better-sqlite3');const db=new D('data/yazd.db');db.prepare('UPDATE variants SET stock=? WHERE sku=?').run(Number(process.argv[1]),process.argv[2]);db.prepare('UPDATE products SET supply_mode=? WHERE id=?').run(process.argv[3],process.argv[4]);db.close();" "${PREV_STOCK:-0}" "$SKU" "$PREV_MODE" "$FIXTURE_PRODUCT" 2>/dev/null

# ── هم‌راستایی نسخه Node ──
# چهار جا نسخه تعریف می‌شود و هیچ‌کدام دیگری را نمی‌بیند.
# ناسازگاری‌شان خاموش است: کد روی یک نسخه آزموده و روی نسخه
# دیگری اجرا می‌شود.
echo "== node version alignment"
node scripts/check_node_version.js > /tmp/nodever.log 2>&1
chk "$?" "0" "node version aligned (see /tmp/nodever.log)"

echo "== concurrency, otp, alerts, coupons, xss, rbac"
kill "$MAINPID" 2>/dev/null || true; MAINPID=; sleep 2
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
run_test test_joop_name_correction.js "guarded Joop names"
run_test test_popular_persian_names.js "popular Persian spelling"
run_test test_amouage_common_names.js "Amouage Persian spelling"
run_test test_weekend_owner_correction.js "Weekend owner correction safety"
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
  sleep 2
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

  # رندر سمت سرور مقاله و خانه‌های عطر + سنجش CLS.
  # سرور خودش را روی درگاه جدا بالا می‌آورد، پس پس از kill بالا
  # اجرا می‌شود و تداخلی ندارد.
  sleep 2
  if python3 scripts/test_ssr_pages.py >/tmp/ssr.log 2>&1; then
    P=$((P+1))
  else
    F=$((F+1))
    echo "  X server-side render (article / brands) — /tmp/ssr.log"
    grep '✗' /tmp/ssr.log | head -3 | sed 's/^/      /'
  fi
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
run_test test_backup_stream_safety.js "backup concurrency, recovery and stream cleanup"
run_test test_automatic_backup_safety.js "automatic backup verification and atomic publish"
run_test test_delivery_time_consistency.js "consistent delivery window"
run_test test_browser_origin_guard.js "browser same-origin mutation guard"
run_test test_script_element_csp.js "template-only CSP script hashes"
run_test test_persian_date.js "Persian calendar conversions"
run_test test_calendar_assets.js "Persian calendar asset integrity and load order"
run_test test_shop_time.js "shop civil day boundaries"
if python3 scripts/test_persian_business_days.py >/tmp/test_persian_business_days.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X shop day boundaries and Persian CSV"; fi
if python3 scripts/test_persian_reports.py >/tmp/test_persian_reports.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X Persian report day aggregation"; fi
run_test test_barcode_html_safety.js "barcode attribute safety"
run_test test_client_ip.js "trusted proxy IP resolution"
run_test test_analytics_trusted_proxy.js "analytics trusted proxy resolution"
run_test test_csv_export.js "CSV quoting and formula defense"
run_test test_return_eligibility.js "return eligibility policy"
run_test test_return_store.js "staged return database safety"
run_test test_order_idempotency.js "staged order idempotency safety"
run_test test_checkout_attempt.js "staged checkout attempt rotation safety"
run_test test_order_reconciliation.js "manual payment review and delivery correction"
if python3 scripts/test_order_attempt_recovery.py >/tmp/test_order_attempt_recovery.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X offline attempt recovery"; fi
if python3 scripts/test_order_review_inflight.py >/tmp/test_order_review_inflight.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X in-flight payment review guard"; fi
if python3 scripts/test_order_reconciliation_http.py >/tmp/test_order_reconciliation_http.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X manual reconciliation HTTP"; fi
if python3 scripts/test_order_reconciliation_migration.py >/tmp/test_order_reconciliation_migration.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X reconciliation backup-first migration"; fi
if python3 scripts/test_checkout_attempt_http.py >/tmp/test_checkout_attempt_http.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X checkout attempt HTTP cookie and rotation"; fi
if python3 scripts/test_order_idempotency_http.py >/tmp/test_order_idempotency_http.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X keyed checkout concurrency and recovery"; fi
if python3 scripts/test_order_idempotency_migration.py >/tmp/test_order_idempotency_migration.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X order idempotency backup-first migration"; fi
run_test test_account_returns_gate.js "return API authentication gate"
if python3 scripts/test_account_returns_api.py >/tmp/test_account_returns_api.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X staged return API and ticket integration"; fi
if python3 scripts/test_account_returns_journey.py >/tmp/test_account_returns_journey.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X full staged return journey"; fi
if python3 scripts/test_return_store_migration.py >/tmp/test_return_store_migration.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X return schema backup-first migration"; fi
if python3 scripts/test_return_order_snapshots.py >/tmp/test_return_order_snapshots.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X return order snapshots"; fi
if python3 scripts/test_return_account_read.py >/tmp/test_return_account_read.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X return account isolation"; fi
if python3 scripts/test_csv_export_http.py >/tmp/test_csv_export_http.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X CSV export security HTTP"; fi
if python3 scripts/test_trusted_proxy_http.py >/tmp/test_trusted_proxy_http.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X trusted proxy HTTP limits"; fi
run_test test_image_upload_security.js "image upload validation and exclusive writes"
if python3 scripts/test_browser_origin_http.py >/tmp/test_browser_origin_http.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X browser origin HTTP guard"; fi
if python3 scripts/test_destructive_tool_guards.py >/tmp/test_destructive_tool_guards.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X destructive tool guards"; fi
if python3 scripts/test_admin_account_rate_limit.py >/tmp/test_admin_account_rate_limit.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X admin account rate limit"; fi
if python3 scripts/test_admin_cookie_session.py >/tmp/test_admin_cookie_session.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X admin cookie session"; fi
if python3 scripts/test_production_admin_guard.py >/tmp/test_production_admin_guard.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X production admin guard"; fi
if python3 scripts/test_staff_temporary_password.py >/tmp/test_staff_temporary_password.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X secure staff onboarding"; fi
if python3 scripts/test_production_safety_gates.py >/tmp/test_production_safety_gates.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X production payment/OTP guards"; fi
if python3 scripts/test_payment_provider_races.py >/tmp/test_payment_provider_races.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X payment provider/order status races"; fi
if python3 scripts/test_coupon_order_atomicity.py >/tmp/test_coupon_order_atomicity.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X coupon/order/stock atomicity"; fi
if python3 scripts/test_coupon_phone_ownership.py >/tmp/test_coupon_phone_ownership.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X restricted coupon phone ownership"; fi
run_test test_payment_sandbox_result.js "sandbox result guard"
if python3 scripts/test_order_stock_reservations.py >/tmp/test_order_stock_reservations.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X order stock reservation"; fi
if python3 scripts/test_order_stock_cross_process.py >/tmp/test_order_stock_cross_process.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X cross-process stock race"; fi
if python3 scripts/test_order_stock_migration.py >/tmp/test_order_stock_migration.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X stock reservation migration"; fi
if python3 scripts/test_private_order_tracking.py >/tmp/test_private_order_tracking.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X private order tracking"; fi
run_test test_payment_result_safety.js "verified payment result"
if python3 scripts/test_customer_phone_verification.py >/tmp/test_customer_phone_verification.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X customer phone ownership"; fi
if python3 scripts/test_customer_cookie_session.py >/tmp/test_customer_cookie_session.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X customer cookie session"; fi
if python3 scripts/test_checkout_profile.py >/tmp/test_checkout_profile.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X verified checkout profile privacy"; fi
if python3 scripts/test_malformed_request_paths.py >/tmp/test_malformed_request_paths.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X malformed request path resilience"; fi
if python3 scripts/test_active_secondary_notes.py >/tmp/test_active_secondary_notes.log 2>&1 && NOTE_TEST_BATCH=2 python3 scripts/test_active_secondary_notes.py >/tmp/test_active_secondary_notes_v2.log 2>&1 && NOTE_TEST_BATCH=3 python3 scripts/test_active_secondary_notes.py >/tmp/test_active_secondary_notes_v3.log 2>&1 && NOTE_TEST_BATCH=4 python3 scripts/test_active_secondary_notes.py >/tmp/test_active_secondary_notes_v4.log 2>&1 && NOTE_TEST_BATCH=5 python3 scripts/test_active_secondary_notes.py >/tmp/test_active_secondary_notes_v5.log 2>&1 && NOTE_TEST_BATCH=6 python3 scripts/test_active_secondary_notes.py >/tmp/test_active_secondary_notes_v6.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X active independent reference notes"; fi
if python3 scripts/test_otp_request_race.py >/tmp/test_otp_request_race.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X concurrent OTP send reservation"; fi
if python3 scripts/test_rate_limit_cross_process.py >/tmp/test_rate_limit_cross_process.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X cross-process rate limit"; fi
if python3 scripts/test_concurrent_db_startup.py >/tmp/test_concurrent_db_startup.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X concurrent database startup and rollback"; fi
if python3 scripts/test_password_recovery_abuse.py >/tmp/test_password_recovery_abuse.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X password recovery privacy and SMS limits"; fi
if python3 scripts/test_customer_verification_migration.py >/tmp/test_customer_verification_migration.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X customer verification migration"; fi
if python3 scripts/test_customer_password_reset_race.py >/tmp/test_customer_password_reset_race.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X customer password reset race"; fi
run_test test_login_redirect_safety.js "safe customer login redirect"
run_test test_seo_html_safety.js "safe SEO structured data and HTML attributes"
run_test test_reference_accord_display.js "scoped reference accords display"
if python3 scripts/test_approved_mto_v2.py >/tmp/test_approved_mto_v2.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X seven owner approvals"; fi
if python3 scripts/test_approved_mto_v3.py >/tmp/test_approved_mto_v3.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X four owner approvals"; fi
if python3 scripts/test_approved_mto_v4.py >/tmp/test_approved_mto_v4.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X three owner approvals"; fi
if python3 scripts/test_approved_mto_v5.py >/tmp/test_approved_mto_v5.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X three Amouage owner approvals"; fi
if python3 scripts/test_approved_mto_v6.py >/tmp/test_approved_mto_v6.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X three latest owner approvals"; fi
if python3 scripts/test_approved_mto_v7.py >/tmp/test_approved_mto_v7.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X Burberry Her approval"; fi
if python3 scripts/test_approved_mto_v8.py >/tmp/test_approved_mto_v8.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X Eternity approval"; fi
if python3 scripts/test_approved_mto_v9.py >/tmp/test_approved_mto_v9.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X Euphoria Men approval"; fi
if python3 scripts/test_approved_mto_v10.py >/tmp/test_approved_mto_v10.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X Euphoria Women approval"; fi
if python3 scripts/test_approved_mto_v11.py >/tmp/test_approved_mto_v11.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X owner default batch approval"; fi
run_test test_default_reference_v51.js "owner default reference batch"
if python3 scripts/test_approved_mto_v12.py >/tmp/test_approved_mto_v12.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X owner Parfum batch approval"; fi
run_test test_default_reference_v52.js "owner Parfum reference batch"
if python3 scripts/test_approved_mto_v13.py >/tmp/test_approved_mto_v13.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X owner default six approvals"; fi
run_test test_default_reference_v53.js "six sourced default references"
run_test test_generic_image_rebalance.js "approved neutral image balance"
if python3 scripts/test_approved_mto_v14.py >/tmp/test_approved_mto_v14.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X owner default three approvals"; fi
run_test test_default_reference_v54.js "three sourced default references"
if python3 scripts/test_approved_mto_v15.py >/tmp/test_approved_mto_v15.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X owner default two approvals"; fi
run_test test_default_reference_v55.js "two sourced default references"
if python3 scripts/test_approved_mto_v16.py >/tmp/test_approved_mto_v16.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X Coco owner approval"; fi
run_test test_generic_image_six.js "sixth symbolic image disclosure"
if python3 scripts/test_approved_mto_v17.py >/tmp/test_approved_mto_v17.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X EDT fallback approvals"; fi
run_test test_edt_reference_v57.js "five sourced EDT fallback references"
run_test test_hugo_versus_name.js "Hugo Versus name guard"
if python3 scripts/test_approved_mto_v13.py >/tmp/test_approved_mto_v13.log 2>&1; then P=$((P+1)); else F=$((F+1)); echo "  X owner default six approvals"; fi
run_test test_default_reference_v53.js "six sourced default references"
run_test test_journal_lcp.js "journal server-side render + LCP guards"
run_test test_invoice_legal.js "invoice: plain vs formal (legal info)"
run_test test_customer_note.js "customer note + label + real contact"
run_test test_sms_provider.js "sms layer: any provider, no key leak"
run_test test_audit_findings.js "audit: no hash leak, rate limits"

# سیاست «محتوای انبوه» گوگل: متادیتای یکتا، تطابق اسکیما با صفحه،
# مهار ایندکس. ربطی به AI بودن محتوا ندارد — الگوی قالبی را می‌گیرد.
run_test test_seo_ai_safety.js "seo: scaled-content-abuse safeguards"

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
sleep 2
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
[ "$F" -eq 0 ]
