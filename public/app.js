const $ = s => document.querySelector(s);

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));

/* =========================================
API
========================================= */

async function api(url, opt = {}) {
  const r = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(opt.headers || {})
    },
    ...opt
  });

  let d = {};

  try {
    d = await r.json();
  } catch {}

  if (r.status === 401) {
    location.href = "/";
    return;
  }

  if (!r.ok) {
    throw Error(d.error || "Request failed");
  }

  return d;
}

const API = api;

/* =========================================
AL SABIHA PREMIUM UI
========================================= */

function injectPremiumStyles() {

  if (document.getElementById("alSabihaPremiumStyles")) return;

  const style = document.createElement("style");

  style.id = "alSabihaPremiumStyles";

  style.textContent = `

/* =========================================
PREMIUM SIDEBAR
========================================= */

.sidebar{
position:fixed !important;

left:0 !important;
top:0 !important;
bottom:0 !important;

width:245px !important;

padding:18px 12px !important;

overflow-y:auto !important;

z-index:50 !important;

background:
  radial-gradient(
    circle at 20% 10%,
    rgba(245,212,119,.10),
    transparent 28%
  ),
  linear-gradient(
    180deg,
    #061a30 0%,
    #03101f 100%
  ) !important;

color:#fff !important;

border-right:
  1px solid
  rgba(245,212,119,.22) !important;

box-shadow:
  8px 0 30px
  rgba(0,0,0,.25) !important;

backdrop-filter:blur(14px);

-webkit-backdrop-filter:blur(14px);

}

/* =========================================
LOGO
========================================= */

.brand{
height:82px !important;

display:flex !important;

align-items:center !important;

justify-content:center !important;

padding:8px 12px !important;

margin-bottom:8px !important;

border-bottom:
  1px solid
  rgba(245,212,119,.16) !important;

}

.brand img{
width:170px !important;

max-width:90% !important;

max-height:68px !important;

object-fit:contain !important;

display:block !important;

}

/* =========================================
NAVIGATION
========================================= */

.nav{
display:block !important;

padding:0 2px 15px !important;

}

.nav-title{
display:block !important;

color:#91a8bc !important;

font-size:9px !important;

font-weight:700 !important;

letter-spacing:1.8px !important;

text-transform:uppercase !important;

padding:
  14px 9px 6px !important;

}

.nav a{
position:relative !important;

display:flex !important;

align-items:center !important;

gap:9px !important;

width:100% !important;

min-height:39px !important;

padding:
  8px 10px !important;

margin:
  3px 0 !important;

border-radius:9px !important;

color:#dce7f0 !important;

font-family:
  Inter,
  "Segoe UI",
  Arial,
  sans-serif !important;

font-size:12.5px !important;

font-weight:600 !important;

letter-spacing:.15px !important;

text-decoration:none !important;

transition:
  background .2s ease,
  color .2s ease,
  transform .2s ease,
  box-shadow .2s ease !important;

}

.nav a:hover{
background:
rgba(245,212,119,.09) !important;

color:#f5d477 !important;

transform:
  translateX(2px) !important;

}

.nav a.active{
background:
linear-gradient(
90deg,
#f5d477 0%,
#dcae45 100%
) !important;

color:#07192b !important;

font-weight:700 !important;

box-shadow:
  0 5px 15px
  rgba(245,212,119,.18) !important;

}

/* =========================================
SMALL PROFESSIONAL SVG ICONS
========================================= */

.menu-icon{
display:inline-flex !important;

align-items:center !important;

justify-content:center !important;

width:20px !important;

min-width:20px !important;

height:20px !important;

color:currentColor !important;

visibility:visible !important;

opacity:1 !important;

}

.menu-icon svg{
display:block !important;

width:17px !important;

height:17px !important;

fill:none !important;

stroke:currentColor !important;

stroke-width:1.8 !important;

stroke-linecap:round !important;

stroke-linejoin:round !important;

filter:
  drop-shadow(
    0 1px 1px
    rgba(0,0,0,.35)
  ) !important;

transition:
  transform .2s ease,
  filter .2s ease !important;

}

.nav a:hover .menu-icon svg{
transform:
translateY(-1px)
scale(1.05) !important;

filter:
  drop-shadow(
    0 2px 2px
    rgba(0,0,0,.40)
  ) !important;

}

.nav a.active .menu-icon svg{
filter:
drop-shadow(
0 1px 1px
rgba(0,0,0,.25)
) !important;
}

.nav a > span:last-child{
display:inline-block !important;

visibility:visible !important;

opacity:1 !important;

color:inherit !important;

}

/* =========================================
MAIN AREA
========================================= */

.main{
margin-left:245px !important;

min-height:100vh !important;

position:relative !important;

isolation:isolate !important;

background-color:#061526 !important;

background-image:
  linear-gradient(
    rgba(3,16,29,.28),
    rgba(3,16,29,.42)
  ),
  url("/dashboard-dubai.jpg?v=3") !important;

background-size:cover !important;

background-position:center center !important;

background-repeat:no-repeat !important;

background-attachment:fixed !important;

}

.main::before{
content:"" !important;

position:fixed !important;

left:245px !important;

top:0 !important;

right:0 !important;

bottom:0 !important;

z-index:-1 !important;

pointer-events:none !important;

background:
  linear-gradient(
    180deg,
    rgba(2,14,25,.08),
    rgba(2,14,25,.22)
  ) !important;

}

/* =========================================
TOP BAR
========================================= */

.topbar{
background:
linear-gradient(
90deg,
rgba(6,26,48,.96),
rgba(9,39,68,.94)
) !important;

border-bottom:
  1px solid
  rgba(245,212,119,.25) !important;

min-height:64px !important;

box-shadow:
  0 4px 18px
  rgba(0,0,0,.25) !important;

position:sticky !important;

top:0 !important;

z-index:40 !important;

}

.search{
background:
rgba(255,255,255,.09) !important;

border:
  1px solid
  rgba(255,255,255,.15) !important;

color:white !important;

border-radius:9px !important;

}

.search::placeholder{
color:#cbd5e1 !important;
}

.avatar{
background:
linear-gradient(
135deg,
#f8dc86,
#c79532
) !important;

color:#061a30 !important;

font-weight:800 !important;

}

.user b{
color:white !important;
}

.user small{
color:#cbd5e1 !important;
}

/* =========================================
CONTENT
========================================= */

.content{
background:transparent !important;

position:relative !important;

z-index:2 !important;

}

.toolbar{
background:transparent !important;
}

.toolbar h1{
color:white !important;

letter-spacing:.2px;

}

/* =========================================
MOBILE SIDEBAR
========================================= */

@media(max-width:800px){

.sidebar{
  width:220px !important;

  transform:
    translateX(-100%);

  transition:
    transform .25s ease;
}

.sidebar.mobile-open{
  transform:
    translateX(0);
}

.main{
  margin-left:0 !important;

  background-attachment:scroll !important;
}

.main::before{
  left:0 !important;
}

.brand img{
  width:145px !important;
}

.nav a{
  font-size:12.5px !important;

  min-height:38px !important;

  padding:8px 9px !important;
}

.menu-icon{
  width:19px !important;

  min-width:19px !important;

  height:19px !important;
}

.menu-icon svg{
  width:16px !important;

  height:16px !important;
}

}

`;

  document.head.appendChild(style);
}

