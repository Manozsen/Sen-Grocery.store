// ============================================================
// main.js — Public website logic for index.html
// ============================================================

import { db } from "./firebase.js";
import {
  collection, getDocs, addDoc,
  doc, getDoc, query, orderBy, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── DOM helper ───────────────────────────────────────────────
const $  = (id)  => document.getElementById(id);
const el = (sel) => document.querySelector(sel);

// ── Fallback data (used when Firebase fails) ─────────────────
const FALLBACK = {
  settings: {
    tagline:   "Trusted Grocery Store Since 1995",
    aboutText: "Sen Grocery Store has been proudly serving the community of Baradighi, Mal, Jalpaiguri since 1995. Founded with a vision to bring the freshest groceries and daily essentials to every household, we have grown from a small corner shop into the most trusted grocery destination in the region. For nearly three decades, our commitment to quality, affordability, and genuine customer care has never wavered. Whether it's fresh produce, packaged goods, spices, or personal care — our shelves are always stocked with everything your family needs at the best prices in town.",
    phone:     "6296622391",
    whatsapp:  "6296622391",
    address:   "Sen Grocery Store, Kumlai Bridge, Demkajhora, Baradighi, Mal, Jalpaiguri, 735230",
    openTime:  "7:00 AM",
    closeTime: "8:00 PM",
    mapLink:   "https://maps.app.goo.gl/dLS8GtLeGqyk9wKE8",
  },
  categories: [
    { id: "c1", name: "Dairy",         imageUrl: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&q=75", order: 1 },
    { id: "c2", name: "Snacks",        imageUrl: "https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=400&q=75", order: 2 },
    { id: "c3", name: "Beverages",     imageUrl: "https://images.unsplash.com/photo-1625772452859-1c03d5bf1137?w=400&q=75", order: 3 },
    { id: "c4", name: "Grains",        imageUrl: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&q=75", order: 4 },
    { id: "c5", name: "Spices",        imageUrl: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=400&q=75", order: 5 },
    { id: "c6", name: "Personal Care", imageUrl: "https://images.unsplash.com/photo-1556228578-0d85b1a4d571?w=400&q=75", order: 6 },
  ],
  products: [
    { id: "p1", name: "Milk",        imageUrl: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=75",  isFeatured: true },
    { id: "p2", name: "Biscuits",    imageUrl: "https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=75",  isFeatured: true },
    { id: "p3", name: "Rice",        imageUrl: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&q=75", isFeatured: true },
    { id: "p4", name: "Cooking Oil", imageUrl: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=75", isFeatured: true },
    { id: "p5", name: "Soft Drinks", imageUrl: "https://images.unsplash.com/photo-1625772452859-1c03d5bf1137?w=400&q=75", isFeatured: true },
  ],
  reviews: [
    { id: "r1", name: "Rahul Sharma", text: "Best grocery store in the area! Always fresh stock and unbeatable prices. Highly recommended to everyone." },
    { id: "r2", name: "Priya Das",    text: "Shopping here since childhood. Quality never drops and the owner is always helpful and friendly." },
    { id: "r3", name: "Amit Kumar",   text: "Very reliable store. You can find absolutely everything you need here without going anywhere else." },
  ],
};

// ── Utilities ────────────────────────────────────────────────
function setText(id, val) {
  const e = $(id);
  if (e) e.textContent = val ?? "";
}

function setHref(ids, href) {
  (Array.isArray(ids) ? ids : [ids]).forEach(id => {
    const e = $(id);
    if (e) e.href = href;
  });
}

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
  e.className = ok
    ? "mt-3 text-sm font-medium text-green-600"
    : "mt-3 text-sm font-medium text-red-500";
  setTimeout(() => { e.textContent = ""; }, 5000);
}

function spinner() {
  return `<div class="col-span-full flex justify-center items-center py-12 gap-2 text-gray-400">
    <svg class="animate-spin h-5 w-5 text-accent" fill="none" viewBox="0 0 24 24">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
    <span class="text-sm">Loading…</span>
  </div>`;
}

// ── Store open/closed indicator ──────────────────────────────
function parseTime(t) {
  const m = (t || "").match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ap  = m[3].toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function updateOpenIndicator(openTime, closeTime) {
  const indicator = $("open-indicator");
  if (!indicator) return;
  const now   = new Date();
  const cur   = now.getHours() * 60 + now.getMinutes();
  const open  = parseTime(openTime)  ?? 7 * 60;
  const close = parseTime(closeTime) ?? 20 * 60;
  const isOpen = cur >= open && cur < close;
  indicator.innerHTML = isOpen
    ? `<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse inline-block"></span>
       <span class="text-green-600 text-sm font-semibold">Open Now</span>`
    : `<span class="w-2 h-2 rounded-full bg-red-400 inline-block"></span>
       <span class="text-red-500 text-sm font-semibold">Currently Closed</span>`;
}

// ── 1. Settings ──────────────────────────────────────────────
async function loadSettings() {
  let s = FALLBACK.settings;
  try {
    const snap = await getDoc(doc(db, "settings", "main"));
    if (snap.exists()) s = { ...FALLBACK.settings, ...snap.data() };
  } catch (e) {
    console.warn("[Settings] Firebase unavailable, using fallback.", e.message);
  }

  const tagline = s.tagline?.trim() || "Trusted Grocery Store Since 1995";
  setText("hero-tagline",      tagline);
  setText("about-text",        s.aboutText);
  setText("store-address",     s.address);
  setText("location-address",  s.address);
  setText("location-landmark", "📍 Landmark: Kumlai Bridge");
  setText("footer-phone",      `+91 ${s.phone}`);

  const timing = `${s.openTime} – ${s.closeTime}`;
  setText("store-timing",    timing);
  setText("location-timing", timing);

  const phone = s.phone || "6296622391";
  const waNum = s.whatsapp || "6296622391";
  const waMsg = encodeURIComponent("Hi, I want to check product availability");
  const waUrl = `https://wa.me/91${waNum}?text=${waMsg}`;

  setHref(["call-btn", "nav-call-btn", "mobile-call-btn", "about-call-btn", "footer-call-btn"], `tel:${phone}`);
  setHref(["whatsapp-float", "footer-wa-btn"], waUrl);

  const mapBtn = $("map-link-btn");
  if (mapBtn) mapBtn.href = s.mapLink || FALLBACK.settings.mapLink;

  updateOpenIndicator(s.openTime, s.closeTime);
}

// ── 2. Categories ────────────────────────────────────────────
async function loadCategories() {
  const grid = $("categories-grid");
  if (!grid) return;
  grid.innerHTML = spinner();

  let cats = [];
  try {
    const q    = query(collection(db, "categories"), orderBy("order", "asc"));
    const snap = await getDocs(q);
    snap.forEach(d => cats.push({ id: d.id, ...d.data() }));
    if (!cats.length) throw new Error("empty");
  } catch {
    cats = FALLBACK.categories;
  }

  grid.innerHTML = "";
  cats.forEach((cat, i) => {
    const ph = `https://placehold.co/400x400/0A2540/2EC4B6?text=${encodeURIComponent(cat.name)}`;
    const div = document.createElement("div");
    div.className = "group relative overflow-hidden rounded-2xl shadow-md hover:shadow-xl transition-all duration-300 aspect-square cursor-pointer";
    div.setAttribute("data-aos", "fade-up");
    div.setAttribute("data-aos-delay", String(i * 60));
    div.innerHTML = `
      <img
        src="${escAttr(cat.imageUrl || ph)}"
        alt="${escAttr(cat.name)}"
        class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
        loading="lazy"
        onerror="this.src='${ph}'"
      />
      <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"></div>
      <div class="absolute bottom-0 left-0 right-0 p-3">
        <h3 class="text-white font-semibold text-sm sm:text-base font-poppins">${esc(cat.name)}</h3>
      </div>`;
    grid.appendChild(div);
  });
  if (window.AOS) window.AOS.refresh();
}

// ── 3. Featured Products ─────────────────────────────────────
async function loadProducts() {
  const grid = $("products-grid");
  if (!grid) return;
  grid.innerHTML = spinner();

  let prods = [];
  try {
    const q    = query(collection(db, "products"), where("isFeatured", "==", true));
    const snap = await getDocs(q);
    snap.forEach(d => prods.push({ id: d.id, ...d.data() }));
    if (!prods.length) throw new Error("empty");
  } catch {
    prods = FALLBACK.products.filter(p => p.isFeatured);
  }

  grid.innerHTML = "";
  prods.forEach((p, i) => {
    const ph = `https://placehold.co/400x400/F8F9FA/0A2540?text=${encodeURIComponent(p.name)}`;
    const div = document.createElement("div");
    div.className = "bg-white rounded-2xl shadow-sm hover:shadow-lg overflow-hidden transition-all duration-300 group border border-gray-100";
    div.setAttribute("data-aos", "zoom-in");
    div.setAttribute("data-aos-delay", String(i * 70));
    div.innerHTML = `
      <div class="aspect-square overflow-hidden bg-gray-50">
        <img
          src="${escAttr(p.imageUrl || ph)}"
          alt="${escAttr(p.name)}"
          class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-400"
          loading="lazy"
          onerror="this.src='${ph}'"
        />
      </div>
      <div class="p-4 text-center">
        <h3 class="font-semibold text-gray-800 font-poppins text-sm sm:text-base truncate">${esc(p.name)}</h3>
        <p class="text-xs text-accent font-medium mt-1">Available In Store</p>
      </div>`;
    grid.appendChild(div);
  });
  if (window.AOS) window.AOS.refresh();
}

// ── 4. Store Gallery ─────────────────────────────────────────
async function loadGallery() {
  const section = $("gallery-section");
  const gallery = $("store-gallery");
  if (!gallery || !section) return;

  let imgs = [];
  try {
    const snap = await getDocs(collection(db, "storeImages"));
    snap.forEach(d => imgs.push({ id: d.id, ...d.data() }));
  } catch {
    imgs = [];
  }

  if (!imgs.length) {
    section.style.display = "none";
    return;
  }

  gallery.innerHTML = "";
  imgs.forEach(img => {
    const div = document.createElement("div");
    div.className = "flex-shrink-0 w-64 h-48 rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-shadow snap-start";
    div.innerHTML = `
      <img
        src="${escAttr(img.imageUrl)}"
        alt="Store image"
        class="w-full h-full object-cover hover:scale-105 transition-transform duration-400"
        loading="lazy"
        onerror="this.parentElement.remove()"
      />`;
    gallery.appendChild(div);
  });
}

// ── 5. Reviews ───────────────────────────────────────────────
async function loadReviews() {
  const grid = $("reviews-grid");
  if (!grid) return;

  let reviews = [];
  try {
    const q    = query(collection(db, "reviews"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    snap.forEach(d => reviews.push({ id: d.id, ...d.data() }));
    if (!reviews.length) throw new Error("empty");
  } catch {
    reviews = FALLBACK.reviews;
  }

  grid.innerHTML = "";
  if (!reviews.length) {
    grid.innerHTML = `<p class="col-span-full text-center text-gray-400 py-6">No reviews yet — be the first!</p>`;
    return;
  }

  reviews.forEach((r, i) => {
    const initials = (r.name || "?")
      .split(" ")
      .map(w => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

    const div = document.createElement("div");
    div.className = "bg-bglight rounded-2xl p-6 border border-gray-100 hover:shadow-md transition-shadow duration-300";
    div.setAttribute("data-aos", "fade-up");
    div.setAttribute("data-aos-delay", String(i * 80));
    div.innerHTML = `
      <div class="flex items-center gap-3 mb-4">
        <div class="w-11 h-11 rounded-full bg-primary flex items-center justify-center text-accent font-bold text-sm flex-shrink-0 font-poppins">
          ${initials}
        </div>
        <div>
          <h4 class="font-semibold text-gray-800 font-poppins text-sm">${esc(r.name)}</h4>
          <div class="text-yellow-400 text-sm leading-none mt-0.5">★★★★★</div>
        </div>
      </div>
      <p class="text-gray-600 text-sm leading-relaxed italic">"${esc(r.text)}"</p>`;
    grid.appendChild(div);
  });
  if (window.AOS) window.AOS.refresh();
}

// ── 6. Review Submission ─────────────────────────────────────
function initReviewForm() {
  const form = $("review-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("review-name").value.trim();
    const text = $("review-text").value.trim();
    const btn  = $("review-submit-btn");

    if (!name || !text) {
      showMsg("review-msg", "Please fill in both fields.", false);
      return;
    }
    if (text.length < 10) {
      showMsg("review-msg", "Review must be at least 10 characters.", false);
      return;
    }

    btn.disabled    = true;
    btn.textContent = "Submitting…";

    try {
      await addDoc(collection(db, "reviews"), { name, text, createdAt: serverTimestamp() });
      showMsg("review-msg", "✓ Thank you! Your review has been submitted.", true);
      form.reset();
      await loadReviews();
    } catch (err) {
      console.error("[ReviewForm]", err);
      showMsg("review-msg", "Submission failed. Please try again.", false);
    } finally {
      btn.disabled    = false;
      btn.textContent = "Submit Review";
    }
  });
}

// ── 7. Mobile Nav ────────────────────────────────────────────
function initNav() {
  const toggle = $("nav-toggle");
  const menu   = $("nav-menu");
  if (!toggle || !menu) return;

  toggle.addEventListener("click", () => menu.classList.toggle("hidden"));
  menu.querySelectorAll("a").forEach(a => a.addEventListener("click", () => menu.classList.add("hidden")));

  // Sticky style on scroll
  const nav = $("main-nav");
  if (nav) {
    window.addEventListener("scroll", () => {
      nav.classList.toggle("scrolled", window.scrollY > 60);
    }, { passive: true });
  }
}

// ── 8. Service Worker ────────────────────────────────────────
function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(r => console.log("[SW] Registered:", r.scope))
      .catch(e => console.warn("[SW] Failed:", e));
  }
}

// ── BOOT ─────────────────────────────────────────────────────
async function init() {
  registerSW();
  initNav();

  await loadSettings();
  await Promise.all([loadCategories(), loadProducts(), loadGallery(), loadReviews()]);

  initReviewForm();

  if (window.AOS) {
    window.AOS.init({ duration: 650, once: true, offset: 70, easing: "ease-out-cubic" });
  }
}

document.readyState === "loading"
  ? document.addEventListener("DOMContentLoaded", init)
  : init();
