/* AL SABIHA shared front-end layer (frozen shell + helpers).
   Legacy pages keep calling shell(), loadMe(), api(), esc(), $ . */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[m]));

/* Safe highlight: every text fragment is escaped; only <mark> is added. */
function hl(text, query) {
  const t = String(text ?? "");
  const toks = String(query ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6)
    .map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!toks.length) return esc(t);
  const re = new RegExp("(" + toks.join("|") + ")", "gi");
  return t.split(re).map((part, i) => (i % 2 ? `<mark class="hl">${esc(part)}</mark>` : esc(part))).join("");
}

async function api(url, opt = {}) {
  const o = { credentials: "same-origin", ...opt, headers: { ...(opt.headers || {}) } };
  if (o.body && typeof o.body !== "string" && !(o.body instanceof Blob) && !(o.body instanceof ArrayBuffer)) {
    o.body = JSON.stringify(o.body);
  }
  if (typeof o.body === "string" && !o.headers["Content-Type"]) o.headers["Content-Type"] = "application/json";
  const r = await fetch(url, o);
  let d = {};
  try { d = await r.json(); } catch (_) {}
  if (r.status === 401) { location.href = "/login.html"; return new Promise(() => {}); }
  if (!r.ok) { const e = new Error(d.error || d.message || "Request failed"); e.status = r.status; e.data = d; throw e; }
  return d;
}
const API = api;
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== "" && v != null)).toString();
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, type = "info") {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; box.setAttribute("role", "status"); box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "toast " + type; t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), type === "error" ? 7000 : 4000);
}

function confirmDialog(message, { title = "Please confirm", ok = "Confirm", danger = false } = {}) {
  return new Promise(res => {
    const d = document.createElement("dialog"); d.className = "dlg";
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p>${esc(message)}</p>
      <div class="dlg-actions"><button class="btn ghost" value="no">Cancel</button>
      <button class="btn ${danger ? "danger" : "gold"}" value="yes">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    d.addEventListener("close", () => { res(d.returnValue === "yes"); d.remove(); });
    d.showModal();
  });
}

const fmtDT = s => (s ? String(s).replace("T", " ").slice(0, 16) : "—");

/* ------------------------------------------------------------------ navigation */
const NAV = [
  ["Main Menu", [
    ["dashboard", "/dashboard.html", "Dashboard", "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"],
    ["workers", "/workers.html", "Worker Database", "M9 11a3 3 0 100-6 3 3 0 000 6zM3.5 20c.5-3.2 2.4-5 5.5-5s5 1.8 5.5 5M17 10a2.5 2.5 0 100-5M15 15c2.8-.2 4.7 1.2 5.500 4"],
    ["worker-add", "/worker-add.html", "Add Worker", "M12 5v14M5 12h14"],
    ["companies", "/companies.html", "Companies & Suppliers", "M4 21V5.5L12 2l8 3.5V21M8 21v-4h8v4M8 9h1M12 9h1M16 9h1M8 12h1M12 12h1M16 12h1"],
    ["quick", "/quick-actions.html", "Quick Actions", "M13 2L4 14h7l-1 8 9-12h-7z"]]],
  ["Attendance", [
    ["scan", "/scan.html", "Scan QR Attendance", "M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M7 12h10"],
    ["manual", "/manual-attendance.html", "Manual Attendance", "M12 20h9M16.500 3.500a2.100 2.100 0 013 3L7 19l-4 1 1-4z"],
    ["reports", "/reports.html", "Attendance Records", "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"],
    ["recent", "/recent-attendance.html", "Recent Attendance", "M12 8v4l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z"]]],
  ["Analytics & Reports", [
    ["analytics", "/analytics.html", "Attendance Analytics", "M3 3v18h18M7 14l4-4 3 3 5-6"],
    ["company-report", "/company-report.html", "Company-wise Workforce", "M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"],
    ["monthly", "/monthly-report.html", "Monthly Reports", "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4"],
    ["import", "/import.html", "Import & Export", "M12 3v12M7 10l5 5 5-5M4 21h16"]]],
  ["Administration", [
    ["sites", "/sites.html", "Sites & Locations", "M12 21s-7-6.200-7-11a7 7 0 1114 0c0 4.800-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4z"],
    ["settings", "/settings.html", "Settings", "M12 15a3 3 0 100-6 3 3 0 000 6zM19.400 15a1.700 1.700 0 00.300 1.800l.1.1a2 2 0 11-2.800 2.800l-.1-.1a1.700 1.700 0 00-1.800-.3 1.700 1.700 0 00-1 1.500V21a2 2 0 01-4 0v-.1a1.700 1.700 0 00-1.100-1.500 1.700 1.700 0 00-1.800.3l-.1.1a2 2 0 11-2.800-2.800l.1-.1a1.700 1.700 0 00.3-1.800 1.700 1.700 0 00-1.500-1H3a2 2 0 010-4h.1a1.700 1.700 0 001.500-1.100 1.700 1.700 0 00-.3-1.800l-.1-.1a2 2 0 112.800-2.800l.1.100a1.700 1.700 0 001.800.3H9a1.700 1.700 0 001-1.500V3a2 2 0 014 0v.1a1.700 1.700 0 001 1.500 1.700 1.700 0 001.800-.3l.1-.1a2 2 0 112.800 2.800l-.1.1a1.700 1.700 0 00-.3 1.800V9a1.700 1.700 0 001.500 1H21a2 2 0 010 4h-.1a1.700 1.700 0 00-1.500 1z"]]]
];

