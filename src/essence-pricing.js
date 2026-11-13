'use strict';

function decimal(value, label) {
  const s = String(value).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) throw new Error(`${label}: invalid non-negative decimal`);
  const [whole, fraction = ''] = s.split('.');
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
function positive(value, label) {
  const [n,d] = decimal(value,label);
  if (n <= 0n) throw new Error(`${label}: must be positive`);
  return [n,d];
}
function round1000(n,d) {
  const divisor=d*1000n;
  const result=((n*2n+divisor)/(2n*divisor))*1000n;
  if (result>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('price exceeds safe integer');
  return Number(result);
}

function priceFromUsdPerKg(usdPerKg, usdRateToman, type, volumeMl) {
  const [u,ud]=positive(usdPerKg,'usdPerKg');
  const [r,rd]=positive(usdRateToman,'usdRateToman');
  let multiplier, divisor;
  if (type === 'SAMPLE' || type === 'EDP') {
    const [v,vd]=positive(volumeMl,'volumeMl');
    multiplier=v*3n; divisor=vd*5n;
  } else if (type === 'BODY_SPLASH') {
    if (Number(volumeMl)!==120) throw new Error('body splash volume must be 120 ml');
    multiplier=15n; divisor=1n;
  } else throw new Error('unsupported variant type');
  return round1000(u*r*multiplier,ud*rd*1000n*divisor);
}
module.exports={priceFromUsdPerKg};
