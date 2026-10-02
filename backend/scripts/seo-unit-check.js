const seo = require("../utils/seo");

const evil = {
  id: 1,
  title: "</script><img src=x onerror=alert(1)>",
  description: 'a & b "q" <b>bold</b>',
  price: 1500000,
  status: "available",
  assetType: "website",
  protected: true,
  level: 5,
  tech_stack: "React, Node",
  thumbnail: "https://cdn.example.com/x.png",
};

console.log("path    :", seo.listingPath(evil));
console.log("url     :", seo.listingUrl(evil));
console.log("title   :", seo.titleFor(evil));
console.log("desc    :", seo.descriptionFor(evil));
console.log("parse   :", seo.parseListingSlug("12-my-title"), seo.parseListingSlug("12"), seo.parseListingSlug("abc"), seo.parseListingSlug("../../etc/passwd"));
console.log("jsonld  :", seo.jsonLd(seo.productLd(evil)).slice(0, 200));
console.log("meta    :\n" + seo.metaBlock({ title: seo.titleFor(evil), description: seo.descriptionFor(evil), url: seo.listingPath(evil), type: "product" }));

const long = { id: 2, title: "x".repeat(200), description: "y ".repeat(400), price: 500 };
console.log("longtitle len:", seo.titleFor(long).length);
console.log("longdesc  len:", seo.descriptionFor(long).length);

const norm = { id: 3, title: "Boutique E-Commerce Store", price: 250000, status: "sold", assetType: "business" };
console.log("norm path:", seo.listingPath(norm));
console.log("norm slug sold:", seo.productLd(norm).offers.availability);