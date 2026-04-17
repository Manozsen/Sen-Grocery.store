// ============================================================
// admin.js — Admin panel logic
// Auth: Firebase Auth + Firestore role check (users/{uid}.role === "admin")
// Images: Cloudinary unsigned upload (no Firebase Storage)
// ============================================================

import { db, auth } from "./firebase.js";
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, setDoc, getDoc, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// ── Cloudinary ────────────────────────────────────────────────
const CLOUDINARY_CLOUD  = "dthxk16eq";
const CLOUDINARY_PRESET = "unsigned_upload";
const CLOUDINARY_URL    = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`;

// ── DOM helper ────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── State ─────────────────────────────────────────────────────
let categories  = [];
let products    = [];
let storeImages = [];
let reviews     = [];
let offers      = [];

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(type, message) {
  const container = $("toast-container");
  if (!container) return;

  const ok    = type === "success";
  const toast = document.createElement("div");

  toast.className = [
    "flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white",
    "font-poppins max-w-sm opacity-0 transition-all duration-300",
    ok ? "bg-green-500" : "bg-red-500",
  ].join(" ");

  toast.innerHTML = `
    <span class="flex-shrink-0">${ok ? "✓" : "✗"}</span>
    <span class="flex-1 leading-snug">${esc(message)}</span>
    <button onclick="this.parentElement.remove()"
            class="flex-shrink-0 text-white/70 hover:text-white text-lg leading-none ml-1">×</button>`;

  container.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.replace("opacity-0", "opacity-100")));

  // Auto-dismiss after 3 s
  setTimeout(() => {
    toast.classList.replace("opacity-100", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================================
// DELETE CONFIRMATION MODAL — returns Promise<boolean>
// ============================================================
function confirmDelete(itemLabel = "this item") {
  return new Promise((resolve) => {
    const modal      = $("delete-modal");
    const msgEl      = $("delete-modal-msg");
    const confirmBtn = $("delete-confirm-btn");
    const cancelBtn  = $("delete-cancel-btn");

    if (!modal) { resolve(false); return; }

    if (msgEl) {
      msgEl.textContent = `Are you sure you want to delete ${itemLabel}? This cannot be undone.`;
    }

    modal.classList.remove("hidden");

    function cleanup() {
      modal.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click",  onCancel);
    }
    function onConfirm() { cleanup(); resolve(true); }
    function onCancel()  { cleanup(); resolve(false); }

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click",  onCancel);
  });
}

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

function setLoading(id, msg = "Loading…") {
  const e = $(id);
  if (e) e.innerHTML = `<p class="text-gray-400 text-sm italic">${msg}</p>`;
}

function setProgress(barId, wrapId, pct) {
  const bar  = $(barId);
  const wrap = $(wrapId);
  if (bar)  bar.style.width = `${pct}%`;
  if (wrap) {
    // Show wrap when uploading (pct > 0 and pct < 100)
    if (pct > 0 && pct < 100) {
      wrap.classList.remove("hidden");
    } else {
      wrap.classList.add("hidden");
    }
  }
}

// ============================================================
// CLOUDINARY UPLOAD
// Fixed: uses XHR with proper progress events; returns secure_url
// ============================================================
function uploadToCloudinary(file, barId, wrapId) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided."));
      return;
    }

    const formData = new FormData();
    formData.append("file",          file);
    formData.append("upload_preset", CLOUDINARY_PRESET);

    const xhr = new XMLHttpRequest();

    // Show progress bar if IDs provided
    if (barId && wrapId) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setProgress(barId, wrapId, Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const data = JSON.parse(xhr.responseText);
          if (data.secure_url) {
            resolve(data.secure_url);
          } else {
            reject(new Error("Cloudinary did not return a secure_url."));
          }
        } catch {
          reject(new Error("Failed to parse Cloudinary response."));
        }
      } else {
        reject(new Error(`Cloudinary upload failed (HTTP ${xhr.status}).`));
      }
    };

    xhr.onerror   = () => reject(new Error("Network error during upload. Check your connection."));
    xhr.ontimeout = () => reject(new Error("Upload timed out. Please try again."));
    xhr.timeout   = 60000; // 60-second timeout

    xhr.open("POST", CLOUDINARY_URL);
    xhr.send(formData);
  });
}

// ============================================================
// AUTH — Firestore role check
// ============================================================
function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { showLoginScreen(); return; }

    try {
      const userSnap = await getDoc(doc(db, "users", user.uid));
      if (userSnap.exists() && userSnap.data().role === "admin") {
        showAdminPanel(user.email);
        loadAllData();
      } else {
        await signOut(auth);
        showLoginScreen();
        setLoginError("Access denied. Your account does not have admin privileges.");
      }
    } catch (err) {
      console.error("[Auth] Role check failed:", err);
      await signOut(auth);
      showLoginScreen();
      setLoginError("Authentication error. Please try again.");
    }
  });

  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("login-email").value.trim();
    const pass  = $("login-pass").value;
    const btn   = $("login-btn");

    clearLoginError();
    btn.disabled    = true;
    btn.textContent = "Signing in…";

    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch {
      setLoginError("Incorrect email or password. Please try again.");
      btn.disabled    = false;
      btn.textContent = "Sign In";
    }
  });

  $("logout-btn").addEventListener("click", async () => {
    await signOut(auth);
    showLoginScreen();
  });
}

function showLoginScreen() {
  $("login-screen").classList.remove("hidden");
  $("admin-panel").classList.add("hidden");
}

function showAdminPanel(email) {
  $("login-screen").classList.add("hidden");
  $("admin-panel").classList.remove("hidden");
  $("admin-user-email").textContent = email || "";
}

function setLoginError(msg) {
  const e = $("login-error");
  if (e) e.textContent = msg;
}

function clearLoginError() {
  const e = $("login-error");
  if (e) e.textContent = "";
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
// LOAD ALL DATA
// ============================================================
function loadAllData() {
  loadSettings();
  loadCategories();
  loadProducts();
  loadStoreImages();
  loadReviews();
  loadOffers();
}

// ============================================================
// SETTINGS
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
      if (s.heroImage) updateHeroPreview(s.heroImage);
    }
  } catch (err) {
    console.error("[Settings] Load failed:", err);
    showToast("error", "Failed to load settings.");
  }
}

function updateHeroPreview(url) {
  const preview = $("hero-img-preview");
  const wrap    = $("hero-preview-wrap");
  if (!preview || !wrap) return;
  preview.src = url;
  wrap.classList.remove("hidden");
}

window.uploadHeroImage = async function () {
  const fileInput = $("hero-img-file");
  const file      = fileInput?.files?.[0];
  const btn       = $("upload-hero-btn");

  if (!file) { showToast("error", "Please select an image file first."); return; }

  btn.disabled    = true;
  btn.textContent = "Uploading…";

  try {
    const url = await uploadToCloudinary(file, "hero-prog-bar", "hero-prog-wrap");
    await setDoc(doc(db, "settings", "main"), { heroImage: url }, { merge: true });
    if (fileInput) fileInput.value = "";
    updateHeroPreview(url);
    showToast("success", "Hero image updated!");
  } catch (err) {
    showToast("error", "Upload failed: " + err.message);
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
    showToast("success", "Settings saved!");
  } catch (err) {
    showToast("error", "Save failed: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save Settings";
  }
};

// ============================================================
// CATEGORIES
// ============================================================
async function loadCategories() {
  setLoading("categories-list");
  try {
    const q = query(collection(db, "categories"), orderBy("order", "asc"));
    const snap = await getDocs(q);
    categories = [];
    snap.forEach(d => categories.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Categories] Load failed:", err);
    showToast("error", "Failed to load categories.");
  }
  renderCategoriesList();
}

function renderCategoriesList() {
  const list = $("categories-list");
  if (!list) return;

  if (!categories.length) {
    list.innerHTML = `<div class="py-10 text-center text-gray-400 text-sm bg-white rounded-xl border border-dashed border-gray-200">No categories yet. Add one above.</div>`;
    return;
  }

  list.innerHTML = "";
  categories.forEach(cat => {
    const ph  = `https://placehold.co/56x56/e5e7eb/6b7280?text=${encodeURIComponent((cat.name || "?").slice(0, 1))}`;
    const div = document.createElement("div");
    div.id        = `cat-row-${cat.id}`;
    div.className = "flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-accent/40 transition-colors";
    div.innerHTML = `
      <!-- Thumbnail with hover-to-change -->
      <div class="relative flex-shrink-0 group/thumb w-14 h-14">
        <img id="cat-thumb-${cat.id}" src="${escAttr(cat.imageUrl || ph)}" onerror="this.src='${ph}'"
             class="w-14 h-14 rounded-lg object-cover bg-gray-100 block" alt="${escAttr(cat.name)}" />
        <label for="cat-inline-file-${cat.id}" title="Click to change image"
               class="absolute inset-0 bg-black/55 rounded-lg flex items-center justify-center
                      opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer">
          <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </label>
        <input type="file" id="cat-inline-file-${cat.id}" accept="image/*" class="hidden"
               onchange="replaceCategoryImage('${cat.id}', this)" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-800 font-poppins truncate">${esc(cat.name)}</p>
        <p class="text-xs text-gray-400">Order: ${cat.order ?? 0}</p>
        <p id="cat-img-status-${cat.id}" class="text-xs font-medium mt-0.5 hidden"></p>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="openCatModal('${cat.id}')"
                class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
        <button onclick="deleteCategoryConfirm('${cat.id}', '${escAttr(cat.name)}')"
                class="btn-admin-sm border-red-300 text-red-500 hover:bg-red-50">Delete</button>
      </div>`;
    list.appendChild(div);
  });
}

