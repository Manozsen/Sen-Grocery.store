// ============================================================
// admin.js — Admin panel logic for admin.html
// Only gwmanoj22@gmail.com has access
// Images → Cloudinary unsigned upload (no Firebase Storage)
// ============================================================

import { db, auth } from "./firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, setDoc, getDoc, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Cloudinary config ────────────────────────────────────────
const CLOUDINARY_CLOUD  = "dthxk16eq";
const CLOUDINARY_PRESET = "unsigned_upload";
const CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

// ── Constants ────────────────────────────────────────────────
const ADMIN_EMAIL = "gwmanoj22@gmail.com";

// ── DOM helper ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Local state ──────────────────────────────────────────────
let categories  = [];
let products    = [];
let storeImages = [];
let reviews     = [];

// ============================================================
// UTILITIES
// ============================================================
function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function escAttr(str) {
  return (str || "").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function showMsg(elId, text, ok) {
  const e = $(elId);
  if (!e) return;
  e.textContent = text;
  e.className   = ok
    ? "mt-2 text-sm font-semibold text-green-600"
    : "mt-2 text-sm font-semibold text-red-500";
  setTimeout(() => { e.textContent = ""; }, 5000);
}

function setLoading(id, msg = "Loading…") {
  const e = $(id);
  if (e) e.innerHTML = `<p class="text-gray-400 text-sm italic">${msg}</p>`;
}

// ── Progress bar ─────────────────────────────────────────────
function setProgress(barId, wrapId, pct) {
  const bar  = $(barId);
  const wrap = $(wrapId);
  if (bar)  bar.style.width  = `${pct}%`;
  if (wrap) wrap.classList.toggle("hidden", pct === 0 || pct === 100);
}

// ============================================================
// CLOUDINARY UPLOAD — core XHR upload with progress
// ============================================================
async function uploadToCloudinary(file, barId, wrapId) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file",          file);
    formData.append("upload_preset", CLOUDINARY_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", CLOUDINARY_URL);

    if (barId && wrapId) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setProgress(barId, wrapId, Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText).secure_url);
      } else {
        reject(new Error(`Cloudinary error (${xhr.status}): ${xhr.statusText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(formData);
  });
}

// ============================================================
// AUTH
// ============================================================
function initAuth() {
  onAuthStateChanged(auth, (user) => {
    if (user && user.email === ADMIN_EMAIL) {
      $("login-screen").classList.add("hidden");
      $("admin-panel").classList.remove("hidden");
      $("admin-user-email").textContent = user.email;
      loadAllData();
    } else {
      if (user) signOut(auth); // wrong account — boot out
      $("login-screen").classList.remove("hidden");
      $("admin-panel").classList.add("hidden");
    }
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const pass  = $("login-pass").value;
    const btn   = $("login-btn");
    const errEl = $("login-error");

    if (email !== ADMIN_EMAIL) {
      errEl.textContent = "Access denied. Unauthorised email.";
      return;
    }

    errEl.textContent = "";
    btn.disabled      = true;
    btn.textContent   = "Signing in…";

    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch {
      errEl.textContent = "Incorrect password. Please try again.";
      btn.disabled      = false;
      btn.textContent   = "Sign In";
    }
  });

  $("logout-btn").addEventListener("click", () => signOut(auth));
}

// ============================================================
// TAB NAVIGATION
// ============================================================
function initTabs() {
  const tabs   = document.querySelectorAll("[data-tab]");
  const panels = document.querySelectorAll("[data-panel]");

  function activate(tab) {
    tabs.forEach(t => {
      t.classList.remove("border-accent", "text-accent");
      t.classList.add("border-transparent", "text-gray-500");
    });
    panels.forEach(p => p.classList.add("hidden"));
    tab.classList.add("border-accent", "text-accent");
    tab.classList.remove("border-transparent", "text-gray-500");
    const panel = document.querySelector(`[data-panel="${tab.dataset.tab}"]`);
    if (panel) panel.classList.remove("hidden");
  }

  tabs.forEach(t => t.addEventListener("click", () => activate(t)));
  if (tabs.length) activate(tabs[0]);
}

// ============================================================
// LOAD ALL
// ============================================================
function loadAllData() {
  loadSettings();
  loadCategories();
  loadProducts();
  loadStoreImages();
  loadReviews();
}

// ============================================================
// SETTINGS  (+ hero image upload)
// ============================================================
async function loadSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "main"));
    if (snap.exists()) {
      const s = snap.data();
      $("set-tagline").value   = s.tagline   || "";
      $("set-about").value     = s.aboutText || "";
      $("set-phone").value     = s.phone     || "";
      $("set-whatsapp").value  = s.whatsapp  || "";
      $("set-address").value   = s.address   || "";
      $("set-opentime").value  = s.openTime  || "";
      $("set-closetime").value = s.closeTime || "";
      $("set-maplink").value   = s.mapLink   || "";

      // Show current hero image preview if one exists
      if (s.heroImage) {
        updateHeroPreview(s.heroImage);
      }
    }
  } catch (err) {
    console.error("[Settings] Load failed:", err);
  }
}

// Update the hero preview thumbnail in the settings tab
function updateHeroPreview(url) {
  const preview = $("hero-img-preview");
  const wrap    = $("hero-preview-wrap");
  if (!preview || !wrap) return;
  preview.src = url;
  wrap.classList.remove("hidden");
}

// Upload hero image → Cloudinary → save to Firestore settings/main.heroImage
window.uploadHeroImage = async function () {
  const file = $("hero-img-file")?.files[0];
  const btn  = $("upload-hero-btn");
  const msg  = $("hero-img-msg");

  if (!file) { alert("Please select an image file."); return; }

  btn.disabled    = true;
  btn.textContent = "Uploading…";

  try {
    const url = await uploadToCloudinary(file, "hero-prog-bar", "hero-prog-wrap");

    // Merge heroImage into existing settings document (setDoc with merge)
    await setDoc(doc(db, "settings", "main"), { heroImage: url }, { merge: true });

    $("hero-img-file").value = "";
    updateHeroPreview(url);
    showMsg("hero-img-msg", "✓ Hero image updated!", true);
  } catch (err) {
    showMsg("hero-img-msg", "✗ Upload failed: " + err.message, false);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Upload Hero Image";
    setProgress("hero-prog-bar", "hero-prog-wrap", 0);
  }
};

window.saveSettings = async function () {
  const btn = $("save-settings-btn");
  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    // Use merge:true so heroImage (and any future fields) are never accidentally deleted
    await setDoc(doc(db, "settings", "main"), {
      tagline:   $("set-tagline").value.trim(),
      aboutText: $("set-about").value.trim(),
      phone:     $("set-phone").value.trim(),
      whatsapp:  $("set-whatsapp").value.trim(),
      address:   $("set-address").value.trim(),
      openTime:  $("set-opentime").value.trim(),
      closeTime: $("set-closetime").value.trim(),
      mapLink:   $("set-maplink").value.trim(),
    }, { merge: true });
    showMsg("settings-msg", "✓ Settings saved!", true);
  } catch (err) {
    showMsg("settings-msg", "✗ Save failed: " + err.message, false);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save Settings";
  }
};

// ============================================================
// CATEGORIES — CRUD + inline image replace
// ============================================================
async function loadCategories() {
  setLoading("categories-list");
  try {
    const q    = query(collection(db, "categories"), orderBy("order", "asc"));
    const snap = await getDocs(q);
    categories = [];
    snap.forEach(d => categories.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Categories] Load failed:", err);
  }
  renderCategoriesList();
}

function renderCategoriesList() {
  const list = $("categories-list");
  if (!list) return;

  if (!categories.length) {
    list.innerHTML = `<p class="text-gray-400 text-sm italic">No categories yet. Add one below.</p>`;
    return;
  }

  list.innerHTML = "";
  categories.forEach(cat => {
    const ph  = `https://placehold.co/56x56/e5e7eb/6b7280?text=${encodeURIComponent(cat.name.slice(0, 1))}`;
    const div = document.createElement("div");
    div.id        = `cat-row-${cat.id}`;
    div.className = "flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-accent/40 transition-colors";
    div.innerHTML = `
      <!-- Current image thumbnail -->
      <div class="relative flex-shrink-0 group/thumb w-14 h-14">
        <img
          id="cat-thumb-${cat.id}"
          src="${escAttr(cat.imageUrl || ph)}"
          onerror="this.src='${ph}'"
          class="w-14 h-14 rounded-lg object-cover bg-gray-100 block"
          alt="${escAttr(cat.name)}"
        />
        <!-- Hover overlay: click to change image -->
        <label
          for="cat-inline-file-${cat.id}"
          title="Click to change image"
          class="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer"
        >
          <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </label>
        <!-- Hidden file input — triggers on label click -->
        <input
          type="file"
          id="cat-inline-file-${cat.id}"
          accept="image/*"
          class="hidden"
          onchange="replaceCategoryImage('${cat.id}', this)"
        />
      </div>

      <!-- Name + order -->
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-800 font-poppins truncate">${esc(cat.name)}</p>
        <p class="text-xs text-gray-400">Order: ${cat.order ?? 0}</p>
        <!-- Per-row upload status -->
        <p id="cat-img-status-${cat.id}" class="text-xs font-medium mt-0.5 hidden"></p>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="editCategory('${cat.id}')"
                class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
        <button onclick="deleteCategory('${cat.id}')"
                class="btn-admin-sm border-red-300 text-red-500 hover:bg-red-50">Delete</button>
      </div>`;
    list.appendChild(div);
  });
}

