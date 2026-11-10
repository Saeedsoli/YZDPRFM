'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public', 'assets', 'app.js'), 'utf8');

const sandbox = {
  window: {}, document: { addEventListener() {}, readyState: 'loading', querySelectorAll: () => [] },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { pathname: '/', search: '', href: '/' }, console, setTimeout, clearTimeout,
  fetch: () => Promise.reject(new Error('offline')), navigator: { language: 'fa', onLine: true }
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'app.js' });
const supply = sandbox.productSupply;
assert.equal(typeof supply, 'function', 'productSupply is exported to the page scope');

const variant = (o) => ({ type: 'EDP', volume_ml: 50, price_toman: 1000, stock: 0, ...o });

const catalogOut = { supply_mode: 'UNAVAILABLE', in_stock: false, min_price: 1000, variants: [variant({})] };
const wishlistOut = { supply_mode: 'UNAVAILABLE', min_price: 1000, variants: [variant({})] };
const catalogMto = { supply_mode: 'MADE_TO_ORDER', in_stock: false, min_price: 1000, variants: [variant({})] };
const wishlistMto = { supply_mode: 'MADE_TO_ORDER', min_price: 1000, variants: [variant({})] };
const catalogIn = { supply_mode: 'IN_STOCK', in_stock: true, min_price: 1000, variants: [variant({ stock: 3 })] };
const wishlistIn = { supply_mode: 'IN_STOCK', min_price: 1000, variants: [variant({ stock: 3 })] };
const hiddenVariantOnly = { supply_mode: 'IN_STOCK', in_stock: false, min_price: 1000, variants: [variant({ type: 'HAIR_MIST', stock: 9 })] };

for (const [label, input, expected] of [
  ['catalog unavailable', catalogOut, 'UNAVAILABLE'],
  ['wishlist unavailable', wishlistOut, 'UNAVAILABLE'],
  ['catalog made to order', catalogMto, 'MADE_TO_ORDER'],
  ['wishlist made to order', wishlistMto, 'MADE_TO_ORDER'],
  ['catalog in stock', catalogIn, 'IN_STOCK'],
  ['wishlist in stock', wishlistIn, 'IN_STOCK'],
  ['hidden variant does not count', hiddenVariantOnly, 'UNAVAILABLE']
]) {
  assert.equal(supply(input).state, expected, label);
}
assert.equal(supply(catalogOut).label, supply(wishlistOut).label, 'badge label is identical in both feeds');
assert.equal(supply(catalogOut).label, 'ناموجود');
assert.equal(supply(catalogMto).label, 'به سفارش');
assert.equal(supply(catalogIn).label, '');
assert.equal(supply(catalogOut).out, true);
assert(supply(catalogOut).classes.includes('is-out'));
assert(!supply(catalogMto).classes.includes('is-out'));
assert(supply(catalogMto).classes.includes('is-mto'));
assert.equal(supply(catalogOut).foot, 'خبرم کن');
assert.equal(supply(catalogMto).foot, 'مشاهده');
assert.equal(supply(catalogIn).foot, 'مشاهده');

const theme = fs.readFileSync(path.join(root, 'public', 'assets', 'theme.css'), 'utf8');
assert(/\.product-card\.is-out \.img-wrap img\s*\{[^}]*filter:\s*grayscale/.test(theme), 'unavailable cards dim the image');
assert(/\.card-out\s*\{/.test(theme) && /\.card-out\.mto\s*\{/.test(theme), 'badge styles exist for both states');

const wishlist = fs.readFileSync(path.join(root, 'public', 'wishlist.html'), 'utf8');
assert(wishlist.includes('productSupply(p)'), 'wishlist uses the shared state');
assert(!wishlist.includes('wishVariantAvailable'), 'no second availability rule in wishlist');
assert(wishlist.includes('card-go-notify'), 'wishlist shows the notify action for unavailable items');
assert(wishlist.includes('is-out') === false, 'wishlist relies on the shared card classes');

const product = fs.readFileSync(path.join(root, 'public', 'product.html'), 'utf8');
assert(product.includes("'ناموجود'"), 'product page uses the same wording');
const home = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
assert(home.includes('productSupply(p).label'), 'search suggestions use the shared label');
assert(!/sugg-out">ناموجود/.test(home), 'no duplicated wording rule left in suggestions');

console.log('PASS: one availability rule and one style for catalog, selection, wishlist and suggestions');
