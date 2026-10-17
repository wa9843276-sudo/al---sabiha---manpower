"use strict";
/* Optional UI verification (needs Playwright, not a project dependency).
   Run:  NODE_PATH=$(npm root -g) node tests/browser.check.js
   Uses a throwaway DB with synthetic data. Writes screenshots to ./test-screenshots */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const XLSX = require("xlsx");

const ROOT = path.join(__dirname, "..");
const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, "test-screenshots");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alsabiha-ui-"));
  fs.mkdirSync(SHOTS, { recursive: true });
  const proc = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SESSION_SECRET: "ui", NODE_ENV: "test" } });
  await new Promise(r => proc.stdout.on("data", d => String(d).includes("running on port") && r()));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const api = (m, u, b) => ctx.request.fetch(BASE + u, { method: m, data: b });
  const login = await api("POST", "/api/auth/login", { username: "admin", password: "admin123" });
  check("login via API", login.ok());

  /* synthetic seed */
  const mkC = async (name, roles) => (await (await api("POST", "/api/v2/companies", { name, roles })).json()).id;
  const g = await mkC("Demo Group Co", ["group"]), c1 = await mkC("Demo Client A", ["client"]), c2 = await mkC("Demo Client B", ["client"]);
  const site = (await (await api("POST", "/api/sites", { name: "Demo Site", location: "Yard", company_id: c1 })).json()).id;
  const people = [["D001", "Waqas Ali", "Supplier"], ["D002", "Waqas Ahmed", "Company"], ["D003", "Babar Khan", "Company"],
    ["D004", '<img src=x onerror="window.__xss=1">', "Company"], ["D005", "Aamir <b>Bold</b>", "Supplier"]];
  for (let i = 0; i < 40; i++) people.push(["E" + String(i).padStart(3, "0"), "Worker Number " + i, i % 2 ? "Company" : "Supplier"]);
  const wid = {};
  for (const [code, name, type] of people) {
    const r = await (await api("POST", "/api/v2/workers", { worker_code: code, name, company_type: type, designation: "Welder", sponsor_company_id: g, company_id: i2(code) ? c1 : c2 })).json();
    wid[code] = r.id;
  }
  function i2(c) { return c.charCodeAt(c.length - 1) % 2 === 0; }
  await api("POST", "/api/attendance/checkin", { worker_code: "D001", site_id: site });
  await api("POST", "/api/attendance/checkin", { worker_code: "D002", site_id: site });
  await api("POST", "/api/attendance/checkout", { worker_code: "D002" });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/unpkg|ERR_(NAME|INTERNET|CONNECTION|TUNNEL|FAILED|BLOCKED)/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", d => d.accept());

  /* ---- every nav page: loads, h1, no console errors, no horizontal overflow (desktop + phone) ---- */
  const pages = ["dashboard", "workers", "worker-add", "companies", "quick-actions", "scan", "manual-attendance", "reports", "recent-attendance",
    "analytics", "company-report", "monthly-report", "import", "sites", "settings"];
  for (const w of [1280, 390]) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of pages) {
      errors.length = 0;
      const resp = await page.goto(`${BASE}/${p}.html`, { waitUntil: "networkidle" });
      await page.waitForTimeout(250);
      const info = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent || "", nav: document.querySelectorAll(".nav a").length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, active: document.querySelector(".nav a.active")?.textContent.trim() || "" }));
      check(`[${w}] ${p}.html`, resp.ok() && info.h1 && info.nav === 15 && info.overflow <= 1 && !errors.length,
        `h1="${info.h1}" active="${info.active}" overflow=${info.overflow}${errors.length ? " errors=" + errors.join("|") : ""}`);
      if (["dashboard", "workers", "import", "scan", "reports"].includes(p)) await page.screenshot({ path: path.join(SHOTS, `${p}-${w}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  /* ---- nav links resolve ---- */
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: "networkidle" });
  const hrefs = await page.$$eval(".nav a", a => a.map(x => x.getAttribute("href")));
  const codes = await Promise.all(hrefs.map(async h => (await ctx.request.get(BASE + h)).status()));
  check("all 15 navigation links return 200", codes.every(c => c === 200), JSON.stringify(codes));
  check("logo asset resolves (case-sensitive)", (await ctx.request.get(BASE + "/Logo.svg")).ok());

  /* ---- dashboard is analytics only ---- */
  const dash = await page.evaluate(() => ({ forms: document.querySelectorAll("main form").length, tables: [...document.querySelectorAll("main h2")].map(h => h.textContent) }));
  check("dashboard has no forms / recent-attendance table / quick actions", dash.forms === 0 && !dash.tables.some(t => /recent attendance|quick actions|add worker/i.test(t)), dash.tables.join(" | "));
  const kp = await page.$$eval(".kpi small", s => s.map(x => x.textContent));
  check("dashboard shows required KPI cards", ["Total Workers", "Active Workers", "Inactive Workers", "Group Company Workers", "Supplier Workers", "Today's Present", "Today's Absent", "Currently Checked-In", "Total Companies", "Active Sites"].every(k => kp.includes(k)), kp.join(","));
  check("absent KPI shows N/A (no fabricated number)", (await page.locator(".kpi", { hasText: "Today's Absent" }).innerText()).includes("N/A"));

  /* ---- worker database: two search boxes, highlight, XSS ---- */
  await page.goto(`${BASE}/workers.html`, { waitUntil: "networkidle" });
  check("two independent search boxes", (await page.locator("#sName").count()) === 1 && (await page.locator("#sCode").count()) === 1);
  await page.fill("#sName", "waq"); await page.waitForTimeout(500);
  const marks = await page.$$eval("mark.hl", m => m.map(x => x.textContent));
  check("name search highlights matches", marks.length === 2 && marks.every(m => m.toLowerCase() === "waq"), marks.join(","));
  const mk = await page.$eval("mark.hl", m => { const s = getComputedStyle(m); return s.backgroundColor + "/" + s.color; });
  check("highlight is high-contrast", mk === "rgb(255, 216, 77)/rgb(26, 19, 0)", mk);
  check("total match count shown", /2\s*workers match/.test(await page.locator("#summary").innerText()));
  await page.fill("#sName", ""); await page.fill("#sCode", "d00"); await page.waitForTimeout(500);
  check("ID search works independently", (await page.locator("#rows tr").count()) === 5);
  await page.fill("#sName", "ali"); await page.waitForTimeout(500);
  check("both filters combine", (await page.locator("#rows tr").count()) === 1);
  await page.click("#cName"); await page.click("#cCode"); await page.waitForTimeout(400);
  await page.fill("#sName", "zzzz-nobody"); await page.waitForTimeout(500);
  check("No workers found state", /No workers found/.test(await page.locator("#rows").innerText()));
  await page.fill("#sName", "img"); await page.waitForTimeout(500);
  const xss = await page.evaluate(() => ({ img: document.querySelectorAll("#rows img").length, flag: window.__xss }));
  check("imported HTML in names is rendered as text (no injection)", xss.img === 0 && xss.flag === undefined && /<img src=x/.test(await page.locator("#rows").innerText()));
  await page.fill("#sName", "bold"); await page.waitForTimeout(500);
  check("<b> in a name is escaped", (await page.locator("#rows b", { hasText: "Bold" }).count()) === 0 || (await page.locator("#rows").innerText()).includes("<b>Bold</b>"));
  await page.fill("#sName", ""); await page.waitForTimeout(400);
  check("pagination", /Page 1 of 2/.test(await page.locator("#pageInfo").innerText()));
  await page.click("th[data-sort=code]"); await page.waitForTimeout(400);
  check("sortable columns", (await page.locator("th[data-sort=code]").getAttribute("aria-sort")) === "ascending");

  /* ---- preserve filters across view/back ---- */
  await page.fill("#sName", "waqas ali"); await page.waitForTimeout(500);
  await page.click("#rows tr >> text=View"); await page.waitForURL(/worker\.html/);
  check("profile page loads with details", (await page.locator("h2", { hasText: "Waqas Ali" }).count()) === 1);
  await page.click("text=Back to Worker Database"); await page.waitForURL(/workers\.html/); await page.waitForTimeout(400);
  check("filters preserved after returning from profile", (await page.inputValue("#sName")) === "waqas ali");

  /* ---- reassign through UI ---- */
  await page.click("#rows tr >> text=View"); await page.waitForURL(/worker\.html/);
  await page.selectOption("#rCo", String(c2)); await page.click("#bRe"); await page.click("dialog button[value=yes]"); await page.waitForTimeout(600);
  check("reassignment shows in history", (await page.locator("section", { hasText: "Assignment history" }).innerText()).includes("Demo Client B"));

  /* ---- add worker form ---- */
  await page.goto(`${BASE}/worker-add.html`, { waitUntil: "networkidle" });
  await page.click("#save"); check("required-field validation", /required/i.test(await page.locator("#e_worker_code").innerText()));
  await page.fill("#worker_code", "ui001"); await page.fill("#name", "Ui Created"); await page.click("#save"); await page.waitForTimeout(600);
  check("worker created + profile link", (await page.locator("#msg a", { hasText: "Open profile" }).count()) === 1);
  await page.fill("#worker_code", "UI001"); await page.fill("#name", "Dup"); await page.click("#save"); await page.waitForTimeout(600);
  check("duplicate Employee ID rejected with link", /already exists/.test(await page.locator("#msg").innerText()) && (await page.locator("#msg a", { hasText: "Open existing" }).count()) === 1);

  /* ---- import via UI ---- */
  const HDR = ["Employee ID", "Employee Name", "Designation", "Company Type", "Visa/Sponsor Company", "Working/Assigned Company", "Status", "Mobile Number"];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR, ["X1", "Import One", "Fitter", "Supplier", "Demo Group Co", "Demo Client A", "Active", ""], ["X2", "Bad Co", "", "", "", "Nope Ltd", "", ""]]), "Workers");
  const file = path.join(dataDir, "ui.xlsx"); XLSX.writeFile(wb, file);
  await page.goto(`${BASE}/import.html`, { waitUntil: "networkidle" });
  await page.setInputFiles("#file", file); await page.click("#go"); await page.waitForSelector("#commit");
  check("import preview shows counts and problems", /Unresolved companies/.test(await page.locator("#pv").innerText()) && /not in the company list/.test(await page.locator("#pv").innerText()));
  await page.click("#commit"); await page.click("dialog button[value=yes]"); await page.waitForSelector("#done:not([hidden])");
  check("import summary shown", /Created/.test(await page.locator("#done").innerText()));
  check("import history lists the file", (await page.locator("#hist").innerText()).includes("ui.xlsx"));

  /* ---- scanner page renders (camera lib is a CDN script; offline here) ---- */
  await page.goto(`${BASE}/scan.html`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(500);
  check("scan page renders inside shared layout", (await page.locator(".sidebar").count()) === 1 && /Scan|QR/i.test(await page.locator("main h1").first().innerText()));
  check("scan page has exactly one level-1 heading", (await page.locator("main h1:not([aria-level])").count()) === 1);

  await browser.close(); proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true });
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.writeFileSync(path.join(SHOTS, "results.json"), JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error("RUNNER ERROR", e); process.exit(2); });
