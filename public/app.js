
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
async function api(url,opt={}){const r=await fetch(url,{headers:{"Content-Type":"application/json",...(opt.headers||{})},...opt});let d={};try{d=await r.json()}catch{}if(r.status===401){location.href="/"}if(!r.ok)throw Error(d.error||"Request failed");return d}
function shell(active,title,body){document.body.innerHTML=`<aside class="sidebar"><div class="brand"><img src="/logo.svg"></div><div class="nav-title">Main Menu</div><div class="nav">
<a class="${active==="dashboard"?"active":""}" href="/dashboard.html">⌂ <span>Dashboard</span></a>
<a class="${active==="workers"?"active":""}" href="/workers.html">♙ <span>Workers</span></a>
<a class="${active==="companies"?"active":""}" href="/companies.html">▦ <span>Companies</span></a>
<a class="${active==="sites"?"active":""}" href="/sites.html">⌖ <span>Sites & Locations</span></a>
<div class="nav-title">Attendance</div>
<a class="${active==="scan"?"active":""}" href="/scan.html">▣ <span>Scan QR Attendance</span></a>
<a class="${active==="manual"?"active":""}" href="/manual-attendance.html">✎ <span>Manual Attendance</span></a>
<a class="${active==="reports"?"active":""}" href="/reports.html">▤ <span>Reports</span></a>
<div class="nav-title">System</div><a class="${active==="settings"?"active":""}" href="/settings.html">⚙ <span>Settings</span></a>
<a href="#" onclick="logout();return false;">⇥ <span>Logout</span></a></div></aside><main class="main"><header class="topbar"><input class="search" placeholder="Search..." onkeydown="if(event.key==='Enter') alert('Use the relevant page search.')"><div class="user"><div class="avatar">AS</div><div><b id="topUser">Admin</b><small style="display:block;color:#718096">Administrator</small></div></div></header><section class="content"><div class="toolbar"><h1 style="font-family:Georgia,serif;margin:0">${title}</h1></div>${body}</section></main>`}
async function logout(){await api("/api/auth/logout",{method:"POST"});location.href="/"}
async function loadMe(){try{const d=await api("/api/auth/me");const x=$("#topUser");if(x)x.textContent=d.user.username}catch{}}
function toast(m){alert(m)}