window.replaceCategoryImage = async function (catId, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;

  const thumb  = $(`cat-thumb-${catId}`);
  const status = $(`cat-img-status-${catId}`);

  if (thumb)  thumb.style.opacity = "0.4";
  if (status) { status.textContent = "Uploading…"; status.className = "text-xs font-medium mt-0.5 text-accent"; status.classList.remove("hidden"); }

  try {
    const url = await uploadToCloudinary(file, null, null);
    await updateDoc(doc(db, "categories", catId), { imageUrl: url });
    if (thumb)  { thumb.src = url; thumb.style.opacity = "1"; }
    if (status) { status.textContent = "✓ Updated!"; status.className = "text-xs font-medium mt-0.5 text-green-600"; }
    setTimeout(() => status?.classList.add("hidden"), 3000);
    const cat = categories.find(c => c.id === catId);
    if (cat) cat.imageUrl = url;
    showToast("success", "Category image updated!");
  } catch (err) {
    if (thumb)  thumb.style.opacity = "1";
    if (status) { status.textContent = "✗ Upload failed"; status.className = "text-xs font-medium mt-0.5 text-red-500"; }
    showToast("error", "Image upload failed: " + err.message);
  } finally {
    if (inputEl) inputEl.value = "";
  }
};

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

window.closeCatModal = () => $("cat-modal").classList.add("hidden");

