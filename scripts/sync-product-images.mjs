import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const productFile = path.join(root, "data", "products.json");
const imageDirectory = path.join(root, "assets", "products");
const supported = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const pattern = /^(\d+)__([^_]+)__(front|back)__(10|[0-9])\.(jpg|jpeg|png|webp|avif)$/i;

const products = JSON.parse(await readFile(productFile, "utf8"));
const productById = new Map(products.map((product) => [String(product.id), product]));
const files = await readdir(imageDirectory);
const errors = [];

for (const filename of files) {
  const extension = path.extname(filename).toLowerCase();
  if (!supported.has(extension)) continue;
  const match = filename.match(pattern);
  if (!match) {
    errors.push(`${filename}: forventet VARENR__Produsent-Modell__front|back__GRAD.ext`);
    continue;
  }

  const [, id, productSlug, side, grade] = match;
  const product = productById.get(id);
  if (!product) {
    errors.push(`${filename}: varenummer ${id} finnes ikke i data/products.json`);
    continue;
  }
  if (Number(grade) !== Number(product.grade)) {
    errors.push(`${filename}: grad ${grade} er ulik graden ${product.grade} i produktdataene`);
    continue;
  }

  const expectedSlug = `${product.manufacturer}-${product.model}`
    .normalize("NFKD")
    .replace(/[°]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const actualSlug = productSlug.toLowerCase();
  if (actualSlug !== expectedSlug) {
    errors.push(`${filename}: produktnavnet bør være ${expectedSlug}`);
    continue;
  }

  product.images ??= {};
  product.images[side.toLowerCase()] = `./assets/products/${filename}`;
}

if (errors.length) {
  console.error("Fant problemer med produktbildene:\n" + errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  await writeFile(productFile, `${JSON.stringify(products, null, 2)}\n`);
  console.log(`Koblet produktbilder for ${products.length} produkter.`);
}
