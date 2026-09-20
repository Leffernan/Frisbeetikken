import { readFile } from "node:fs/promises";

const products = JSON.parse(await readFile(new URL("../data/products.json", import.meta.url), "utf8"));
const ids = new Set();
for (const product of products) {
  if (!product.id || ids.has(product.id)) throw new Error(`Ugyldig eller duplisert varenummer: ${product.id}`);
  if (!product.manufacturer || !product.model) throw new Error(`Produkt ${product.id} mangler produsent eller modell`);
  if (!Number.isFinite(product.price) || product.price < 0) throw new Error(`Produkt ${product.id} har ugyldig pris`);
  if (!Number.isInteger(product.grade) || product.grade < 0 || product.grade > 10) throw new Error(`Produkt ${product.id} har ugyldig grad`);
  ids.add(product.id);
}
console.log(`Validerte ${products.length} produkter.`);