window.saveCategoryForm = async function () {
  const id    = $("cat-edit-id").value;
  const name  = $("cat-name").value.trim();
  const order = parseInt($("cat-order").value) || 0;
  let   url   = $("cat-image-url").value.trim();
  const file  = $("cat-image-file")?.files?.[0];
  const btn   = $("save-cat-btn");

  if (!name) { showToast("error", "Category name is required."); return; }

  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    if (file) url = await uploadToCloudinary(file, "cat-prog-bar", "cat-prog-wrap");

    const data = { name, imageUrl: url || "", order };
    if (id) {
      await updateDoc(doc(db, "categories", id), data);
      showToast("success", `Category "${name}" updated!`);
    } else {
      await addDoc(collection(db, "categories"), data);
      showToast("success", `Category "${name}" added!`);
    }
    window.closeCatModal();
    await loadCategories();
  } catch (err) {
    showToast("error", "Error: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save";
    setProgress("cat-prog-bar", "cat-prog-wrap", 0);
  }
};

window.deleteCategoryConfirm = async function (id, name) {
  const ok = await confirmDelete(`the category "${name}"`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "categories", id));
    showToast("success", `Category "${name}" deleted.`);
    await loadCategories();
  } catch (err) {
    showToast("error", "Delete failed: " + err.message);
  }
};