// Called when admin selects a new file directly on the category row thumbnail
window.replaceCategoryImage = async function (catId, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const thumb  = $(`cat-thumb-${catId}`);
  const status = $(`cat-img-status-${catId}`);

  // Show uploading state
  if (thumb)  { thumb.style.opacity = "0.4"; }
  if (status) { status.textContent = "Uploading…"; status.className = "text-xs font-medium mt-0.5 text-accent"; status.classList.remove("hidden"); }

  try {
    const url = await uploadToCloudinary(file, null, null);

    // Update Firestore using doc.id
    await updateDoc(doc(db, "categories", catId), { imageUrl: url });

    // Update thumbnail instantly — no full re-render needed
    if (thumb)  { thumb.src = url; thumb.style.opacity = "1"; }
    if (status) { status.textContent = "✓ Image updated!"; status.className = "text-xs font-medium mt-0.5 text-green-600"; }
    setTimeout(() => { if (status) status.classList.add("hidden"); }, 3000);

    // Sync local state so Edit modal shows fresh URL
    const cat = categories.find(c => c.id === catId);
    if (cat) cat.imageUrl = url;

  } catch (err) {
    if (thumb)  { thumb.style.opacity = "1"; }
    if (status) { status.textContent = "✗ Upload failed"; status.className = "text-xs font-medium mt-0.5 text-red-500"; }
    console.error("[CatImageReplace]", err);
  } finally {
    inputEl.value = ""; // reset so same file can be re-selected if needed
  }
};