/* =========================================
SHELL
========================================= */

function shell(active, title, body) {

  injectPremiumStyles();

  document.body.innerHTML = `

<aside class="sidebar">

  <div class="brand">
    <img src="/logo.svg" alt="AL SABIHA">
  </div>

  <div class="nav-title">
    Main Menu
  </div>

  <div class="nav">

    <a
      class="${active === "dashboard" ? "active" : ""}"
      href="/dashboard.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="2"></rect>
          <rect x="14" y="3" width="7" height="7" rx="2"></rect>
          <rect x="3" y="14" width="7" height="7" rx="2"></rect>
          <rect x="14" y="14" width="7" height="7" rx="2"></rect>
        </svg>
      </span>

      <span>Dashboard</span>

    </a>

    <a
      class="${active === "workers" ? "active" : ""}"
      href="/workers.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3"></circle>
          <path d="M3.5 19c.5-3.2 2.4-5 5.5-5s5 1.8 5.5 5"></path>
          <circle cx="17" cy="9" r="2.5"></circle>
          <path d="M15 15c2.8-.2 4.7 1.2 5.5 4"></path>
        </svg>
      </span>

      <span>Workers</span>

    </a>

    <a
      class="${active === "companies" ? "active" : ""}"
      href="/companies.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 21V5.5L12 2l8 3.5V21"></path>
          <path d="M8 21v-4h8v4"></path>
          <path d="M8 9h1M12 9h1M16 9h1M8 12h1M12 12h1M16 12h1"></path>
        </svg>
      </span>

      <span>Companies</span>

    </a>

    <a
      class="${active === "sites" ? "active" : ""}"
      href="/sites.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path>
          <circle cx="12" cy="10" r="2.5"></circle>
        </svg>
      </span>

      <span>Sites & Location</span>

    </a>

    <div class="nav-title">
      Attendance
    </div>

    <a
      class="${active === "scan" ? "active" : ""}"
      href="/scan.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 4h6v2H6v4H4V4Zm10 0h6v6h-2V6h-4V4ZM4 14h2v4h4v2H4v-6Zm14 0h2v6h-6v-2h4v-4Z"></path>
          <rect x="8" y="8" width="3" height="3"></rect>
          <rect x="13" y="8" width="3" height="3"></rect>
          <rect x="8" y="13" width="3" height="3"></rect>
          <rect x="13" y="13" width="3" height="3"></rect>
        </svg>
      </span>

      <span>Scan QR Attendance</span>

    </a>

    <a
      class="${active === "manual" ? "active" : ""}"
      href="/manual-attendance.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="3" width="14" height="18" rx="2"></rect>
          <path d="M9 3.5h6v3H9z"></path>
          <path d="m8 12 2 2 5-5"></path>
          <path d="M8 17h8"></path>
        </svg>
      </span>

      <span>Manual Attendance</span>

    </a>

    <a
      class="${active === "reports" ? "active" : ""}"
      href="/reports.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="3" width="16" height="18" rx="2"></rect>
          <path d="M8 16v-4"></path>
          <path d="M12 16V8"></path>
          <path d="M16 16v-6"></path>
        </svg>
      </span>

      <span>Reports</span>

    </a>

    <div class="nav-title">
      System
    </div>

    <a
      class="${active === "settings" ? "active" : ""}"
      href="/settings.html">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.5V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8-.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4v-2.5h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V5h2.5v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2.5h-.2a1.7 1.7 0 0 0-1.6 1Z"></path>
        </svg>
      </span>

      <span>Setting</span>

    </a>

    <a
      href="#"
      onclick="logout();return false;">

      <span class="menu-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5"></path>
          <path d="M14 8l4 4-4 4"></path>
          <path d="M8 12h10"></path>
        </svg>
      </span>

      <span>Logout</span>

    </a>

  </div>

</aside>

<main class="main">

  <header class="topbar">

    <div style="
      display:flex;
      align-items:center;
      gap:14px;
    ">

      <button
        onclick="toggleSidebar()"
        style="
          background:none;
          border:0;
          color:white;
          font-size:23px;
          cursor:pointer;
        ">

        ☰

      </button>

      <input
        class="search"
        placeholder="Search..."
        onkeydown="
          if(event.key==='Enter')
            alert('Use the relevant page search.')
        "
      >

    </div>

    <div class="user">

      <div class="avatar">
        AS
      </div>

      <div>

        <b id="topUser">
          Admin
        </b>

        <small
          style="
            display:block;
            color:#718096;
          ">

          Administrator

        </small>

      </div>

    </div>

  </header>

  <section class="content">

    <div class="toolbar">

      <h1
        style="
          font-family:Georgia,serif;
          margin:0;
        ">

        ${title}

      </h1>

    </div>

    ${body}

  </section>

</main>

`;
}

/* =========================================
MOBILE SIDEBAR
========================================= */

function toggleSidebar() {

  const sidebar = document.querySelector(".sidebar");

  if (!sidebar) return;

  sidebar.classList.toggle("mobile-open");
}

/* =========================================
LOGOUT
========================================= */

async function logout() {

  try {

    await api(
      "/api/auth/logout",
      { method: "POST" }
    );

  } finally {

    location.href = "/";

  }
}

/* =========================================
CURRENT USER
========================================= */

async function loadMe() {

  try {

    const d = await api("/api/auth/me");

    const x = $("#topUser");

    if (x) {
      x.textContent = d.user.username;
    }

  } catch {}

}

/* =========================================
TOAST
========================================= */

function toast(m) {

  alert(m);

}