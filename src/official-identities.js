'use strict';
// Evidence that a reference original exists. It never verifies the supplier's
// actual essence, stock, listed quality or price, and does not modify products.
const fs=require('fs');
const HOST_BY_BRAND={
  'Milton Lloyd':'milton-lloyd.com','Seris Parfums':'www.seris-parfums.com','Dolce & Gabbana':'www.dolcegabbana.com','Calvin Klein':'www.calvinklein.us','Paco Rabanne':'www.rabanne.com','Hermès':'www.hermes.com','Cartier':'www.cartier.com','Azzaro':'www.azzaro.com','Narciso Rodriguez':'www.narcisorodriguezparfums.com','BDK Parfums':'us.bdkparfums.com','Marc-Antoine Barrois':'us.marcantoinebarrois.com','Chanel':'www.chanel.com','Viktor & Rolf':'us.viktor-rolf.com','Alfred Dunhill':'www.dunhill.com','Burberry':'us.burberry.com','Lattafa Perfumes':'lattafa.com','Emper':'uae.emperperfumes.com','Kayali':'us.kayali.com','Evaflor':'www.evaflor.com','Sapil':'sapil.com','Hugo Boss':'www.hugoboss.com','Guerlain':'www.guerlain.com','Juicy Couture':'juicycouture.com','Jaguar':'jaguar-fragrances.com','Nautica':'www.nautica.com','Guy Laroche':'www.guylaroche.com','Juliette Has A Gun':'us.juliettehasagun.com','Lacoste':'www.lacoste.com','Ralph Lauren':'www.ralphlaurenfragrances.com',"Victoria's Secret":'www.victoriassecret.com','Shiseido':'www.shiseido.com','Gucci':'www.gucci.com','Clive Christian':'us.clivechristian.com','Bentley':'bentley-fragrances.com','Lalique':'us.lalique.com','Ex Nihilo':'us.ex-nihilo-paris.com','Ariana Grande':'arianagrandefragrances.com','Atkinsons':'www.atkinsons1799.com','Creed':'www.creedfragrance.com','Amouage':'amouage.com','Kilian Paris':'www.bykilian.com',
  'Christian Dior':'www.dior.com','Jean Paul Gaultier':'www.jeanpaulgaultier.com',
  'Maison Francis Kurkdjian':'www.franciskurkdjian.com','Mugler':'inter.mugler.com','Giorgio Armani':'www.giorgioarmanibeauty-usa.com','Givenchy':'www.givenchybeauty.com','Initio Parfums Prives':'us.initioparfums.com','Tiziana Terenzi':'tizianaterenzi.com',
  'Bvlgari':'www.bulgari.com','Escentric Molecules':'www.escentric.com','Lancôme':'www.lancome-usa.com',
  'Carolina Herrera':'www.carolinaherrera.com','Le Labo':'www.lelabofragrances.com',
  'Memo Paris':'us.memoparis.com','Caron Paris':'www.parfumscaron.com','Montblanc':'www.montblanc.com','Nasomatto':'nasomatto.com','Orto Parisi':'ortoparisi.com',
  'Parfums de Marly':'us.parfums-de-marly.com',"Penhaligon's":'www.penhaligons.com',
  'Tom Ford':'www.tomfordbeauty.com','Byredo':'www.byredo.com','Versace':'www.versace.com',
  'Casamorati':'www.xerjoff.com','Xerjoff':'www.xerjoff.com','Yves Saint Laurent':'www.yslbeautyus.com'
};
function seedOfficialIdentities(db,file){
 if(!fs.existsSync(file))return {added:0,skipped:0,reason:'file_missing'};
 const m=JSON.parse(fs.readFileSync(file,'utf8'));
 const counts={official_identity_evidence_v1:37,official_identity_evidence_v2:6,official_identity_evidence_v3:6,official_identity_evidence_v4:8,official_identity_evidence_v5:1,official_identity_evidence_v6:5,official_identity_evidence_v7:3,official_identity_evidence_v8:1,official_identity_evidence_v9:2,official_identity_evidence_v10:6,official_identity_evidence_v11:5,official_identity_evidence_v12:5,official_identity_evidence_v13:7,official_identity_evidence_v14:6,official_identity_evidence_v15:6,official_identity_evidence_v16:2,official_identity_evidence_v17:1,official_identity_evidence_v18:2,official_identity_evidence_v19:2,official_identity_evidence_v20:4,official_identity_evidence_v21:2,official_identity_evidence_v22:3,official_identity_evidence_v23:1,official_identity_evidence_v24:3,official_identity_evidence_v25:2,official_identity_evidence_v26:1,official_identity_evidence_v27:6,official_identity_evidence_v28:6,official_identity_evidence_v29:6,official_identity_evidence_v30:8,official_identity_evidence_v31:8,official_identity_evidence_v32:8,official_identity_evidence_v33:8,official_identity_evidence_v34:8,official_identity_evidence_v35:8,official_identity_evidence_v36:7,official_identity_evidence_v37:1,official_identity_evidence_v38:2};
 if(!Object.hasOwn(counts,m.version)||!Array.isArray(m.items)||m.items.length!==counts[m.version])throw new Error('Invalid identity evidence manifest');
 const ids=new Set();
 for(const x of m.items){
  let url;try{url=new URL(x.official_url);}catch{throw new Error('Invalid official source URL');}
  if(!/^(?:YZD-PROD-\d+|SUP-(?:XJ|AM|CR|MB|EX|AT|AG|GC|LC|LL|RL|VS|SH|JC|JG|NT|GL|JH|GU|BS|SP|EP|KY|EV|CH|DG|SE|ML)-\d+)$/.test(x.product_id||'')||ids.has(x.product_id)||!x.slug||!x.reference_name||!x.expected_name_en||
    x.status!=='official_original_found_supplier_essence_unverified'||!/^\d{4}-\d{2}-\d{2}$/.test(x.checked_date||'')||(x.expected_concentration!==undefined&&(typeof x.expected_concentration!=='string'||!x.expected_concentration.trim()))||
    !HOST_BY_BRAND[x.brand_en]||url.protocol!=='https:'||url.hostname!==HOST_BY_BRAND[x.brand_en]||url.username||url.password)throw new Error('Invalid identity evidence record');
  ids.add(x.product_id);
 }
 return db.transaction(()=>{
  db.exec(`CREATE TABLE IF NOT EXISTS official_identity_evidence (
    product_id TEXT PRIMARY KEY, reference_name TEXT NOT NULL, official_url TEXT NOT NULL,
    status TEXT NOT NULL, checked_date TEXT NOT NULL, manifest_version TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  )`);
  const find=db.prepare('SELECT id,slug,brand_en,name_en,concentration FROM products WHERE id=?');
  const insert=db.prepare(`INSERT INTO official_identity_evidence(product_id,reference_name,official_url,status,checked_date,manifest_version)
    VALUES(?,?,?,?,?,?) ON CONFLICT(product_id) DO NOTHING`);
  let added=0,skipped=0;
  for(const x of m.items){
    const p=find.get(x.product_id);
    if(!p||p.slug!==x.slug||p.brand_en!==x.brand_en||p.name_en!==x.expected_name_en||(x.expected_concentration!==undefined&&p.concentration!==x.expected_concentration)){skipped++;continue;}
    const n=insert.run(x.product_id,x.reference_name,x.official_url,x.status,x.checked_date,m.version).changes;
    if(n)added++;else skipped++;
  }
  return {added,skipped};
 })();
}
module.exports={seedOfficialIdentities,HOST_BY_BRAND};
