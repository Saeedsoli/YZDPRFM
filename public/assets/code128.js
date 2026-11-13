const C128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213',
  '221312','231212','112232','122132','122231','113222','123122','123221','223211','221132',
  '221231','213212','223112','312131','311222','321122','321221','312212','322112','322211',
  '212123','212321','232121','111323','131123','131321','112313','132113','132311','211313',
  '231113','231311','112133','112331','132131','113123','113321','133121','313121','211331',
  '231131','213113','213311','213131','311123','311321','331121','312113','312311','332111',
  '314111','221411','431111','111224','111422','121124','121421','141122','141221','112214',
  '112412','122114','122411','142112','142211','241211','221114','413111','241112','134111',
  '111242','121142','121241','114212','124112','124211','411212','421112','421211','212141',
  '214121','412121','111143','111341','131141','114113','114311','411113','411311','113141',
  '114131','311141','411131','211412','211214','211232','2331112'
];

const C128_START_B = 104;
const C128_START_C = 105;
const C128_CODE_B  = 100;
const C128_CODE_C  = 99;
const C128_STOP    = 106;

function c128Encode(text) {
  const s = String(text);
  const codes = [];

  const digitsFrom = i => {
    let n = 0;
    while (i + n < s.length && s[i + n] >= '0' && s[i + n] <= '9') n++;
    return n;
  };

  const worthC = i => digitsFrom(i) > 3;

  let mode = worthC(0) ? 'C' : 'B';
  codes.push(mode === 'C' ? C128_START_C : C128_START_B);

  let i = 0;
  let buffer = '';

  while (i < s.length) {
    const ch = s[i];
    const isDigit = ch >= '0' && ch <= '9';

    if (mode === 'C') {
      if (isDigit) {
        buffer += ch;
        if (buffer.length === 2) { codes.push(parseInt(buffer, 10)); buffer = ''; }
        i++;
        continue;
      }

      codes.push(C128_CODE_B);
      mode = 'B';
      if (buffer.length === 1) {
        codes.push(buffer.charCodeAt(0) - 32);
        buffer = '';
      }
      continue;
    }

    if (worthC(i)) { codes.push(C128_CODE_C); mode = 'C'; continue; }
    const v = ch.charCodeAt(0);
    codes.push((v >= 32 && v <= 126 ? v : 45) - 32);
    i++;
  }

  if (buffer.length === 1) {
    codes.push(C128_CODE_B);
    codes.push(buffer.charCodeAt(0) - 32);
  }

  if (codes[1] === C128_CODE_C) codes.splice(0, 2, C128_START_C);
  else if (codes[1] === C128_CODE_B) codes.splice(0, 2, C128_START_B);

  if (/^\d{2,3}$/.test(s)) {
    const c = [C128_START_C];
    if (s.length === 2) {
      c.push(parseInt(s, 10));
    } else {
      c.push(parseInt(s.substr(0, 2), 10), C128_CODE_B, s.charCodeAt(2) - 32);
    }
    let cs = c[0];
    for (let k = 1; k < c.length; k++) cs += c[k] * k;
    c.push(cs % 103, C128_STOP);
    return c;
  }

  let sum = codes[0];
  for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
  codes.push(sum % 103);
  codes.push(C128_STOP);

  return codes;
}

function code128SVG(text, opt = {}) {

  const label = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  const height = opt.height ?? 56;
  const mw = opt.moduleWidth ?? 2;
  const quiet = opt.quiet ?? 10;

  const codes = c128Encode(text);
  let x = quiet;
  const rects = [];

  for (const code of codes) {
    const pattern = C128_PATTERNS[code];
    let dark = true;
    for (const chWidth of pattern) {
      const w = parseInt(chWidth, 10) * mw;
      if (dark) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`);
      x += w;
      dark = !dark;
    }
  }

  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}"
    width="100%" height="${height}" shape-rendering="crispEdges"
    role="img" aria-label="بارکد ${label}">
    <rect width="${total}" height="${height}" fill="#FFF"/>
    <g fill="#000">${rects.join('')}</g>
  </svg>`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { c128Encode, code128SVG, C128_PATTERNS };
}