// ── Category modal (Add / Edit) ──────────────────────────────
window.openCatModal = function (id = "") {
  const cat = id ? categories.find(c => c.id === id) : null;
  $("cat-modal-title").textContent = cat ? "Edit Category" : "Add Category";
  $("cat-edit-id").value    = id;
  $("cat-name").value       = cat?.name     || "";
  $("cat-order").value      = cat?.order    ?? "";
  $("cat-image-url").value  = cat?.imageUrl || "";
  $("cat-image-file").value = "";
  $("cat-modal").classList.remove("hidden");
};

window.editCategory  = (id) => window.openCatModal(id);
window.closeCatModal = ()   => $("cat-modal").classList.add("hidden");

window.saveCategoryForm = async function () {
  const id    = $("cat-edit-id").value;
  const name  = $("cat-name").value.trim();
  const order = parseInt($("cat-order").value) || 0;
  let   url   = $("cat-image-url").value.trim();
  const file  = $("cat-image-file").files[0];
  const btn   = $("save-cat-btn");

  if (!name) { alert("Category name is required."); return; }

  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    if (file) {
      url = await uploadToCloudinary(file, "cat-prog-bar", "cat-prog-wrap");
    }

    const data = { name, imageUrl: url || "", order };
    if (id) {
      await updateDoc(doc(db, "categories", id), data);
    } else {
      await addDoc(collection(db, "categories"), data);
    }

    window.closeCatModal();
    await loadCategories();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save";
    setProgress("cat-prog-bar", "cat-prog-wrap", 0);
  }
};

