'use strict';

(function () {
  const allowed = new Set([
    'addToCart','applyCoupon','applyExchangeRateUI','applyProductEssenceUI','applySearch','bulkPrice','bulkStock',
    'cancelEditArticle','chQty','changeStatus','clearFilter','clearOrderSearch','clearSearch','commitStock','copyLink',
    'createCampaign','createCoupon','createNotice','delArticle','delCoupon','delInvite','delReview','deleteCampaign',
    'deleteNotice','deleteRole','deleteStaff','dlBackup','downloadBackup','downloadReport','editArticle','editMyReview',
    'editProduct','exportCsv','filterStatus','finish','go','goBack','goOrderPage','insertAparat','insertPickedImage',
    'insertQuote','invalidateEssencePreview','invalidateExchangePreview','inventorySearch','ivCopy','ivCopyText','ivPick',
    'ivSearch','jumpToTab','loadAnalytics','loadAudit','loadInventory','loadLogs','loadOrders','loadProducts',
    'loadProfile','loadReadiness','loadReports','loadReviews','login','logout','makeInvite','notifyMe','onCouponType',
    'openPasswordChange','openRoleForm','openStaffForm','pick','pickBrand','pickStar','previewExchangeRateUI',
    'previewProductEssenceUI','publish','refreshShowcase','removeCoupon','replyReview','replyTicket','resetQuiz',
    'runMaintenance','runReindex','saveEssenceStock','saveMakerNote','saveProfile','saveRole','saveShopSettings',
    'saveStaff','saveSupplyMode','saveVariant','scrollToReviews','selectOption','sendTestSms','setReview','shareTo',
    'showRolePerms','stepStock','submit','submitPasswordChange','submitReview','toggleCampaign','toggleCoupon',
    'toggleGroup','toggleNotice','toggleWish','uploadArticleImage'
  ]);

  function splitTop(source, delimiter) {
    const out = [];
    let start = 0, depth = 0, quote = '', escaped = false;
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") { quote = c; continue; }
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === delimiter && depth === 0) { out.push(source.slice(start, i).trim()); start = i + 1; }
    }
    out.push(source.slice(start).trim());
    return out.filter(Boolean);
  }

  function stringValue(s) {
    const q = s[0], raw = s.slice(1, -1);
    if (q === '"') {
      try { return JSON.parse(s); } catch { return null; }
    }
    return raw.replace(/\\(\\|"|'|n|r|t|b|f|v|0)/g, (_, c) => {
      const map = { n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', v:'\v', '0':'\0' };
      return map[c] === undefined ? c : map[c];
    });
  }

  function valueOf(source, event, element) {
    const s = source.trim();
    if (s === 'this') return element;
    if (s === 'event') return event;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s === 'null') return null;
    if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
    if ((s[0] === '"' && s.at(-1) === '"') || (s[0] === "'" && s.at(-1) === "'")) return stringValue(s);
    return undefined;
  }

  function invoke(source, event, element) {
    const call = source.trim().match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)$/);
    if (!call || !allowed.has(call[1])) return false;
    const fn = window[call[1]];
    if (typeof fn !== 'function') return false;
    const args = call[2].trim() ? splitTop(call[2], ',').map(x => valueOf(x, event, element)) : [];
    if (args.some(x => x === undefined)) return false;
    fn.apply(window, args);
    return true;
  }

  function runStatements(source, event, element) {
    let s = source.trim();
    const conditional = s.match(/^if\s*\(\s*event\.key\s*===\s*(['"])([^'"]+)\1\s*\)\s*([\s\S]+)$/);
    if (conditional) {
      if (event.key !== conditional[2]) return;
      s = conditional[3].trim();
      if (s[0] === '{' && s.at(-1) === '}') s = s.slice(1, -1).trim();
    }
    for (const statement of splitTop(s, ';')) {
      if (statement === 'event.preventDefault()') { event.preventDefault(); continue; }
      if (statement === 'inventoryPage++' || statement === 'inventoryPage--') {
        if (typeof window.inventoryPage !== 'number') return;
        window.inventoryPage += statement.endsWith('++') ? 1 : -1;
        continue;
      }
      if (statement === 'location.reload()') { location.reload(); return; }
      const href = statement.match(/^location\.href\s*=\s*(['"])(.*?)\1$/);
      if (href) { location.href = href[2]; return; }
      const dom = statement.match(/^document\.getElementById\((['"])([A-Za-z0-9_-]+)\1\)\.(click|remove)\(\)$/);
      if (dom && ['aFile','pwModal','roleForm','staffForm'].includes(dom[2])) {
        const target = document.getElementById(dom[2]);
        if (target) target[dom[3]]();
        continue;
      }
      const addClass = statement.match(/^document\.getElementById\((['"])([A-Za-z0-9_-]+)\1\)\.classList\.add\((['"])([A-Za-z0-9_-]+)\3\)$/);
      if (addClass && ['roleForm','staffForm'].includes(addClass[2]) && addClass[4] === 'hidden') {
        document.getElementById(addClass[2])?.classList.add('hidden');
        continue;
      }
      if (invoke(statement, event, element)) continue;
      return;
    }
    if (/^if\s*\(\s*event\.key/.test(source) && typeof window.loadInventory === 'function'
        && /inventoryPage=1;?\s*loadInventory\(\)/.test(source) && typeof window.inventoryPage === 'number') {
      window.inventoryPage = 1;
      window.loadInventory();
    }
  }

  document.addEventListener('click', event => {
    const el = event.target.closest('[data-csp-click]');
    if (el) runStatements(el.getAttribute('data-csp-click'), event, el);
  });
  document.addEventListener('change', event => {
    const el = event.target.closest('[data-csp-change]');
    if (el) runStatements(el.getAttribute('data-csp-change'), event, el);
  });
  document.addEventListener('input', event => {
    const el = event.target.closest('[data-csp-input]');
    if (el) runStatements(el.getAttribute('data-csp-input'), event, el);
  });
  document.addEventListener('submit', event => {
    const el = event.target.closest('[data-csp-submit]');
    if (el) runStatements(el.getAttribute('data-csp-submit'), event, el);
  });
  document.addEventListener('keydown', event => {
    const el = event.target.closest('[data-csp-keydown]');
    if (el) runStatements(el.getAttribute('data-csp-keydown'), event, el);
  });
  document.addEventListener('keyup', event => {
    const el = event.target.closest('[data-csp-keyup]');
    if (el) runStatements(el.getAttribute('data-csp-keyup'), event, el);
  });
  document.addEventListener('error', event => {
    const el = event.target;
    if (!el || !el.matches || !el.matches('[data-csp-error]')) return;
    const action = el.getAttribute('data-csp-error') || '';
    const fallback = action.match(/this\.src\s*=\s*(['"])(.*?)\1/);
    if (/dataset\.fallback/.test(action)) {
      const src = el.dataset.fallback;
      el.removeAttribute('data-csp-error');
      if (src) el.src = src;
      return;
    }
    if (/dataset\.alt/.test(action)) {
      if (!el.dataset.alt) {
        el.dataset.alt = '1';
        if (fallback) el.src = fallback[2];
      } else {
        el.closest('figure')?.remove();
      }
      return;
    }
    if (fallback) { el.removeAttribute('data-csp-error'); el.src = fallback[2]; }
  }, true);
})();
