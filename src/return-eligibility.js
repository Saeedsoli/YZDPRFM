'use strict';

const WINDOW_MS = 72 * 60 * 60 * 1000;
function eligibility({verifiedMobile, order, item, deliveredAtMs, nowMs, hasOpenRequest}) {
  if (!/^09\d{9}$/.test(String(verifiedMobile || '')) || !order || order.mobile !== verifiedMobile)
    return {eligible:false, reason:'OWNER_REQUIRED'};
  if (!item || item.order_id !== order.order_id || !Number.isSafeInteger(item.id) || item.id <= 0)
    return {eligible:false, reason:'ITEM_UNAVAILABLE'};
  if (order.status !== 'DELIVERED') return {eligible:false, reason:'NOT_DELIVERED'};

  if (!Number.isSafeInteger(item.volume_ml) || item.volume_ml <= 0)
    return {eligible:false, reason:'VOLUME_UNAVAILABLE'};
  if (item.volume_ml <= 10) return {eligible:false, reason:'VOLUME_INELIGIBLE'};
  if (!Number.isSafeInteger(deliveredAtMs) || !Number.isSafeInteger(nowMs) || deliveredAtMs <= 0 || deliveredAtMs > nowMs)
    return {eligible:false, reason:'DELIVERY_TIME_UNAVAILABLE'};
  const deadlineMs=deliveredAtMs+WINDOW_MS;
  if (!Number.isSafeInteger(deadlineMs)) return {eligible:false, reason:'DELIVERY_TIME_UNAVAILABLE'};
  if (nowMs >= deadlineMs) return {eligible:false, reason:'EXPIRED', deadlineMs};
  if (hasOpenRequest !== false) return {eligible:false, reason:'REQUEST_OPEN', deadlineMs};
  return {eligible:true, deadlineMs};
}
module.exports = {WINDOW_MS, eligibility};
