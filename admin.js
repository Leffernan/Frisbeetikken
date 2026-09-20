import { config } from "./config.js";

const BUCKET = "product-images";
const SESSION_KEY = "frisbeetikken-admin-session";
const IMAGE_PATTERN = /^(\d+)[_-]([fb])\.(jpe?g|png|webp|avif)$/i;

const state = {
  session: readSession(),
  groups: [],
  products: new Map(),
  objectUrls: [],
  publishing: false,
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const elements = {
  loginPanel: $("#login-panel"),
  loginForm: $("#login-form"),
  loginStatus: $("#login-status"),
  workspace: $("#workspace"),
  sessionActions: $("#session-actions"),
  sessionEmail: $("#session-email"),
  logout: $("#logout"),
  dropZone: $("#drop-zone"),
  fileInput: $("#file-input"),
  chooseAgain: $("#choose-again"),
  summary: $("#import-summary"),
  groupCount: $("#group-count"),
  fileCount: $("#file-count"),
  fileErrors: $("#file-errors"),
  editors: $("#product-editors"),
  publishBar: $("#publish-bar"),
  publishAll: $("#publish-all"),
  publishTitle: $("#publish-title"),
  publishDetail: $("#publish-detail"),
  publishProgress: $("#publish-progress"),
  manufacturerOptions: $("#manufacturer-options"),
  plasticOptions: $("#plastic-options"),
};

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function escapeHtml(value = "") {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
}

async function parseError(response, fallback) {
  try {
    const body = await response.json();
    return body.msg || body.message || body.error_description || body.error || fallback;
  } catch {
    return fallback;
  }
}

async function signIn(email, password) {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await parseError(response, "Innloggingen mislyktes."));
  const data = await response.json();
  saveSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: data.user?.email || email,
  });
}

async function ensureSession() {
  if (!state.session?.refreshToken) throw new Error("Du må logge inn på nytt.");
  if (state.session.expiresAt > Date.now() + 90_000) return state.session;

  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: state.session.refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    throw new Error("Økten har utløpt. Logg inn på nytt.");
  }
  const data = await response.json();
  saveSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: data.user?.email || state.session.email,
  });
  return state.session;
}

async function authenticatedFetch(path, options = {}) {
  const session = await ensureSession();
  const headers = new Headers(options.headers || {});
  headers.set("apikey", config.supabasePublishableKey);
  headers.set("Authorization", `Bearer ${session.accessToken}`);
  return fetch(`${config.supabaseUrl}${path}`, { ...options, headers });
}

async function verifyAdmin() {
  const response = await authenticatedFetch("/rest/v1/rpc/is_admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!response.ok) throw new Error(await parseError(response, "Kunne ikke kontrollere admin-tilgangen."));
  if (await response.json() !== true) throw new Error("Brukeren er ikke lagt til i public.admin_users.");
}

async function loadExistingProducts() {
  const response = await authenticatedFetch("/rest/v1/products?select=*&order=id.asc");
  if (!response.ok) throw new Error(await parseError(response, "Kunne ikke hente eksisterende produkter."));
  const products = await response.json();
  state.products = new Map(products.map((product) => [product.id, product]));

  const manufacturers = [...new Set(products.map((product) => product.manufacturer).filter(Boolean))].sort();
  const plastics = [...new Set(products.map((product) => product.plastic).filter(Boolean))].sort();
  elements.manufacturerOptions.innerHTML = manufacturers.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
  elements.plasticOptions.innerHTML = plastics.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("");
}

async function openWorkspace() {
  await verifyAdmin();
  await loadExistingProducts();
  elements.loginPanel.hidden = true;
  elements.workspace.hidden = false;
  elements.sessionActions.hidden = false;
  elements.sessionEmail.textContent = state.session.email;
}

function showLogin(message = "", isError = false) {
  elements.loginPanel.hidden = false;
  elements.workspace.hidden = true;
  elements.sessionActions.hidden = true;
  elements.loginStatus.textContent = message;
  elements.loginStatus.classList.toggle("error", isError);
}

function releasePreviews() {
  state.objectUrls.forEach((url) => URL.revokeObjectURL(url));
  state.objectUrls = [];
}

function groupFiles(files) {
  releasePreviews();
  const groups = new Map();
  const errors = [];

  for (const file of files) {
    const match = file.name.match(IMAGE_PATTERN);
    if (!match) {
      errors.push(`${file.name}: bruk for eksempel 001_f.jpg eller 001_b.jpg.`);
      continue;
    }
    if (file.size > 10 * 1024 * 1024) {
      errors.push(`${file.name}: filen er større enn 10 MB.`);
      continue;
    }
    const [, id, sideLetter] = match;
    const side = sideLetter.toLowerCase() === "f" ? "front" : "back";
    const group = groups.get(id) || { id, front: null, back: null, done: false };
    if (group[side]) {
      errors.push(`${file.name}: varenummer ${id} har allerede en ${side === "front" ? "forside" : "bakside"}.`);
      continue;
    }
    group[side] = file;
    groups.set(id, group);
  }

  state.groups = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id, "nb", { numeric: true }));
  renderFileErrors(errors);
  renderGroups();
}