function shell(active, title, body, opts = {}) {
  document.querySelectorAll('link[href="/style.css"]').forEach(l => l.remove());
  if (!$("#dsCss")) {
    const l = document.createElement("link");
    l.id = "dsCss"; l.rel = "stylesheet"; l.href = "/css/ds.css"; document.head.appendChild(l);
  }
  document.documentElement.lang = "en";
  if (!document.querySelector('meta[name="viewport"]')) {
    const m = document.createElement("meta"); m.name = "viewport"; m.content = "width=device-width,initial-scale=1"; document.head.appendChild(m);
  }
  let group = "";
  const nav = NAV.map(([g, items]) => `<div class="nav-title">${esc(g)}</div>` + items.map(([k, href, label, d]) => {
    if (k === active) group = g;
    return `<a href="${href}" class="${k === active ? "active" : ""}" ${k === active ? 'aria-current="page"' : ""}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg><span>${esc(label)}</span></a>`;
  }).join("")).join("");
  const crumbs = opts.crumbs || [group || "AL SABIHA", title];
  document.body.innerHTML = `
  <a class="skip" href="#main">Skip to content</a>
  <aside class="sidebar" id="sidebar" aria-label="Main navigation">
    <div class="brand"><img src="/Logo.svg" alt="AL SABIHA"><small>Manpower Platform</small></div>
    <nav class="nav">${nav}</nav>
    <div class="nav-foot"><button class="btn ghost block" onclick="logout()">Logout</button></div>
  </aside>
  <div class="scrim" id="scrim" onclick="toggleSidebar()"></div>
  <div class="content">
    <header class="topbar">
      <button class="icon-btn menu-btn" onclick="toggleSidebar()" aria-label="Open menu" aria-controls="sidebar">☰</button>
      <div class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i === crumbs.length - 1 ? `<span aria-current="page">${esc(c)}</span>` : `<span>${esc(c)}</span><i>›</i>`).join("")}</div>
      <form class="topsearch" action="/workers.html" role="search"><input name="name" type="search" placeholder="Find worker by name…" aria-label="Find worker by name"></form>
      <div class="who"><span id="userName">Admin</span></div>
    </header>
    <main id="main" tabindex="-1">
      <div class="page-head"><h1>${esc(title)}</h1>${opts.sub ? `<p>${esc(opts.sub)}</p>` : ""}</div>
      ${body}
    </main>
  </div>`;
  /* one real page heading: any extra legacy <h1> becomes a level-2 heading */
  $$("main h1").slice(1).forEach(h => h.setAttribute("aria-level", "2"));
  document.title = title + " | AL SABIHA";
}

function toggleSidebar() {
  $("#sidebar")?.classList.toggle("open");
  $("#scrim")?.classList.toggle("show");
}
async function logout() {
  try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); } catch (_) {}
  location.href = "/login.html";
}
async function loadMe() {
  try {
    const d = await api("/api/auth/me");
    if ($("#userName")) $("#userName").textContent = d.user.username;
    return d.user;
  } catch (_) {}
}
