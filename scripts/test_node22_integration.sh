#!/usr/bin/env bash
# Production-runtime verification on a disposable copy; never opens store data.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
if [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  echo 'Node 22 is required on PATH; refusing to claim production-runtime verification.' >&2
  exit 2
fi
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/yazd-node22-XXXXXXXX")
cleanup() { rm -rf -- "$STAGE"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# No Git history, SSH key, user data, local dependencies or caches in fixture.
tar -C "$ROOT" --exclude='./.git' --exclude='./.ssh' --exclude='./.env' --exclude='./.env.*' --exclude='./node_modules' --exclude='./data' --exclude='./.cache' --exclude='./.npm' -cf - . | tar -C "$STAGE" -xf -
mkdir -p "$STAGE/data"
cd "$STAGE"
# Do not inherit live payment, SMS, administrator or other credentials.
env -i PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" bash -s <<'ISOLATED'
set -euo pipefail
npm ci --no-audit --no-fund
node -e "const D=require('better-sqlite3');const d=new D(':memory:');console.log('Node '+process.version+', SQLite '+d.prepare('select sqlite_version() v').get().v);d.close()"
node scripts/test_backup_stream_safety.js
node scripts/test_joop_name_correction.js
node scripts/test_popular_persian_names.js
node scripts/test_amouage_common_names.js
node scripts/test_weekend_owner_correction.js
node scripts/test_essence_pricing.js
node scripts/test_essence_pricing_store.js
node scripts/test_product_essence_rollback.js
python3 scripts/test_product_essence_api.py
python3 scripts/test_unavailable_cart.py
python3 scripts/test_approved_mto.py
python3 scripts/test_approved_mto_v2.py
python3 scripts/test_approved_mto_v3.py
python3 scripts/test_approved_mto_v4.py
python3 scripts/test_approved_mto_v5.py
python3 scripts/test_approved_mto_v6.py
python3 scripts/test_approved_mto_v7.py
python3 scripts/test_approved_mto_v8.py
python3 scripts/test_approved_mto_v9.py
python3 scripts/test_approved_mto_v10.py
node scripts/test_generic_product_images.js
DB_PATH="$PWD/data/imagery-check.db" BACKUP_DISABLED=1 node scripts/test_images.js
node scripts/test_active_official_notes_v1.js
node scripts/test_active_official_notes_v2.js
node scripts/test_active_official_notes_v3.js
node scripts/test_cold_deploy.js
node scripts/test_node_platform_deploy.js
printf '\nPASS: Node 22 isolated runtime, pricing, cart, approvals and simulated deploy. No real Liara deployment.\n'
ISOLATED
