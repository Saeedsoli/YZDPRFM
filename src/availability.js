'use strict';

function variantAvailability(mode, stock, price) {
  const n=Number(stock), amount=Number(price);
  if (!['IN_STOCK','MADE_TO_ORDER'].includes(mode) || !Number.isInteger(n) || n < 0 || !Number.isInteger(amount) || amount <= 0)
    return {state:'UNAVAILABLE',max_quantity:0};
  if (n > 0) return {state:'IN_STOCK',max_quantity:Math.min(Math.floor(n),50)};
  if (mode === 'MADE_TO_ORDER') return {state:'MADE_TO_ORDER',max_quantity:5};
  return {state:'UNAVAILABLE',max_quantity:0};
}
module.exports={variantAvailability};