window.deleteCategory = async function (id) {
  if (!confirm("Delete this category? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    await loadCategories();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ============================================================
// PRODUCTS — CRUD + inline image replace
// ============================================================
async function loadProducts() {
  setLoading("products-list");
  try {
    const snap = await getDocs(collection(db, "products"));
    products = [];
    snap.forEach(d => products.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Products] Load failed:", err);
  }
  renderProductsList();
}

function renderProductsList() {
  const list = $("products-list");
  if (!list) return;

  if (!products.length) {
    list.innerHTML = `<p class="text-gray-400 text-sm italic">No products yet. Add one below.</p>`;
    return;
  }

  list.innerHTML = "";
  products.forEach(p => {
    const ph  = `https://placehold.co/56x56/e5e7eb/6b7280?text=${encodeURIComponent(p.name.slice(0, 1))}`;
    const div = document.createElement("div");
    div.id        = `prod-row-${p.id}`;
    div.className = "flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-accent/40 transition-colors";
    div.innerHTML = `
      <!-- Current image thumbnail with hover-to-change -->
      <div class="relative flex-shrink-0 group/thumb w-14 h-14">
        <img
          id="prod-thumb-${p.id}"
          src="${escAttr(p.imageUrl || ph)}"
          onerror="this.src='${ph}'"
          class="w-14 h-14 rounded-lg object-cover bg-gray-100 block"
          alt="${escAttr(p.name)}"
        />
        <label
          for="prod-inline-file-${p.id}"
          title="Click to change image"
          class="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer"
        >
          <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </label>
        <input
          type="file"
          id="prod-inline-file-${p.id}"
          accept="image/*"
          class="hidden"
          onchange="replaceProductImage('${p.id}', this)"
        />
      </div>

      <!-- Name + featured badge -->
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-800 font-poppins truncate">${esc(p.name)}</p>
        <span class="inline-block text-xs px-2 py-0.5 rounded-full mt-0.5 ${p.isFeatured ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500"}">
          ${p.isFeatured ? "⭐ Featured" : "Regular"}
        </span>
        <p id="prod-img-status-${p.id}" class="text-xs font-medium mt-0.5 hidden"></p>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="editProduct('${p.id}')"
                class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
        <button onclick="deleteProduct('${p.id}')"
                class="btn-admin-sm border-red-300 text-red-500 hover:bg-red-50">Delete</button>
      </div>`;
    list.appendChild(div);
  });
}

// Called when admin selects a new file directly on the product row thumbnail
window.replaceProductImage = async function (prodId, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const thumb  = $(`prod-thumb-${prodId}`);
  const status = $(`prod-img-status-${prodId}`);

  if (thumb)  { thumb.style.opacity = "0.4"; }
  if (status) { status.textContent = "Uploading…"; status.className = "text-xs font-medium mt-0.5 text-accent"; status.classList.remove("hidden"); }

  try {
    const url = await uploadToCloudinary(file, null, null);

    // Update Firestore using doc.id
    await updateDoc(doc(db, "products", prodId), { imageUrl: url });

    // Update thumbnail in-place
    if (thumb)  { thumb.src = url; thumb.style.opacity = "1"; }
    if (status) { status.textContent = "✓ Image updated!"; status.className = "text-xs font-medium mt-0.5 text-green-600"; }
    setTimeout(() => { if (status) status.classList.add("hidden"); }, 3000);

    // Sync local state
    const prod = products.find(p => p.id === prodId);
    if (prod) prod.imageUrl = url;

  } catch (err) {
    if (thumb)  { thumb.style.opacity = "1"; }
    if (status) { status.textContent = "✗ Upload failed"; status.className = "text-xs font-medium mt-0.5 text-red-500"; }
    console.error("[ProdImageReplace]", err);
  } finally {
    inputEl.value = "";
  }
};

// ── Product modal (Add / Edit) ───────────────────────────────
window.openProdModal = function (id = "") {
  const p = id ? products.find(x => x.id === id) : null;
  $("prod-modal-title").textContent = p ? "Edit Product" : "Add Product";
  $("prod-edit-id").value    = id;
  $("prod-name").value       = p?.name      || "";
  $("prod-image-url").value  = p?.imageUrl  || "";
  $("prod-featured").checked = p?.isFeatured || false;
  $("prod-image-file").value = "";
  $("prod-modal").classList.remove("hidden");
};

window.editProduct    = (id) => window.openProdModal(id);
window.closeProdModal = ()   => $("prod-modal").classList.add("hidden");

window.saveProductForm = async function () {
  const id         = $("prod-edit-id").value;
  const name       = $("prod-name").value.trim();
  let   url        = $("prod-image-url").value.trim();
  const isFeatured = $("prod-featured").checked;
  const file       = $("prod-image-file").files[0];
  const btn        = $("save-prod-btn");

  if (!name) { alert("Product name is required."); return; }

  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    if (file) {
      url = await uploadToCloudinary(file, "prod-prog-bar", "prod-prog-wrap");
    }

    const data = { name, imageUrl: url || "", isFeatured };
    if (id) {
      await updateDoc(doc(db, "products", id), data);
    } else {
      await addDoc(collection(db, "products"), data);
    }

    window.closeProdModal();
    await loadProducts();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save";
    setProgress("prod-prog-bar", "prod-prog-wrap", 0);
  }
};

window.deleteProduct = async function (id) {
  if (!confirm("Delete this product? This cannot be undone.")) return;
  try {
    await deleteDoc(doc(db, "products", id));
    await loadProducts();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ============================================================
// STORE IMAGES — Upload, URL fallback & Delete
// ============================================================
async function loadStoreImages() {
  setLoading("store-images-grid", "Loading images…");
  try {
    const snap = await getDocs(collection(db, "storeImages"));
    storeImages = [];
    snap.forEach(d => storeImages.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Gallery] Load failed:", err);
  }
  renderStoreImages();
}

function renderStoreImages() {
  const grid = $("store-images-grid");
  if (!grid) return;

  if (!storeImages.length) {
    grid.innerHTML = `<p class="col-span-full text-gray-400 text-sm italic">No images uploaded yet.</p>`;
    return;
  }

  grid.innerHTML = "";
  storeImages.forEach(img => {
    const div = document.createElement("div");
    div.className = "relative group rounded-xl overflow-hidden border border-gray-200 shadow-sm";
    div.innerHTML = `
      <img src="${escAttr(img.imageUrl)}" alt="Store image"
           class="w-full h-36 object-cover"
           onerror="this.src='https://placehold.co/300x150/e5e7eb/9ca3af?text=Error'" />
      <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <button onclick="deleteStoreImage('${img.id}')"
                class="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
          Delete
        </button>
      </div>`;
    grid.appendChild(div);
  });
}

window.uploadStoreImage = async function () {
  const file = $("store-img-file")?.files[0];
  const btn  = $("upload-gallery-btn");
  if (!file) { alert("Please select an image."); return; }

  btn.disabled    = true;
  btn.textContent = "Uploading…";

  try {
    const url = await uploadToCloudinary(file, "gallery-prog-bar", "gallery-prog-wrap");
    await addDoc(collection(db, "storeImages"), { imageUrl: url, createdAt: serverTimestamp() });
    $("store-img-file").value = "";
    showMsg("gallery-msg", "✓ Image uploaded!", true);
    await loadStoreImages();
  } catch (err) {
    showMsg("gallery-msg", "✗ Upload failed: " + err.message, false);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Upload Image";
    setProgress("gallery-prog-bar", "gallery-prog-wrap", 0);
  }
};

window.addImageByUrl = async function () {
  const url = $("gallery-url-input")?.value.trim();
  if (!url) { alert("Please enter a URL."); return; }
  try {
    await addDoc(collection(db, "storeImages"), { imageUrl: url, createdAt: serverTimestamp() });
    $("gallery-url-input").value = "";
    showMsg("gallery-msg", "✓ Image added by URL!", true);
    await loadStoreImages();
  } catch (err) {
    showMsg("gallery-msg", "✗ Failed: " + err.message, false);
  }
};

window.deleteStoreImage = async function (id) {
  if (!confirm("Delete this image?")) return;
  try {
    await deleteDoc(doc(db, "storeImages", id));
    await loadStoreImages();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ============================================================
// REVIEWS — Edit & Delete
// ============================================================
async function loadReviews() {
  setLoading("reviews-admin-list");
  try {
    const q    = query(collection(db, "reviews"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    reviews = [];
    snap.forEach(d => reviews.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Reviews] Load failed:", err);
    reviews = [];
  }
  renderReviews();
}

function renderReviews() {
  const list = $("reviews-admin-list");
  if (!list) return;

  if (!reviews.length) {
    list.innerHTML = `<p class="text-gray-400 text-sm italic">No reviews yet.</p>`;
    return;
  }

  list.innerHTML = "";
  reviews.forEach(r => {
    const div = document.createElement("div");
    div.id        = `rev-${r.id}`;
    div.className = "p-4 bg-white rounded-xl border border-gray-200";
    div.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div id="rev-display-${r.id}">
            <p class="font-semibold text-gray-800 font-poppins text-sm">${esc(r.name)}</p>
            <p class="text-gray-500 text-sm mt-1 italic leading-relaxed">"${esc(r.text)}"</p>
          </div>
          <div id="rev-edit-${r.id}" class="hidden space-y-2 mt-2">
            <input type="text" id="rev-name-${r.id}" value="${escAttr(r.name)}"
                   class="admin-input w-full" placeholder="Name" />
            <textarea id="rev-text-${r.id}" rows="3"
                      class="admin-input w-full resize-none" placeholder="Review text">${esc(r.text)}</textarea>
          </div>
        </div>
        <div class="flex flex-col gap-2 flex-shrink-0">
          <button id="rev-edit-btn-${r.id}"  onclick="toggleEditReview('${r.id}')"
                  class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
          <button id="rev-save-btn-${r.id}"  onclick="saveReview('${r.id}')"
                  class="hidden btn-admin-sm border-green-400 text-green-600 hover:bg-green-50">Save</button>
          <button onclick="deleteReview('${r.id}')"
                  class="btn-admin-sm border-red-300 text-red-500 hover:bg-red-50">Delete</button>
        </div>
      </div>`;
    list.appendChild(div);
  });
}

window.toggleEditReview = function (id) {
  [$(`rev-display-${id}`), $(`rev-edit-${id}`), $(`rev-edit-btn-${id}`), $(`rev-save-btn-${id}`)]
    .forEach(e => e?.classList.toggle("hidden"));
};

window.saveReview = async function (id) {
  const name = $(`rev-name-${id}`)?.value.trim();
  const text = $(`rev-text-${id}`)?.value.trim();
  if (!name || !text) { alert("Name and review text are required."); return; }
  try {
    await updateDoc(doc(db, "reviews", id), { name, text });
    await loadReviews();
  } catch (err) {
    alert("Update failed: " + err.message);
  }
};

window.deleteReview = async function (id) {
  if (!confirm("Delete this review permanently?")) return;
  try {
    await deleteDoc(doc(db, "reviews", id));
    await loadReviews();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
};

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initTabs();
});
