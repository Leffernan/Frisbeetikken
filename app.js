import { config } from "./config.js";

const state = {
  products: [],
  cart: JSON.parse(localStorage.getItem("frisbeetikken-cart") || "[]"),
  activeProduct: null,
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const money = new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 });

const elements = {
  grid: $("#product-grid"),
  count: $("#result-count"),
  empty: $("#empty-state"),
  search: $("#search"),
  manufacturer: $("#manufacturer-filter"),
  grade: $("#grade-filter"),
  sort: $("#sort"),
  cartDrawer: $("#cart-drawer"),
  cartItems: $("#cart-items"),
  cartEmpty: $("#cart-empty"),
  cartSummary: $("#cart-summary"),
  backdrop: $("#backdrop"),
  productDialog: $("#product-dialog"),
  checkoutDialog: $("#checkout-dialog"),
  toast: $("#toast"),
};

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;" })[char]);
}

function placeholderImage(product, side = "front") {
  const label = side === "front" ? product.model : "BAKSIDE";
  const sub = side === "front" ? product.manufacturer : `VARE ${product.id}`;
  const rotation = side === "front" ? -8 : 7;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700">
      <defs>
        <radialGradient id="bg"><stop offset="0" stop-color="#f4f4ed"/><stop offset="1" stop-color="#dde1d2"/></radialGradient>
        <radialGradient id="disc"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".45" stop-color="${escapeXml(product.color || "#d2ff00")}"/><stop offset="1" stop-color="#111112" stop-opacity=".18"/></radialGradient>
        <filter id="s"><feDropShadow dx="10" dy="20" stdDeviation="18" flood-opacity=".22"/></filter>
      </defs>
      <rect width="700" height="700" fill="url(#bg)"/>
      <g transform="rotate(${rotation} 350 350)" filter="url(#s)">
        <ellipse cx="350" cy="365" rx="265" ry="252" fill="#111112" opacity=".15"/>
        <circle cx="350" cy="335" r="258" fill="url(#disc)" stroke="#fff" stroke-opacity=".35" stroke-width="7"/>
        <circle cx="350" cy="335" r="207" fill="none" stroke="#111112" stroke-opacity=".2" stroke-width="3"/>
        <circle cx="350" cy="335" r="175" fill="none" stroke="#111112" stroke-opacity=".18" stroke-width="2" stroke-dasharray="8 10"/>
        <text x="350" y="316" fill="#111112" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" letter-spacing="4">${escapeXml(sub.toUpperCase())}</text>
        <text x="350" y="369" fill="#111112" text-anchor="middle" font-family="Arial,sans-serif" font-size="48" font-weight="800">${escapeXml(label.toUpperCase())}</text>
        <text x="350" y="407" fill="#111112" fill-opacity=".72" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="3">FRISBEETIKKEN</text>
      </g>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function productSlug(product) {
  return `${product.manufacturer}-${product.model}`
    .normalize("NFKD")
    .replace(/[°]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function productImageCandidates(product, side = "front") {
  if (product.images?.[side]) return [product.images[side]];
  const base = `./assets/products/${product.id}__${productSlug(product)}__${side}__${product.grade}`;
  return ["jpg", "jpeg", "png", "webp", "avif"].map((extension) => `${base}.${extension}`);
}

function applyProductImage(image, product, side = "front") {
  const candidates = productImageCandidates(product, side);
  let index = 0;
  image.onerror = () => {
    if (index < candidates.length) {
      image.src = candidates[index++];
    } else {
      image.onerror = null;
      image.src = placeholderImage(product, side);
    }
  };
  image.src = candidates[index++];
}

async function loadProducts() {
  try {
    if (isSupabaseReady()) {
      const response = await fetch(
        `${config.supabaseUrl}/rest/v1/products?select=*&status=in.(available,reserved)&order=created_at.desc`,
        { headers: supabaseHeaders() },
      );
      if (!response.ok) throw new Error("Kunne ikke hente varer fra Supabase");
      const rows = await response.json();
      state.products = rows.map(fromDatabaseProduct);
    } else {
      const response = await fetch("./data/products.json");
      if (!response.ok) throw new Error("Kunne ikke hente demo-varene");
      state.products = await response.json();
    }
    state.cart = state.cart.filter((id) => state.products.some((product) => product.id === id && product.status === "available"));
    populateManufacturerFilter();
    renderProducts();
    renderCart();
  } catch (error) {
    elements.grid.innerHTML = `<p class="form-status error">${error.message}. Last siden på nytt og prøv igjen.</p>`;
  }
}

function fromDatabaseProduct(row) {
  return {
    id: row.id,
    manufacturer: row.manufacturer,
    model: row.model,
    price: Number(row.price),
    grade: Number(row.grade),
    weight: row.weight,
    plastic: row.plastic,
    rimInk: row.rim_ink || "no",
    note: row.note?.replace(/\bdisc\b/gi, "disk"),
    createdAt: row.created_at,
    status: row.status,
    images: { front: row.image_front || "", back: row.image_back || "" },
    color: row.color || "#d2ff00",
  };
}

function rimInkLabel(value) {
  return ({ no: "Nei", barely: "Så vidt", yes: "Ja" })[value] || "Nei";
}

function supabaseHeaders() {
  return { apikey: config.supabasePublishableKey, "Content-Type": "application/json" };
}

function isSupabaseReady() {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey);
}

function populateManufacturerFilter() {
  const manufacturers = [...new Set(state.products.map((product) => product.manufacturer))].sort((a, b) => a.localeCompare(b, "nb"));
  elements.manufacturer.insertAdjacentHTML(
    "beforeend",
    manufacturers.map((manufacturer) => `<option value="${escapeXml(manufacturer)}">${escapeXml(manufacturer)}</option>`).join(""),
  );
}

function visibleProducts() {
  const query = elements.search.value.trim().toLocaleLowerCase("nb");
  const manufacturer = elements.manufacturer.value;
  const minimumGrade = Number(elements.grade.value);
  const products = state.products.filter((product) => {
    const haystack = `${product.manufacturer} ${product.model} ${product.plastic} ${product.id}`.toLocaleLowerCase("nb");
    return (!query || haystack.includes(query)) &&
      (manufacturer === "all" || product.manufacturer === manufacturer) &&
      product.grade >= minimumGrade;
  });

  const sorters = {
    newest: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    "price-asc": (a, b) => a.price - b.price,
    "price-desc": (a, b) => b.price - a.price,
    "grade-desc": (a, b) => b.grade - a.grade,
    "grade-asc": (a, b) => a.grade - b.grade,
  };
  return products.sort(sorters[elements.sort.value]);
}

function renderProducts() {
  const products = visibleProducts();
  elements.grid.innerHTML = "";
  elements.count.textContent = `${products.length} ${products.length === 1 ? "disk" : "disker"}`;
  elements.empty.hidden = products.length !== 0;

  for (const product of products) {
    const card = $("#product-card-template").content.cloneNode(true);
    const openButton = $(".product-open", card);
    const addButton = $(".add-button", card);
    const image = $(".product-image", card);
    applyProductImage(image, product);
    image.alt = `${product.manufacturer} ${product.model}, sett forfra`;
    $(".product-maker", card).textContent = product.manufacturer;
    $(".product-name", card).textContent = product.model;
    $(".product-plastic", card).textContent = product.plastic || "Ukjent plast";
    $(".product-weight", card).textContent = product.weight ? `${product.weight} g` : "Ukjent vekt";
    $(".product-price", card).textContent = money.format(product.price);
    $(".grade-badge", card).textContent = `${product.grade}/10`;
    $(".status-badge", card).textContent = product.status === "reserved" ? "Reservert" : "";
    openButton.setAttribute("aria-label", `Se ${product.manufacturer} ${product.model}`);
    openButton.addEventListener("click", () => openProduct(product));
    addButton.disabled = product.status !== "available" || state.cart.includes(product.id);
    addButton.innerHTML = state.cart.includes(product.id)
      ? `I handlekurven <span aria-hidden="true">✓</span>`
      : product.status === "reserved"
        ? "Allerede reservert"
        : `Legg i kurv <span aria-hidden="true">＋</span>`;
    addButton.addEventListener("click", () => addToCart(product.id));
    elements.grid.append(card);
  }
}

function openProduct(product) {
  state.activeProduct = product;
  const available = product.status === "available";
  $("#product-dialog-content").innerHTML = `
    <div class="product-detail">
      <div class="detail-gallery">
        <img id="detail-image" alt="${escapeXml(product.manufacturer)} ${escapeXml(product.model)}, sett forfra" />
        <div class="gallery-buttons">
          <button class="active" type="button" data-side="front">Forside</button>
          <button type="button" data-side="back">Bakside</button>
        </div>
      </div>
      <div class="detail-copy">
        <p class="eyebrow">${escapeXml(product.manufacturer)}</p>
        <h2 id="dialog-product-name">${escapeXml(product.model)}</h2>
        <p class="detail-price">${money.format(product.price)}</p>
        <div class="detail-facts">
          <div><span>Grad</span><strong>${product.grade}/10</strong></div>
          <div><span>Vekt</span><strong>${product.weight ? `${product.weight} g` : "–"}</strong></div>
          <div><span>Plast</span><strong>${escapeXml(product.plastic || "–")}</strong></div>
          <div><span>Ink i rim</span><strong>${rimInkLabel(product.rimInk)}</strong></div>
        </div>
        <p class="detail-note">${escapeXml(product.note || "Ingen merknader registrert.")}</p>
        <p class="detail-number">Varenummer ${escapeXml(product.id)}</p>
        <button class="primary-button" id="detail-add" type="button" ${!available || state.cart.includes(product.id) ? "disabled" : ""}>
          ${product.status === "reserved" ? "Allerede reservert" : state.cart.includes(product.id) ? "Ligger i handlekurven" : "Legg i handlekurven"}
        </button>
      </div>
    </div>`;
  applyProductImage($("#detail-image"), product);
  $$("[data-side]", elements.productDialog).forEach((button) => {
    button.addEventListener("click", () => {
      const side = button.dataset.side;
      const detailImage = $("#detail-image");
      applyProductImage(detailImage, product, side);
      detailImage.alt = `${product.manufacturer} ${product.model}, ${side === "front" ? "sett forfra" : "sett bakfra"}`;
      $$("[data-side]", elements.productDialog).forEach((item) => item.classList.toggle("active", item === button));
    });
  });
  $("#detail-add").addEventListener("click", () => {
    addToCart(product.id);
    elements.productDialog.close();
  });
  elements.productDialog.showModal();
}

function addToCart(id) {
  const product = state.products.find((item) => item.id === id);
  if (!product || product.status !== "available" || state.cart.includes(id)) return;
  state.cart.push(id);
  persistCart();
  renderProducts();
  renderCart();
  showToast(`${product.model} er lagt i handlekurven`);
}

function removeFromCart(id) {
  state.cart = state.cart.filter((item) => item !== id);
  persistCart();
  renderProducts();
  renderCart();
}

function persistCart() {
  localStorage.setItem("frisbeetikken-cart", JSON.stringify(state.cart));
}

function cartProducts() {
  return state.cart.map((id) => state.products.find((product) => product.id === id)).filter(Boolean);
}

function renderCart() {
  const products = cartProducts();
  $("#cart-count").textContent = products.length;
  elements.cartItems.innerHTML = products.map((product) => `
    <article class="cart-item">
      <img data-cart-image="${escapeXml(product.id)}" alt="" />
      <div>
        <p>${escapeXml(product.manufacturer)}</p>
        <h3>${escapeXml(product.model)}</h3>
        <p>Grad ${product.grade}/10 · ${escapeXml(product.plastic || "")}</p>
        <strong>${money.format(product.price)}</strong>
      </div>
      <button class="remove-item" type="button" data-remove="${escapeXml(product.id)}">Fjern</button>
    </article>`).join("");
  $$('[data-cart-image]', elements.cartItems).forEach((image) => {
    const product = state.products.find((item) => item.id === image.dataset.cartImage);
    if (product) applyProductImage(image, product);
  });
  $$('[data-remove]', elements.cartItems).forEach((button) => button.addEventListener("click", () => removeFromCart(button.dataset.remove)));
  elements.cartEmpty.hidden = products.length > 0;
  elements.cartSummary.hidden = products.length === 0;
  $("#cart-quantity").textContent = products.length;
  $("#cart-total").textContent = money.format(products.reduce((sum, product) => sum + product.price, 0));
}

function openCart() {
  elements.backdrop.hidden = false;
  elements.cartDrawer.classList.add("open");
  elements.cartDrawer.setAttribute("aria-hidden", "false");
  document.body.classList.add("locked");
  $("#close-cart").focus();
}

function closeCart() {
  elements.cartDrawer.classList.remove("open");
  elements.cartDrawer.setAttribute("aria-hidden", "true");
  elements.backdrop.hidden = true;
  document.body.classList.remove("locked");
}

function openCheckout() {
  closeCart();
  const ready = isSupabaseReady();
  $("#setup-notice").hidden = ready;
  $("#submit-order").disabled = !ready;
  elements.checkoutDialog.showModal();
}

async function submitOrder(event) {
  event.preventDefault();
  if (!isSupabaseReady()) return;
  const button = $("#submit-order");
  const status = $("#form-status");
  const data = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  button.textContent = "Reserverer …";
  status.className = "form-status full-width";
  status.textContent = "";

  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/reserve_order`, {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        product_ids: state.cart,
        customer_name: data.name,
        customer_email: data.email,
        customer_phone: data.phone,
        delivery_method: data.delivery,
        customer_note: data.note || null,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "En av diskene kan ha blitt reservert av noen andre.");
    state.cart = [];
    persistCart();
    event.currentTarget.reset();
    elements.checkoutDialog.close();
    showToast(`Reservasjonen er mottatt. Ordrenummer: ${payload.order_number || payload}`);
    await loadProducts();
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    button.disabled = false;
    button.textContent = "Send reservasjon";
  }
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2800);
}

function resetFilters() {
  elements.search.value = "";
  elements.manufacturer.value = "all";
  elements.grade.value = "0";
  elements.sort.value = "newest";
  renderProducts();
}

for (const element of [elements.search, elements.manufacturer, elements.grade, elements.sort]) {
  element.addEventListener(element === elements.search ? "input" : "change", renderProducts);
}
$("#reset-filters").addEventListener("click", resetFilters);
$("#open-cart").addEventListener("click", openCart);
$("#close-cart").addEventListener("click", closeCart);
elements.backdrop.addEventListener("click", closeCart);
$("#start-checkout").addEventListener("click", openCheckout);
$("[data-close-dialog]").addEventListener("click", () => elements.productDialog.close());
$("[data-close-checkout]").addEventListener("click", () => elements.checkoutDialog.close());
$("#checkout-form").addEventListener("submit", submitOrder);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && elements.cartDrawer.classList.contains("open")) closeCart();
});
$("#year").textContent = new Date().getFullYear();

loadProducts();
