'use strict';

const {variantAvailability}=require('./availability');
const {isPublicVariant}=require('./variant-visibility');
const KEY='order_stock_reservations_schema_v1';
const DDL=`CREATE TABLE order_stock_reservations (
  item_id INTEGER PRIMARY KEY,
  reserved_qty INTEGER NOT NULL CHECK(reserved_qty >= 0),
  released INTEGER NOT NULL DEFAULT 0 CHECK(released IN (0,1)),
  FOREIGN KEY(item_id) REFERENCES order_items(id) ON DELETE CASCADE
)`;
const canonical=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
function ready(db){
 const table=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='order_stock_reservations'").get();
 const marker=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 return !!(table&&canonical(table.sql)===canonical(DDL)&&marker?.value==='1');
}
function install(db){return db.transaction(()=>{
 const t=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='order_stock_reservations'").get();
 const m=db.prepare('SELECT value FROM settings WHERE key=?').get(KEY);
 if(t||m){if(ready(db))return {reason:'already_installed'};throw Error('Reservation schema conflict');}
 db.exec(DDL);db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(KEY,'1');return {created:true};
})();}
function requireTransaction(db){if(!db.inTransaction)throw Error('Stock reservation requires a transaction');}
function reserveItem(db,itemId,options){
 requireTransaction(db);if(!ready(db))throw Error('Reservation schema unavailable');
 const r=db.prepare(`SELECT i.id,i.sku,i.quantity,i.unit_price,v.stock,v.price_toman,v.type,v.volume_ml,p.supply_mode
 FROM order_items i JOIN variants v ON v.sku=i.sku JOIN products p ON p.id=v.product_id WHERE i.id=?`).get(itemId);
 if(!r||!Number.isInteger(r.quantity)||r.quantity<1||r.unit_price!==r.price_toman||!isPublicVariant(r.type,r.volume_ml))throw Object.assign(Error('Cart changed'),{code:'CART_CHANGED'});

 const explicit=options&&Number.isInteger(options.numericQty)?options.numericQty:null;
 let reserved;
 if(explicit!==null){
  if(explicit<0||explicit>r.quantity||explicit>(Number(r.stock)||0))throw Object.assign(Error('Cart changed'),{code:'CART_CHANGED'});
  if(r.price_toman<=0)throw Object.assign(Error('Cart changed'),{code:'CART_CHANGED'});
  reserved=explicit;
 }else{
  const a=variantAvailability(r.supply_mode,r.stock,r.price_toman);
  if(a.state==='UNAVAILABLE'||r.quantity>a.max_quantity)throw Object.assign(Error('Cart changed'),{code:'CART_CHANGED'});
  reserved=a.state==='IN_STOCK'?r.quantity:0;
 }
 if(reserved&&db.prepare('UPDATE variants SET stock=stock-? WHERE sku=? AND stock>=?').run(reserved,r.sku,reserved).changes!==1)throw Object.assign(Error('Cart changed'),{code:'CART_CHANGED'});
 db.prepare('INSERT INTO order_stock_reservations(item_id,reserved_qty,released) VALUES(?,?,0)').run(itemId,reserved);
 return reserved;
}
function inspect(db,orderId){
 if(!ready(db))return {ok:false,reason:'schema_missing'};
 const rows=db.prepare(`SELECT i.id,i.sku,i.quantity,r.reserved_qty,r.released,v.sku AS current_sku
 FROM order_items i LEFT JOIN order_stock_reservations r ON r.item_id=i.id
 LEFT JOIN variants v ON v.sku=i.sku WHERE i.order_id=? ORDER BY i.id`).all(orderId);
 if(!rows.length)return {ok:false,reason:'no_items'};
 for(const r of rows){
  if(!Number.isInteger(r.quantity)||r.quantity<1||!Number.isInteger(r.reserved_qty)||r.reserved_qty<0||r.reserved_qty>r.quantity||r.released!==0)return {ok:false,reason:'legacy_or_invalid'};
  if(r.reserved_qty>0&&!r.current_sku)return {ok:false,reason:'variant_missing'};
 }
 return {ok:true,rows};
}
function release(db,orderId){
 requireTransaction(db);const plan=inspect(db,orderId);if(!plan.ok)return plan;
 const mark=db.prepare('UPDATE order_stock_reservations SET released=1 WHERE item_id=? AND released=0');
 const add=db.prepare('UPDATE variants SET stock=stock+? WHERE sku=?');const skus=[];
 for(const r of plan.rows){
  if(mark.run(r.id).changes!==1)throw Error('Reservation release conflict');
  if(r.reserved_qty>0){if(add.run(r.reserved_qty,r.sku).changes!==1)throw Error('Reserved variant missing');skus.push(r.sku);}
 }
 return {ok:true,skus:[...new Set(skus)]};
}
module.exports={KEY,ready,install,reserveItem,inspect,release};