// ============================================================
// PRODUCTS
// ============================================================
async function loadProducts() {
  setLoading("products-list");
  try {
    const snap = await getDocs(collection(db, "products"));
    products = [];
    snap.forEach(d => products.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Products] Load failed:", err);
    showToast("error", "Failed to load products.");
  }
  renderProductsList();
}

function renderProductsList() {
  const list = $("products-list");
  if (!list) return;

  if (!products.length) {
    list.innerHTML = `<div class="py-10 text-center text-gray-400 text-sm bg-white rounded-xl border border-dashed border-gray-200">No products yet. Add one above.</div>`;
    return;
  }

  list.innerHTML = "";
  products.forEach(p => {
    const ph  = `https://placehold.co/56x56/e5e7eb/6b7280?text=${encodeURIComponent((p.name || "?").slice(0, 1))}`;
    const div = document.createElement("div");
    div.id        = `prod-row-${p.id}`;
    div.className = "flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-accent/40 transition-colors";
    div.innerHTML = `
      <div class="relative flex-shrink-0 group/thumb w-14 h-14">
        <img id="prod-thumb-${p.id}" src="${escAttr(p.imageUrl || ph)}" onerror="this.src='${ph}'"
             class="w-14 h-14 rounded-lg object-cover bg-gray-100 block" alt="${escAttr(p.name)}" />
        <label for="prod-inline-file-${p.id}" title="Click to change image"
               class="absolute inset-0 bg-black/55 rounded-lg flex items-center justify-center
                      opacity-0 group-hover/thumb:opacity-100 transition-opacity cursor-pointer">
          <svg class="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
          </svg>
        </label>
        <input type="file" id="prod-inline-file-${p.id}" accept="image/*" class="hidden"
               onchange="replaceProductImage('${p.id}', this)" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-800 font-poppins truncate">${esc(p.name)}</p>
        <button id="feat-btn-${p.id}" onclick="toggleFeatured('${p.id}')"
                class="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full mt-1 font-semibold transition-all
                       ${p.isFeatured ? 'bg-teal-100 text-teal-700 hover:bg-teal-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}">
          <span>${p.isFeatured ? "⭐" : "☆"}</span>
          <span id="feat-label-${p.id}">${p.isFeatured ? "Featured" : "Regular"}</span>
        </button>
        <p id="prod-img-status-${p.id}" class="text-xs font-medium mt-0.5 hidden"></p>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="openProdModal('${p.id}')"
                class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
        <button onclick="deleteProductConfirm('${p.id}', '${escAttr(p.name)}')"
                class="btn-admin-sm border-red-300 text-red-500 hover:bg-red-50">Delete</button>
      </div>`;
    list.appendChild(div);
  });
}

window.toggleFeatured = async function (prodId) {
  const prod = products.find(p => p.id === prodId);
  if (!prod) return;
  const newVal = !prod.isFeatured;
  try {
    await updateDoc(doc(db, "products", prodId), { isFeatured: newVal });
    prod.isFeatured = newVal;
    const btn   = $(`feat-btn-${prodId}`);
    const label = $(`feat-label-${prodId}`);
    if (btn) {
      btn.className = btn.className.replace(/bg-\S+|text-\S+-\d+|hover:bg-\S+/g, "").trim()
        + (newVal ? " bg-teal-100 text-teal-700 hover:bg-teal-200" : " bg-gray-100 text-gray-500 hover:bg-gray-200");
      btn.querySelector("span").textContent = newVal ? "⭐" : "☆";
    }
    if (label) label.textContent = newVal ? "Featured" : "Regular";
    showToast("success", `"${prod.name}" is now ${newVal ? "featured" : "regular"}.`);
  } catch (err) {
    showToast("error", "Toggle failed: " + err.message);
  }
};

