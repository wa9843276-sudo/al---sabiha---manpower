const $ = s => document.querySelector(s);

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#39;"
  }[m]));

async function api(url,opt={}){
  const r = await fetch(url,{
    headers:{
      "Content-Type":"application/json",
      ...(opt.headers||{})
    },
    ...opt
  });

  let d={};

  try{
    d=await r.json();
  }catch{}

  if(r.status===401){
    location.href="/";
    return;
  }

  if(!r.ok){
    throw Error(d.error||"Request failed");
  }

  return d;
}


/* =========================================
   AL SABIHA PREMIUM UI
========================================= */

function injectPremiumStyles(){

  if(document.getElementById("alSabihaPremiumStyles")) return;

  const style=document.createElement("style");

  style.id="alSabihaPremiumStyles";

  style.textContent=`

  /* ==============================
     PREMIUM SIDEBAR
  ============================== */

  .sidebar{
    background:
      radial-gradient(circle at 20% 10%,rgba(245,212,119,.12),transparent 28%),
      linear-gradient(180deg,#061a30 0%,#03101f 100%) !important;

    border-right:1px solid rgba(245,212,119,.22);

    box-shadow:
      8px 0 30px rgba(0,0,0,.18);

    width:250px !important;
  }


  .brand{
    height:86px !important;

    display:flex !important;
    align-items:center !important;
    justify-content:center !important;

    padding:12px 20px !important;

    border-bottom:1px solid rgba(245,212,119,.16);
  }


  .brand img{
    width:175px !important;
    max-width:90%;
  }


  .nav-title{
    color:#b9c4d3 !important;

    font-size:11px !important;
    font-weight:700 !important;

    letter-spacing:1.5px !important;
    text-transform:uppercase;

    padding:18px 20px 8px !important;
  }


  .nav{
    padding:0 12px 20px !important;
  }


  .nav a{
    position:relative;

    display:flex !important;
    align-items:center !important;

    gap:13px !important;

    margin:4px 0 !important;
    padding:12px 14px !important;

    border-radius:10px !important;

    color:#e7edf5 !important;

    font-size:14px !important;
    font-weight:500 !important;

    text-decoration:none !important;

    transition:
      background .2s ease,
      color .2s ease,
      transform .2s ease;
  }


  .nav a:hover{
    background:rgba(245,212,119,.10) !important;
    color:#f5d477 !important;
    transform:translateX(2px);
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
      0 6px 18px rgba(245,212,119,.18);
  }


  .nav a.active::before{
    content:"";

    position:absolute;

    left:-12px;
    top:7px;
    bottom:7px;

    width:4px;

    background:#f5d477;

    border-radius:0 4px 4px 0;
  }


  .nav a:first-letter{
    font-size:18px;
  }


  /* ==============================
     MAIN AREA
  ============================== */

  .main{
    background:
      linear-gradient(
        135deg,
        #f4f7fb 0%,
        #ffffff 55%,
        #f4f7fb 100%
      ) !important;
  }


  .topbar{
    background:
      linear-gradient(
        90deg,
        #061a30,
        #092744
      ) !important;

    border-bottom:1px solid rgba(245,212,119,.25) !important;

    min-height:70px !important;

    box-shadow:0 4px 18px rgba(0,0,0,.12);
  }


  .search{
    background:rgba(255,255,255,.09) !important;

    border:1px solid rgba(255,255,255,.15) !important;

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


  .content{
    background:transparent !important;
  }


  .toolbar h1{
    color:#071a2e !important;
    letter-spacing:.2px;
  }


  /* ==============================
     MOBILE
  ============================== */

  @media(max-width:800px){

    .sidebar{
      width:220px !important;
    }

    .brand img{
      width:145px !important;
    }

    .nav a{
      font-size:13px !important;
      padding:11px !important;
    }

  }

  `;

  document.head.appendChild(style);
}


/* =========================================
   SHELL
========================================= */

function shell(active,title,body){

  injectPremiumStyles();

  document.body.innerHTML=`

  <aside class="sidebar">

    <div class="brand">
      <img src="/logo.svg" alt="AL SABIHA">
    </div>


    <div class="nav-title">
      Main Menu
    </div>

    <div class="nav">

      <a
        class="${active==="dashboard"?"active":""}"
        href="/dashboard.html">
        <span>⌂</span>
        <span>Dashboard</span>
      </a>


      <a
        class="${active==="workers"?"active":""}"
        href="/workers.html">
        <span>♙</span>
        <span>Workers</span>
      </a>


      <a
        class="${active==="companies"?"active":""}"
        href="/companies.html">
        <span>▦</span>
        <span>Companies</span>
      </a>


      <a
        class="${active==="sites"?"active":""}"
        href="/sites.html">
        <span>⌖</span>
        <span>Sites & Location</span>
      </a>


      <div class="nav-title">
        Attendance
      </div>


      <a
        class="${active==="scan"?"active":""}"
        href="/scan.html">
        <span>▣</span>
        <span>Scan QR Attendance</span>
      </a>


      <a
        class="${active==="manual"?"active":""}"
        href="/manual-attendance.html">
        <span>✓</span>
        <span>Manual Attendance</span>
      </a>


      <a
        class="${active==="reports"?"active":""}"
        href="/reports.html">
        <span>▤</span>
        <span>Reports</span>
      </a>


      <div class="nav-title">
        System
      </div>


      <a
        class="${active==="settings"?"active":""}"
        href="/setting.html">
        <span>⚙</span>
        <span>Setting</span>
      </a>


      <a
        href="#"
        onclick="logout();return false;">
        <span>⇥</span>
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

function toggleSidebar(){

  const sidebar=document.querySelector(".sidebar");

  if(!sidebar) return;

  sidebar.classList.toggle("mobile-open");
}


/* =========================================
   LOGOUT
========================================= */

async function logout(){

  try{

    await api(
      "/api/auth/logout",
      {method:"POST"}
    );

  }finally{

    location.href="/";

  }
}


/* =========================================
   CURRENT USER
========================================= */

async function loadMe(){

  try{

    const d=await api("/api/auth/me");

    const x=$("#topUser");

    if(x){
      x.textContent=d.user.username;
    }

  }catch{}

}


/* =========================================
   TOAST
========================================= */

function toast(m){
  alert(m);
}