function renderFileErrors(errors) {
  elements.fileErrors.hidden = errors.length === 0;
  elements.fileErrors.innerHTML = errors.length
    ? `<strong>${errors.length} ${errors.length === 1 ? "fil ble hoppet over" : "filer ble hoppet over"}</strong><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}</ul>`
    : "";
}

function preview(file, alt) {
  if (!file) return `<div class="image-preview missing"><span>${escapeHtml(alt)}</span></div>`;
  const url = URL.createObjectURL(file);
  state.objectUrls.push(url);
  return `<div class="image-preview"><img src="${url}" alt="${escapeHtml(alt)}" /><span>${escapeHtml(alt)}</span></div>`;
}

function statusOptions(selected) {
  return [
    ["draft", "Kladd"], ["available", "Tilgjengelig"], ["reserved", "Reservert"],
    ["sold", "Solgt"], ["archived", "Arkivert"],
  ].map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function renderGroups() {
  const fileCount = state.groups.reduce((sum, group) => sum + Boolean(group.front) + Boolean(group.back), 0);
  elements.summary.hidden = state.groups.length === 0;
  elements.publishBar.hidden = state.groups.length === 0;
  elements.groupCount.textContent = `${state.groups.length} ${state.groups.length === 1 ? "produkt" : "produkter"} funnet`;
  elements.fileCount.textContent = `${fileCount} gyldige bilder er koblet sammen etter varenummer.`;
  elements.publishProgress.max = Math.max(state.groups.length, 1);
  elements.publishProgress.value = 0;
  elements.publishTitle.textContent = "Klar til opplasting";
  elements.publishDetail.textContent = "Kontroller produktinformasjonen først.";
  elements.publishAll.textContent = "Last opp og lagre";

  elements.editors.innerHTML = state.groups.map((group, index) => {
    const product = state.products.get(group.id) || {};
    return `
      <article class="product-editor" data-id="${escapeHtml(group.id)}" data-index="${index}">
        <div class="image-pair">
          ${preview(group.front, "Forside")}
          ${preview(group.back, "Bakside")}
        </div>
        <div class="editor-body">
          <div class="editor-heading">
            <h2>Vare ${escapeHtml(group.id)}</h2>
            ${index > 0 ? '<button class="copy-previous" type="button">Kopier forrige</button>' : ""}
          </div>
          <div class="field-grid">
            <label class="field-wide">Produsent
              <input data-field="manufacturer" list="manufacturer-options" value="${escapeHtml(product.manufacturer)}" required />
            </label>
            <label class="field-wide">Modell
              <input data-field="model" value="${escapeHtml(product.model)}" required />
            </label>
            <label>Pris (kr)
              <input data-field="price" type="number" min="0" step="1" value="${escapeHtml(product.price ?? "")}" required />
            </label>
            <label>Grad (0–10)
              <input data-field="grade" type="number" min="0" max="10" step="1" value="${escapeHtml(product.grade ?? 8)}" required />
            </label>
            <label>Vekt (g)
              <input data-field="weight" type="number" min="1" max="300" step="1" value="${escapeHtml(product.weight ?? "")}" />
            </label>
            <label>Plasttype
              <input data-field="plastic" list="plastic-options" value="${escapeHtml(product.plastic)}" />
            </label>
            <label>Status
              <select data-field="status">${statusOptions(product.status || "available")}</select>
            </label>
            <label class="field-full">Merknad
              <textarea data-field="note" rows="2" placeholder="Riper, tusj, slitasje eller annet">${escapeHtml(product.note)}</textarea>
            </label>
          </div>
          <p class="editor-status" aria-live="polite">${product.id ? "Eksisterende produkt – nye verdier overskriver de gamle." : "Nytt produkt."}</p>
        </div>
      </article>`;
  }).join("");
}

function copyPrevious(card) {
  const previous = card.previousElementSibling;
  if (!previous) return;
  for (const field of ["manufacturer", "price", "grade", "plastic", "status"]) {
    $(`[data-field="${field}"]`, card).value = $(`[data-field="${field}"]`, previous).value;
  }
}

function extensionFor(file) {
  const extension = file.name.split(".").pop().toLowerCase();
  return extension === "jpeg" ? "jpg" : extension;
}

async function uploadImage(id, side, file) {
  const extension = extensionFor(file);
  const path = `${encodeURIComponent(id)}/${side}.${extension}`;
  const response = await authenticatedFetch(`/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": file.type || `image/${extension}`,
      "x-upsert": "true",
      "cache-control": "3600",
    },
    body: file,
  });
  if (!response.ok) throw new Error(await parseError(response, `Kunne ikke laste opp ${side === "front" ? "forsiden" : "baksiden"}.`));
  return `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}`;
}

function readProduct(card, group) {
  const get = (name) => $(`[data-field="${name}"]`, card).value.trim();
  const existing = state.products.get(group.id) || {};
  const product = {
    id: group.id,
    manufacturer: get("manufacturer"),
    model: get("model"),
    price: Number(get("price")),
    grade: Number(get("grade")),
    weight: get("weight") ? Number(get("weight")) : null,
    plastic: get("plastic") || null,
    note: get("note") || null,
    status: get("status"),
    image_front: existing.image_front || null,
    image_back: existing.image_back || null,
    color: existing.color || "#d2ff00",
    updated_at: new Date().toISOString(),
  };

  if (!product.manufacturer || !product.model || !Number.isFinite(product.price) || product.price < 0) {
    throw new Error("Fyll inn produsent, modell og gyldig pris.");
  }
  if (!Number.isInteger(product.grade) || product.grade < 0 || product.grade > 10) {
    throw new Error("Grad må være et helt tall fra 0 til 10.");
  }
  if (product.weight !== null && (!Number.isInteger(product.weight) || product.weight < 1 || product.weight > 300)) {
    throw new Error("Vekt må være et helt tall mellom 1 og 300 gram.");
  }
  if (!group.front && !product.image_front) throw new Error("Forsidebildet mangler.");
  if (!group.back && !product.image_back) throw new Error("Baksidebildet mangler.");
  return product;
}

async function saveProduct(product) {
  const response = await authenticatedFetch("/rest/v1/products?on_conflict=id", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(product),
  });
  if (!response.ok) throw new Error(await parseError(response, "Kunne ikke lagre produktet."));
  const [saved] = await response.json();
  state.products.set(saved.id, saved);
}

async function publishGroup(group, index) {
  const card = $(`.product-editor[data-index="${index}"]`);
  const status = $(".editor-status", card);
  card.classList.remove("is-error", "is-done");
  try {
    const product = readProduct(card, group);
    status.textContent = "Laster opp bilder …";
    if (group.front) product.image_front = await uploadImage(group.id, "front", group.front);
    if (group.back) product.image_back = await uploadImage(group.id, "back", group.back);
    status.textContent = "Lagrer produktet …";
    await saveProduct(product);
    group.done = true;
    card.classList.add("is-done");
    status.textContent = "Ferdig lastet opp og lagret.";
    return true;
  } catch (error) {
    card.classList.add("is-error");
    status.textContent = error.message;
    return false;
  }
}

async function publishAll() {
  if (state.publishing) return;
  const queue = state.groups.map((group, index) => ({ group, index })).filter(({ group }) => !group.done);
  if (queue.length === 0) {
    elements.publishTitle.textContent = "Alt er allerede lastet opp";
    return;
  }
  state.publishing = true;
  elements.publishAll.disabled = true;
  elements.publishProgress.max = queue.length;
  elements.publishProgress.value = 0;
  let completed = 0;
  let succeeded = 0;

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (await publishGroup(item.group, item.index)) succeeded += 1;
      completed += 1;
      elements.publishProgress.value = completed;
      elements.publishTitle.textContent = `${completed} av ${elements.publishProgress.max} behandlet`;
      elements.publishDetail.textContent = `${succeeded} lagret · ${completed - succeeded} med feil`;
    }
  };

  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  state.publishing = false;
  elements.publishAll.disabled = false;
  elements.publishAll.textContent = succeeded === completed ? "Alt er lastet opp" : "Prøv feilene på nytt";
  elements.publishTitle.textContent = succeeded === completed ? "Opplastingen er ferdig" : "Noen produkter trenger hjelp";
}

elements.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("button[type=submit]", elements.loginForm);
  button.disabled = true;
  elements.loginStatus.textContent = "Logger inn …";
  elements.loginStatus.classList.remove("error");
  const data = new FormData(elements.loginForm);
  try {
    await signIn(data.get("email"), data.get("password"));
    await openWorkspace();
  } catch (error) {
    clearSession();
    showLogin(error.message, true);
  } finally {
    button.disabled = false;
  }
});

elements.logout.addEventListener("click", async () => {
  try {
    if (state.session?.accessToken) {
      await authenticatedFetch("/auth/v1/logout", { method: "POST" });
    }
  } catch {
    // Lokal utlogging skal alltid virke selv om nettverket er nede.
  }
  clearSession();
  releasePreviews();
  showLogin("Du er logget ut.");
});

elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.dropZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.fileInput.click();
  }
});
elements.fileInput.addEventListener("change", () => groupFiles([...elements.fileInput.files]));
elements.chooseAgain.addEventListener("click", () => elements.fileInput.click());
for (const eventName of ["dragenter", "dragover"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove("dragging");
  });
}
elements.dropZone.addEventListener("drop", (event) => groupFiles([...event.dataTransfer.files]));
elements.editors.addEventListener("click", (event) => {
  const button = event.target.closest(".copy-previous");
  if (button) copyPrevious(button.closest(".product-editor"));
});
elements.publishAll.addEventListener("click", publishAll);

if (state.session) {
  openWorkspace().catch((error) => {
    clearSession();
    showLogin(error.message, true);
  });
} else {
  showLogin();
}