window.replaceProductImage = async function (prodId, inputEl) {
  const file = inputEl?.files?.[0];
  if (!file) return;
  const thumb  = $(`prod-thumb-${prodId}`);
  const status = $(`prod-img-status-${prodId}`);
  if (thumb)  thumb.style.opacity = "0.4";
  if (status) { status.textContent = "Uploading…"; status.className = "text-xs font-medium mt-0.5 text-accent"; status.classList.remove("hidden"); }
  try {
    const url = await uploadToCloudinary(file, null, null);
    await updateDoc(doc(db, "products", prodId), { imageUrl: url });
    if (thumb)  { thumb.src = url; thumb.style.opacity = "1"; }
    if (status) { status.textContent = "✓ Updated!"; status.className = "text-xs font-medium mt-0.5 text-green-600"; }
    setTimeout(() => status?.classList.add("hidden"), 3000);
    const prod = products.find(p => p.id === prodId);
    if (prod) prod.imageUrl = url;
    showToast("success", "Product image updated!");
  } catch (err) {
    if (thumb)  thumb.style.opacity = "1";
    if (status) { status.textContent = "✗ Upload failed"; status.className = "text-xs font-medium mt-0.5 text-red-500"; }
    showToast("error", "Image upload failed: " + err.message);
  } finally {
    if (inputEl) inputEl.value = "";
  }
};

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

window.closeProdModal = () => $("prod-modal").classList.add("hidden");

window.saveProductForm = async function () {
  const id         = $("prod-edit-id").value;
  const name       = $("prod-name").value.trim();
  let   url        = $("prod-image-url").value.trim();
  const isFeatured = $("prod-featured").checked;
  const file       = $("prod-image-file")?.files?.[0];
  const btn        = $("save-prod-btn");

  if (!name) { showToast("error", "Product name is required."); return; }

  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    if (file) url = await uploadToCloudinary(file, "prod-prog-bar", "prod-prog-wrap");
    const data = { name, imageUrl: url || "", isFeatured };
    if (id) {
      await updateDoc(doc(db, "products", id), data);
      showToast("success", `Product "${name}" updated!`);
    } else {
      await addDoc(collection(db, "products"), data);
      showToast("success", `Product "${name}" added!`);
    }
    window.closeProdModal();
    await loadProducts();
  } catch (err) {
    showToast("error", "Error: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save";
    setProgress("prod-prog-bar", "prod-prog-wrap", 0);
  }
};

window.deleteProductConfirm = async function (id, name) {
  const ok = await confirmDelete(`the product "${name}"`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "products", id));
    showToast("success", `Product "${name}" deleted.`);
    await loadProducts();
  } catch (err) {
    showToast("error", "Delete failed: " + err.message);
  }
};

