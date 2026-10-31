'use strict';
// Evidence that a reference original exists. It never verifies the supplier's
// actual essence, stock, listed quality or price, and does not modify products.
const fs=require('fs');
const HOST_BY_BRAND={
  'Creed':'www.creedfragrance.com','Amouage':'amouage.com','Kilian Paris':'www.bykilian.com',
  'Christian Dior':'www.dior.com','Jean Paul Gaultier':'www.jeanpaulgaultier.com',
  'Maison Francis Kurkdjian':'www.franciskurkdjian.com','Mugler':'inter.mugler.com','Giorgio Armani':'www.giorgioarmanibeauty-usa.com','Givenchy':'www.givenchybeauty.com','Initio Parfums Prives':'us.initioparfums.com','Tiziana Terenzi':'tizianaterenzi.com',
  'Bvlgari':'www.bulgari.com','Escentric Molecules':'www.escentric.com','Lancôme':'www.lancome-usa.com',
  'Carolina Herrera':'www.carolinaherrera.com','Le Labo':'www.lelabofragrances.com',
  'Montblanc':'www.montblanc.com','Nasomatto':'nasomatto.com','Orto Parisi':'ortoparisi.com',
  'Parfums de Marly':'us.parfums-de-marly.com',"Penhaligon's":'www.penhaligons.com',
  'Tom Ford':'www.tomfordbeauty.com','Byredo':'www.byredo.com','Versace':'www.versace.com',
  'Xerjoff':'www.xerjoff.com','Yves Saint Laurent':'www.yslbeautyus.com'
};
function seedOfficialIdentities(db,file){
 if(!fs.existsSync(file))return {added:0,skipped:0,reason:'file_missing'};
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 const counts={official_identity_evidence_v1:37,official_identity_evidence_v2:6,official_identity_evidence_v3:6,official_identity_evidence_v4:8,official_identity_evidence_v5:1,official_identity_evidence_v6:5,official_identity_evidence_v7:3,official_identity_evidence_v8:1,official_identity_evidence_v9:2};
 if(!Object.hasOwn(counts,m.version)||!Array.isArray(m.items)||m.items.length!==counts[m.version])throw new Error('Invalid identity evidence manifest');
 const ids=new Set();
 for(const x of m.items){
  let url;try{url=new URL(x.official_url);}catch{throw new Error('Invalid official source URL');}
  if(!/^(?:YZD-PROD-\d+|SUP-(?:XJ|AM|CR)-\d+)$/.test(x.product_id||'')||ids.has(x.product_id)||!x.slug||!x.reference_name||!x.expected_name_en||
    x.status!=='official_original_found_supplier_essence_unverified'||!/^\d{4}-\d{2}-\d{2}$/.test(x.checked_date||'')||
    !HOST_BY_BRAND[x.brand_en]||url.protocol!=='https:'||url.hostname!==HOST_BY_BRAND[x.brand_en]||url.username||url.password)throw new Error('Invalid identity evidence record');
  ids.add(x.product_id);
 }
 return db.transaction(()=>{
  db.exec(`CREATE TABLE IF NOT EXISTS official_identity_evidence (
    product_id TEXT PRIMARY KEY, reference_name TEXT NOT NULL, official_url TEXT NOT NULL,
    status TEXT NOT NULL, checked_date TEXT NOT NULL, manifest_version TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
  const find=db.prepare('SELECT id,slug,brand_en,name_en FROM products WHERE id=?');
  const insert=db.prepare(`INSERT INTO official_identity_evidence(product_id,reference_name,official_url,status,checked_date,manifest_version)
    VALUES(?,?,?,?,?,?) ON CONFLICT(product_id) DO NOTHING`);
  let added=0,skipped=0;
  for(const x of m.items){
    const p=find.get(x.product_id);
    if(!p||p.slug!==x.slug||p.brand_en!==x.brand_en||p.name_en!==x.expected_name_en){skipped++;continue;}
    const n=insert.run(x.product_id,x.reference_name,x.official_url,x.status,x.checked_date,m.version).changes;
    if(n)added++;else skipped++;
  }
  return {added,skipped};
 })();
}
module.exports={seedOfficialIdentities,HOST_BY_BRAND};