// ============================================================
// GALLERY — Fixed file upload
// ============================================================
async function loadStoreImages() {
  setLoading("store-images-grid", "Loading images…");
  try {
    const snap = await getDocs(collection(db, "gallery"));
    storeImages = [];
    snap.forEach(d => storeImages.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Gallery] Load failed:", err);
    showToast("error", "Failed to load gallery.");
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
      <img src="${escAttr(img.imageUrl)}" alt="Store image" class="w-full h-36 object-cover"
           onerror="this.src='https://placehold.co/300x150/e5e7eb/9ca3af?text=Error'" />
      <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
        <button onclick="deleteStoreImageConfirm('${img.id}')"
                class="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
          Delete
        </button>
      </div>`;
    grid.appendChild(div);
  });
}

// FIXED gallery upload — clear state properly, check file before upload
window.uploadStoreImage = async function () {
  const fileInput = $("store-img-file");
  const btn       = $("upload-gallery-btn");
  const statusEl  = $("gallery-upload-status");

  // Guard: ensure file input exists and has a file
  if (!fileInput) {
    showToast("error", "File input not found.");
    return;
  }

  const file = fileInput.files?.[0];
  if (!file) {
    showToast("error", "Please select an image file first.");
    return;
  }

  // Show loading state
  btn.disabled    = true;
  btn.textContent = "Uploading…";
  if (statusEl) { statusEl.textContent = "Uploading image…"; statusEl.className = "text-xs text-accent font-medium mt-2"; }

  try {
    const url = await uploadToCloudinary(file, "gallery-prog-bar", "gallery-prog-wrap");

    // Save to Firestore
    await addDoc(collection(db, "gallery"), {
      imageUrl:  url,
      createdAt: serverTimestamp(),
    });

    // Reset file input
    fileInput.value = "";
    if (statusEl) { statusEl.textContent = "✓ Image uploaded successfully!"; statusEl.className = "text-xs text-green-600 font-medium mt-2"; }
    setTimeout(() => { if (statusEl) statusEl.textContent = ""; }, 3000);

    showToast("success", "Gallery image uploaded!");
    await loadStoreImages();
  } catch (err) {
    console.error("[Gallery] Upload failed:", err);
    if (statusEl) { statusEl.textContent = "✗ Upload failed: " + err.message; statusEl.className = "text-xs text-red-500 font-medium mt-2"; }
    showToast("error", "Upload failed: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Upload Image";
    setProgress("gallery-prog-bar", "gallery-prog-wrap", 0);
  }
};

window.addImageByUrl = async function () {
  const input = $("gallery-url-input");
  const url   = input?.value.trim();
  if (!url) { showToast("error", "Please enter an image URL."); return; }
  try {
    await addDoc(collection(db, "gallery"), { imageUrl: url, createdAt: serverTimestamp() });
    if (input) input.value = "";
    showToast("success", "Image added by URL!");
    await loadStoreImages();
  } catch (err) {
    showToast("error", "Failed: " + err.message);
  }
};

window.deleteStoreImageConfirm = async function (id) {
  const ok = await confirmDelete("this gallery image");
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "gallery", id));
    showToast("success", "Gallery image deleted.");
    await loadStoreImages();
  } catch (err) {
    showToast("error", "Delete failed: " + err.message);
  }
};

// ============================================================
// OFFERS — Full CRUD (NEW)
// ============================================================
async function loadOffers() {
  setLoading("offers-admin-list");
  try {
    const q = query(collection(db, "offers"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    offers = [];
    snap.forEach(d => offers.push({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("[Offers] Load failed:", err);
    showToast("error", "Failed to load offers.");
  }
  renderOffersList();
}

function renderOffersList() {
  const list = $("offers-admin-list");
  if (!list) return;

  if (!offers.length) {
    list.innerHTML = `<div class="py-10 text-center text-gray-400 text-sm bg-white rounded-xl border border-dashed border-gray-200">No offers yet. Add one above.</div>`;
    return;
  }

  list.innerHTML = "";
  offers.forEach(offer => {
    const ph  = offer.imageUrl
      ? escAttr(offer.imageUrl)
      : "https://placehold.co/56x56/e5e7eb/6b7280?text=?";

    const div = document.createElement("div");
    div.id        = `offer-row-${offer.id}`;
    div.className = "flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-accent/40 transition-colors";
    div.innerHTML = `
      ${offer.imageUrl
        ? `<img src="${ph}" onerror="this.style.display='none'"
               class="w-14 h-14 rounded-lg object-cover flex-shrink-0 bg-gray-100" alt="${escAttr(offer.title)}" />`
        : `<div class="w-14 h-14 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 text-accent text-xl">🏷️</div>`}
      <div class="flex-1 min-w-0">
        <p class="font-semibold text-gray-800 font-poppins truncate">${esc(offer.title)}</p>
        ${offer.description ? `<p class="text-xs text-gray-500 mt-0.5 line-clamp-2">${esc(offer.description)}</p>` : ""}
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="openOfferModal('${offer.id}')"
                class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
        <button onclick="deleteOfferConfirm('${offer.id}', '${escAttr(offer.title)}')"
                class="btn-admin-sm border-red-300 text-red-500 hover:bg-red-50">Delete</button>
      </div>`;
    list.appendChild(div);
  });
}

window.openOfferModal = function (id = "") {
  const offer = id ? offers.find(o => o.id === id) : null;
  $("offer-modal-title").textContent  = offer ? "Edit Offer" : "Add Offer";
  $("offer-edit-id").value            = id;
  $("offer-title").value              = offer?.title       || "";
  $("offer-description").value        = offer?.description || "";
  $("offer-image-url").value          = offer?.imageUrl    || "";
  $("offer-image-file").value         = "";
  $("offer-modal").classList.remove("hidden");
};

window.closeOfferModal = () => $("offer-modal").classList.add("hidden");

window.saveOfferForm = async function () {
  const id    = $("offer-edit-id").value;
  const title = $("offer-title").value.trim();
  const desc  = $("offer-description").value.trim();
  let   url   = $("offer-image-url").value.trim();
  const file  = $("offer-image-file")?.files?.[0];
  const btn   = $("save-offer-btn");

  if (!title) { showToast("error", "Offer title is required."); return; }

  btn.disabled    = true;
  btn.textContent = "Saving…";

  try {
    if (file) url = await uploadToCloudinary(file, "offer-prog-bar", "offer-prog-wrap");

    const data = {
      title,
      description: desc,
      imageUrl:    url || "",
    };

    if (id) {
      await updateDoc(doc(db, "offers", id), data);
      showToast("success", `Offer "${title}" updated!`);
    } else {
      await addDoc(collection(db, "offers"), { ...data, createdAt: serverTimestamp() });
      showToast("success", `Offer "${title}" added!`);
    }

    window.closeOfferModal();
    await loadOffers();
  } catch (err) {
    showToast("error", "Error: " + err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = "Save Offer";
    setProgress("offer-prog-bar", "offer-prog-wrap", 0);
  }
};

window.deleteOfferConfirm = async function (id, title) {
  const ok = await confirmDelete(`the offer "${title}"`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "offers", id));
    showToast("success", `Offer "${title}" deleted.`);
    await loadOffers();
  } catch (err) {
    showToast("error", "Delete failed: " + err.message);
  }
};

// ============================================================
// REVIEWS
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
    showToast("error", "Failed to load reviews.");
    reviews = [];
  }
  renderReviews();
}

function renderReviews() {
  const list = $("reviews-admin-list");
  if (!list) return;

  if (!reviews.length) {
    list.innerHTML = `<div class="py-10 text-center text-gray-400 text-sm bg-white rounded-xl border border-dashed border-gray-200">No reviews yet.</div>`;
    return;
  }

  list.innerHTML = "";
  reviews.forEach(r => {
    let dateStr = "";
    if (r.createdAt?.toDate) {
      dateStr = r.createdAt.toDate().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }

    const div = document.createElement("div");
    div.id        = `rev-${r.id}`;
    div.className = "p-4 bg-white rounded-xl border border-gray-200";
    div.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div id="rev-display-${r.id}">
            <div class="flex items-center gap-2 mb-1">
              <p class="font-semibold text-gray-800 font-poppins text-sm">${esc(r.name)}</p>
              ${dateStr ? `<span class="text-gray-400 text-xs">· ${dateStr}</span>` : ""}
            </div>
            <p class="text-gray-500 text-sm italic leading-relaxed">"${esc(r.text)}"</p>
          </div>
          <div id="rev-edit-${r.id}" class="hidden space-y-2 mt-1">
            <input type="text" id="rev-name-${r.id}" value="${escAttr(r.name)}"
                   class="admin-input w-full" placeholder="Name" />
            <textarea id="rev-text-${r.id}" rows="3"
                      class="admin-input w-full resize-none" placeholder="Review text">${esc(r.text)}</textarea>
          </div>
        </div>
        <div class="flex flex-col gap-2 flex-shrink-0">
          <button id="rev-edit-btn-${r.id}" onclick="toggleEditReview('${r.id}')"
                  class="btn-admin-sm border-accent text-accent hover:bg-accent hover:text-white">Edit</button>
          <button id="rev-save-btn-${r.id}" onclick="saveReview('${r.id}')"
                  class="hidden btn-admin-sm border-green-400 text-green-600 hover:bg-green-50">Save</button>
          <button onclick="deleteReviewConfirm('${r.id}', '${escAttr(r.name)}')"
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
  if (!name || !text) { showToast("error", "Name and review text are required."); return; }
  try {
    await updateDoc(doc(db, "reviews", id), { name, text });
    showToast("success", "Review updated!");
    await loadReviews();
  } catch (err) {
    showToast("error", "Update failed: " + err.message);
  }
};

window.deleteReviewConfirm = async function (id, name) {
  const ok = await confirmDelete(`the review by "${name}"`);
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "reviews", id));
    showToast("success", "Review deleted.");
    await loadReviews();
  } catch (err) {
    showToast("error", "Delete failed: " + err.message);
  }
};

// ============================================================
// BOOT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initTabs();
});
