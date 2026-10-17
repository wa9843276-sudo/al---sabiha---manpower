"use strict";
/* Run: npm test   (uses a throwaway DATA_DIR with SYNTHETIC data only) */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const XLSX = require("xlsx");
const Database = require("better-sqlite3");

const ROOT = path.join(__dirname, "..");
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let proc, dataDir, raw;

function req(method, url, { body, cookie, headers = {}, buf } = {}) {
  return new Promise((resolve, reject) => {
    const data = buf || (body !== undefined ? JSON.stringify(body) : null);
    const h = { ...headers };
    if (body !== undefined) h["Content-Type"] = "application/json";
    if (buf) h["Content-Type"] = "application/octet-stream";
    if (cookie) h.Cookie = cookie;
    if (data) h["Content-Length"] = Buffer.byteLength(data);
    const r = http.request(BASE + url, { method, headers: h }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const b = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(b.toString("utf8")); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, json, buf: b });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}
async function loginAs(u = "admin", p = "admin123") {
  const r = await req("POST", "/api/auth/login", { body: { username: u, password: p } });
  assert.equal(r.status, 200);
  return r.headers["set-cookie"][0].split(";")[0];
}
const xlsxBuf = rows => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Workers");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};
const parseXlsx = buf => XLSX.utils.sheet_to_json(XLSX.read(buf, { type: "buffer" }).Sheets[XLSX.read(buf, { type: "buffer" }).SheetNames[0]], { header: 1, raw: true });
const ids = {};
let C; // admin cookie

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "alsabiha-test-"));
  proc = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SESSION_SECRET: "test-secret",
      MOBILE_APP_PIN: "424242", NODE_ENV: "test" }
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("server start timeout")), 15000);
    proc.stdout.on("data", d => { if (String(d).includes("running on port")) { clearTimeout(t); res(); } });
    proc.stderr.on("data", d => { if (String(d).includes("MIGRATION FAILED")) rej(new Error(String(d))); });
  });
  raw = new Database(path.join(dataDir, "attendance.db"));
  C = await loginAs();
  // synthetic company roles for the fixtures
  const comps = (await req("GET", "/api/v2/companies", { cookie: C })).json.items;
  for (const c of comps) ids[c.name] = c.id;
});
after(() => { proc && proc.kill(); raw && raw.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

/* ---------------------------------------------------------------- auth/security */
test("health + login + wrong login + unauthenticated v2 blocked", async () => {
  assert.equal((await req("GET", "/api/health")).status, 200);
  assert.equal((await req("POST", "/api/auth/login", { body: { username: "admin", password: "nope" } })).status, 401);
  assert.equal((await req("GET", "/api/v2/workers")).status, 401);
  assert.equal((await req("GET", "/api/auth/me", { cookie: C })).json.user.username, "admin");
});

test("login rate limiting (429 after repeated failures)", async () => {
  let last;
  for (let i = 0; i < 12; i++)
    last = await req("POST", "/api/auth/login", { body: { username: "ratelimit-user", password: "x" } });
  assert.equal(last.status, 429);
});

test("cross-site POST is blocked (CSRF origin check)", async () => {
  const r = await req("POST", "/api/v2/companies", { cookie: C, body: { name: "EVIL" }, headers: { Origin: "http://evil.example" } });
  assert.equal(r.status, 403);
});

test("security headers present", async () => {
  const r = await req("GET", "/api/health");
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.headers["x-powered-by"], undefined);
});

test("migration seeds companies without guessing categories; sessions persist in SQLite", () => {
  const n = name => raw.prepare("SELECT id,review_required rr FROM companies WHERE name=?").get(name);
  assert.ok(n("SAHAT AL MADINA"), "seeded");
  assert.equal(n("SAHAT AL MADINA").rr, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM company_roles WHERE company_id=?").get(n("SAHAT AL MADINA").id).c, 0);
  assert.ok(raw.prepare("SELECT COUNT(*) c FROM sessions").get().c >= 1);
});

/* ---------------------------------------------------------------- workers */
test("create worker: validation, normalization, duplicates", async () => {
  const mk = b => req("POST", "/api/v2/workers", { cookie: C, body: b });
  const g = (await req("POST", "/api/v2/companies", { cookie: C, body: { name: "Test Group Co", roles: ["group"] } })).json.id;
  const cl = (await req("POST", "/api/v2/companies", { cookie: C, body: { name: "Test Client Co", roles: ["client"] } })).json.id;
  const cl2 = (await req("POST", "/api/v2/companies", { cookie: C, body: { name: "Test Client Two", roles: ["client"] } })).json.id;
  ids.g = g; ids.cl = cl; ids.cl2 = cl2;
  const ok = await mk({ worker_code: " t001 ", name: "  Waqas   Ali ", designation: "Admin", company_type: "Group Company",
    sponsor_company_id: g, company_id: cl, status: "Active" });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.worker_code, "T001");
  ids.w1 = ok.json.id;
  const w = raw.prepare("SELECT * FROM workers WHERE id=?").get(ids.w1);
  assert.equal(w.name, "Waqas Ali");
  assert.equal(w.vendor, "Test Group Co");               // sponsor kept separate from working company
  assert.equal(w.company_id, cl);
  assert.notEqual(w.company_id, w.sponsor_company_id);
  assert.equal((await mk({ worker_code: "t001", name: "Dup" })).status, 409);       // case-insensitive duplicate
  assert.equal((await mk({ worker_code: "bad id", name: "X" })).status, 400);
  assert.equal((await mk({ worker_code: "T002" })).status, 400);                     // name required
  assert.equal((await mk({ worker_code: "T003", name: "X", company_id: 99999 })).status, 400);
  assert.equal((await mk({ worker_code: "T004", name: "X", company_type: "Weird" })).status, 400);
  assert.equal((await mk({ worker_code: "T005", name: "X", vendor: "Not A Company" })).status, 400);
  for (const [c, n, t, co] of [["T010", "Aamir Khan", "Supplier", cl], ["T011", "Babar Ali", "Company", cl],
    ["T012", "Waqas Ahmed", "Supplier", cl2], ["T013", "<img src=x onerror=alert(1)>", "Company", cl2],
    ["T014", "=HYPERLINK(\"http://x\")", "Company", null]])
    assert.equal((await mk({ worker_code: c, name: n, company_type: t, company_id: co, designation: "Welder" })).status, 201);
});

test("search: name, code, combined, whitespace, wildcard escaping, pagination", async () => {
  const q = p => req("GET", "/api/v2/workers?" + p, { cookie: C }).then(r => r.json);
  assert.deepEqual((await q("name=waqas")).items.map(i => i.worker_code).sort(), ["T001", "T012"]);
  assert.equal((await q("name=%20%20WAQAS%20%20ali")).total, 1);              // case + whitespace tolerant
  assert.equal((await q("code=t01")).total, 5);
  assert.equal((await q("name=waqas&code=T012")).total, 1);
  assert.equal((await q("name=%25")).total, 0);                                // % is literal, not a wildcard
  assert.equal((await q("name=nobody-here")).total, 0);
  const p = await q("page_size=2&page=2&sort=code");
  assert.equal(p.items.length, 2); assert.equal(p.page, 2); assert.ok(p.pages >= 3);
  assert.equal((await q("company_type=Supplier")).total, 2);
});

test("PATCH is partial; Employee ID immutable; profile + history", async () => {
  const r = await req("PATCH", `/api/v2/workers/${ids.w1}`, { cookie: C, body: { designation: "Supervisor" } });
  assert.equal(r.status, 200);
  const w = raw.prepare("SELECT * FROM workers WHERE id=?").get(ids.w1);
  assert.equal(w.designation, "Supervisor");
  assert.equal(w.status, "Active"); assert.equal(w.company_id, ids.cl);     // untouched
  assert.equal((await req("PATCH", `/api/v2/workers/${ids.w1}`, { cookie: C, body: { worker_code: "NEW" } })).status, 400);
  const prof = (await req("GET", `/api/v2/workers/${ids.w1}`, { cookie: C })).json;
  assert.equal(prof.worker.company_name, "Test Client Co");
  assert.equal(prof.worker.sponsor_name, "Test Group Co");
  assert.ok(prof.assignment_history.length >= 1);
});

/* ---------------------------------------------------------------- attendance */
test("QR check-in/out, duplicate check-in blocked, manual validation, auto-checkout 12h", async () => {
  const site = (await req("POST", "/api/sites", { cookie: C, body: { name: "Test Site", location: "X", company_id: ids.cl } })).json.id;
  ids.site = site;
  const ci = await req("POST", "/api/attendance/checkin", { cookie: C, body: { worker_code: "T001", site_id: site } });
  assert.equal(ci.status, 200);
  assert.equal((await req("POST", "/api/attendance/checkin", { cookie: C, body: { worker_code: "T001", site_id: site } })).status, 409);
  const lk = (await req("POST", "/api/attendance/lookup", { cookie: C, body: { worker_code: "T001" } })).json;
  assert.equal(lk.assigned_company.name, "Test Client Co");                          // current assignment shown
  assert.equal(lk.currently_checked_in, true);
  assert.equal((await req("POST", "/api/attendance/checkout", { cookie: C, body: { worker_code: "T001" } })).status, 200);
  assert.equal((await req("POST", "/api/attendance/checkout", { cookie: C, body: { worker_code: "T001" } })).status, 404);

  const man = b => req("POST", "/api/attendance/manual", { cookie: C, body: { site_id: site, ...b } });
  assert.equal((await man({ worker_id: ids.w1, check_in: "garbage" })).status, 400);
  assert.equal((await man({ worker_id: ids.w1, check_in: "2026-01-02 10:00", check_out: "2026-01-02 08:00" })).status, 400);
  assert.equal((await man({ worker_id: ids.w1, check_in: "2026-01-02T08:00", check_out: "2026-01-02T17:30" })).status, 200);
  const row = raw.prepare("SELECT * FROM attendance WHERE attendance_date='2026-01-02'").get();
  assert.equal(row.check_in, "2026-01-02 08:00:00");
  assert.equal(row.company_id, ids.cl);                                              // defaulted to current company

  // auto checkout: open record older than 12h closes at exactly check_in + 12h
  const w2 = raw.prepare("SELECT id FROM workers WHERE worker_code='T010'").get().id;
  const old = raw.prepare("SELECT datetime('now','+4 hours','-13 hours') t").get().t;
  assert.equal((await man({ worker_id: w2, check_in: old })).status, 200);
  await req("GET", "/api/v2/attendance", { cookie: C });                              // triggers auto-checkout
  const a = raw.prepare("SELECT check_in,check_out,remarks FROM attendance WHERE worker_id=? ORDER BY id DESC").get(w2);
  assert.equal(a.check_out, raw.prepare("SELECT datetime(?, '+12 hours') t").get(a.check_in).t);
  assert.match(a.remarks, /Automatic checkout/);
  // a recent open record (<12h) stays open and a manual checkout earlier is valid
  const w3 = raw.prepare("SELECT id FROM workers WHERE worker_code='T011'").get().id;
  assert.equal((await req("POST", "/api/attendance/checkin", { cookie: C, body: { worker_code: "T011", site_id: site } })).status, 200);
  await req("GET", "/api/v2/attendance", { cookie: C });
  assert.equal(raw.prepare("SELECT check_out FROM attendance WHERE worker_id=?").get(w3).check_out, null);
  assert.equal((await req("POST", "/api/attendance/checkout", { cookie: C, body: { worker_code: "T011" } })).status, 200);
});

test("reassignment updates current counts but never rewrites historical attendance", async () => {
  const before = raw.prepare("SELECT id,company_id FROM attendance WHERE worker_id=?").all(ids.w1);
  assert.ok(before.length >= 2);
  const r = await req("POST", `/api/v2/workers/${ids.w1}/reassign`, { cookie: C, body: { company_id: ids.cl2, note: "moved" } });
  assert.equal(r.status, 200); assert.equal(r.json.changed, true);
  assert.deepEqual(raw.prepare("SELECT id,company_id FROM attendance WHERE worker_id=?").all(ids.w1), before);
  const wf = (await req("GET", "/api/v2/reports/company-workforce", { cookie: C })).json;
  const row = n => wf.items.find(x => x.company_name === n);
  assert.equal(row("Test Client Co").active_workers, 2);        // T010, T011
  assert.equal(row("Test Client Two").active_workers, 3);       // T001(moved), T012, T013
  // totals count each worker once
  assert.equal(wf.totals.total_workers, raw.prepare("SELECT COUNT(*) c FROM workers").get().c);
  const h = (await req("GET", `/api/v2/workers/${ids.w1}`, { cookie: C })).json.assignment_history;
  assert.equal(h[0].to_company, "Test Client Two"); assert.equal(h[0].from_company, "Test Client Co");
  assert.equal((await req("POST", `/api/v2/workers/${ids.w1}/reassign`, { cookie: C, body: { company_id: ids.cl2 } })).json.changed, false);
});

/* ---------------------------------------------------------------- dashboard */
test("dashboard metrics equal independent SQL; absent is not fabricated", async () => {
  const d = (await req("GET", "/api/v2/dashboard", { cookie: C })).json;
  const c = s => raw.prepare(s).get().c;
  assert.equal(d.kpis.total_workers, c("SELECT COUNT(*) c FROM workers"));
  assert.equal(d.kpis.active_workers, c("SELECT COUNT(*) c FROM workers WHERE status='Active'"));
  assert.equal(d.kpis.group_company_workers, c("SELECT COUNT(*) c FROM workers WHERE status='Active' AND employee_type='Company'"));
  assert.equal(d.kpis.supplier_workers, c("SELECT COUNT(*) c FROM workers WHERE status='Active' AND employee_type='Supplier'"));
  assert.equal(d.kpis.present_today, c(`SELECT COUNT(DISTINCT worker_id) c FROM attendance WHERE attendance_date='${d.date}' AND check_in IS NOT NULL`));
  assert.equal(d.kpis.checked_in_now, c("SELECT COUNT(DISTINCT worker_id) c FROM attendance WHERE check_in IS NOT NULL AND check_out IS NULL"));
  assert.equal(d.kpis.absent_today, null);
  assert.equal(d.charts.by_company.reduce((s, x) => s + x.count, 0), d.kpis.active_workers);   // unique, no double count
  assert.equal(d.charts.by_type.reduce((s, x) => s + x.count, 0), d.kpis.active_workers);
  assert.equal(d.charts.daily_trend.length, 30);
  const f = (await req("GET", `/api/v2/dashboard?company_id=${ids.cl2}`, { cookie: C })).json;
  assert.equal(f.kpis.active_workers, 3);
  assert.ok(d.definitions.absent_today.startsWith("Unavailable"));
});

test("legacy dashboard no longer reports every worker as absent", async () => {
  const d = (await req("GET", "/api/dashboard", { cookie: C })).json;
  assert.equal(d.absent_today, null);
  assert.ok("present_today" in d && "company_summary" in d);           // legacy shape preserved
});

/* ---------------------------------------------------------------- import */
const HDR = ["Employee ID", "Employee Name", "Designation", "Company Type", "Visa/Sponsor Company", "Working/Assigned Company", "Status", "Mobile Number"];
const preview = (rows, name = "w.xlsx") => req("POST", "/api/v2/import/preview", { cookie: C, buf: xlsxBuf(rows), headers: { "X-Filename": name } });

test("template downloads and parses back", async () => {
  const r = await req("GET", "/api/v2/import/template.xlsx", { cookie: C });
  assert.equal(r.status, 200);
  const wb = XLSX.read(r.buf, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Workers", "Instructions", "Valid Companies"]);
  assert.deepEqual(XLSX.utils.sheet_to_json(wb.Sheets.Workers, { header: 1 })[0], HDR);
});

test("import preview: counts, errors, rules; nothing written before commit", async () => {
  const before = raw.prepare("SELECT COUNT(*) c FROM workers").get().c;
  const p = await preview([HDR,
    ["N100", "New One", "Welder", "Group Company", "Test Group Co", "Test Client Co", "Active", "+971501234567"],
    ["N101", "New Two", "Fitter", "Supplier", "", "", "", ""],
    ["t001", "Waqas Ali Renamed", "", "", "", "Test Client Co", "", ""],        // existing: update name + company
    ["T011", "Babar Ali", "Welder", "Group Company", "", "", "", ""],           // existing: unchanged
    ["N100", "Dup In File", "", "", "", "", "", ""],                            // duplicate in file
    ["", "No Id", "", "", "", "", "", ""],                                      // missing required
    ["N102", "", "", "", "", "", "", ""],                                       // missing name
    ["N103", "Bad Type", "", "Alien", "", "", "", ""],
    ["N104", "Unknown Co", "", "", "", "Mystery Corp", "", ""],                 // unresolved company
    ["N105", "=cmd|' /C calc'!A0", "", "", "", "", "", ""],                      // formula-like
    ["N106", "Bad Phone", "", "", "", "", "", "abc"]]);
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const c = p.json.counts;
  assert.equal(p.json.total_rows, 11);
  assert.equal(c.new, 2); assert.equal(c.update, 1); assert.equal(c.unchanged, 1);
  assert.equal(c.invalid, 7); assert.equal(c.duplicate_in_file, 1);
  assert.equal(c.unresolved_company, 1); assert.equal(c.missing_required, 2);
  assert.equal(p.json.valid_rows, 4);
  assert.ok(p.json.rules.length >= 5);
  const upd = p.json.sample.find(s => s.action === "update");
  assert.deepEqual(upd.changes.map(x => x.field).sort(), ["Employee Name", "Working/Assigned Company"]);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM workers").get().c, before);
  const er = await req("GET", `/api/v2/import/preview/${p.json.token}/errors.xlsx`, { cookie: C });
  assert.equal(er.status, 200);
  assert.ok(parseXlsx(er.buf).length >= 7);
  ids.token = p.json.token;
});

test("import commit add-only: creates new, leaves existing untouched, writes history", async () => {
  const r = await req("POST", "/api/v2/import/commit", { cookie: C, body: { token: ids.token, mode: "add_only" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.created, 2); assert.equal(r.json.updated, 0); assert.equal(r.json.skipped, 2);
  assert.equal(raw.prepare("SELECT name FROM workers WHERE worker_code='T001'").get().name, "Waqas Ali");
  const n = raw.prepare("SELECT * FROM workers WHERE worker_code='N100'").get();
  assert.equal(n.company_id, ids.cl); assert.equal(n.vendor, "Test Group Co"); assert.equal(n.mobile, "+971501234567");
  assert.equal(raw.prepare("SELECT employee_type t FROM workers WHERE worker_code='N101'").get().t, "Supplier");
  assert.equal(raw.prepare("SELECT status FROM workers WHERE worker_code='N101'").get().status, "Active");
  assert.equal((await req("POST", "/api/v2/import/commit", { cookie: C, body: { token: ids.token } })).status, 400);   // token single-use
  const h = (await req("GET", "/api/v2/import/history", { cookie: C })).json.items[0];
  assert.equal(h.created, 2); assert.equal(h.username, "admin"); assert.equal(h.filename, "w.xlsx"); assert.equal(h.has_errors, 1);
  const rep = await req("GET", r.json.error_report_url, { cookie: C });
  assert.equal(rep.status, 200);
});

test("import update mode: only non-empty differing cells change; blanks never erase; no deletions", async () => {
  raw.prepare("UPDATE workers SET mobile='+971500000001' WHERE worker_code='N101'").run();
  const total = raw.prepare("SELECT COUNT(*) c FROM workers").get().c;
  const p = await preview([HDR,
    ["N101", "New Two Updated", "", "", "", "Test Client Two", "", ""],     // blank designation/mobile must NOT erase
    ["T001", "Waqas Ali", "", "", "", "", "Inactive", ""]]);
  assert.equal(p.json.counts.update, 2);
  const r = await req("POST", "/api/v2/import/commit", { cookie: C, body: { token: p.json.token, mode: "add_and_update" } });
  assert.equal(r.json.updated, 2);
  const w = raw.prepare("SELECT * FROM workers WHERE worker_code='N101'").get();
  assert.equal(w.name, "New Two Updated"); assert.equal(w.designation, "Fitter");
  assert.equal(w.mobile, "+971500000001"); assert.equal(w.company_id, ids.cl2);
  assert.equal(raw.prepare("SELECT status FROM workers WHERE worker_code='T001'").get().status, "Inactive");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM workers").get().c, total);      // nobody deleted
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM worker_assignments WHERE worker_id=?").get(w.id).c, 1);
});

test("import rejects bad files", async () => {
  const bad = (buf, name) => req("POST", "/api/v2/import/preview", { cookie: C, buf, headers: { "X-Filename": name } });
  assert.equal((await bad(Buffer.from("hello"), "x.txt")).status, 400);
  assert.equal((await bad(Buffer.from("not a zip"), "x.xlsx")).status, 400);
  assert.equal((await bad(Buffer.alloc(0), "x.xlsx")).status, 400);
  assert.equal((await bad(xlsxBuf([["Foo", "Bar"], ["1", "2"]]), "x.xlsx")).status, 400);        // missing required columns
  const csv = await bad(Buffer.from("Employee ID,Employee Name\nC1,Csv Person\n"), "x.csv");
  assert.equal(csv.status, 200); assert.equal(csv.json.counts.new, 1);                           // csv supported
  assert.equal((await req("POST", "/api/v2/import/preview", { buf: xlsxBuf([HDR]), headers: { "X-Filename": "a.xlsx" } })).status, 401);
});

/* ---------------------------------------------------------------- export */
test("worker export respects filters and neutralizes formulas", async () => {
  const r = await req("GET", "/api/v2/export/workers.xlsx?name=waqas", { cookie: C });
  assert.equal(r.status, 200);
  const rows = parseXlsx(r.buf);
  assert.deepEqual(rows[0], ["Employee ID", "Employee Name", "Designation", "Company Type", "Visa/Sponsor Company", "Working/Assigned Company", "Status"]);
  assert.equal(rows.length - 1, 2);
  const all = parseXlsx((await req("GET", "/api/v2/export/workers.xlsx", { cookie: C })).buf);
  const evil = all.find(x => String(x[0]) === "T014");
  assert.equal(evil[1][0], "'");                                                    // =HYPERLINK(...) is neutralized
  assert.ok(!all[0].includes("Salary") && !all[0].includes("Mobile Number"));
});

test("attendance / company / monthly exports", async () => {
  const a = await req("GET", "/api/v2/export/attendance.xlsx?date_from=2026-01-01&date_to=2026-01-31", { cookie: C });
  const rows = parseXlsx(a.buf);
  assert.equal(rows.length, 2);
  assert.equal(typeof rows[1][5], "number");                                         // real Excel datetime
  assert.equal(rows[1][4], "Test Site");
  assert.equal((await req("GET", "/api/v2/export/company-workforce.xlsx", { cookie: C })).status, 200);
  const m = await req("GET", "/api/v2/export/monthly.xlsx?month=2026-01", { cookie: C });
  assert.equal(parseXlsx(m.buf)[1][3], 1);
  assert.equal((await req("GET", "/api/v2/export/monthly.xlsx", { cookie: C })).status, 400);
  const mj = (await req("GET", "/api/v2/reports/monthly?month=2026-01", { cookie: C })).json;
  assert.equal(mj.items[0].total_hours, 9.5);                                       // 08:00 → 17:30
});

/* ---------------------------------------------------------------- companies */
test("company master: duplicates, categories, multi-role, deactivation guard", async () => {
  const mk = b => req("POST", "/api/v2/companies", { cookie: C, body: b });
  assert.equal((await mk({ name: "  test   group co " })).status, 409);
  const both = await mk({ name: "Dual Role Co", roles: ["supplier", "client"] });
  assert.equal(both.status, 201);
  assert.equal((await mk({ name: "Bad Role", roles: ["king"] })).status, 400);
  const list = (await req("GET", "/api/v2/companies?role=client", { cookie: C })).json;
  assert.ok(list.items.some(c => c.name === "Dual Role Co" && c.roles.length === 2));
  assert.equal((await req("PATCH", `/api/v2/companies/${ids.cl2}`, { cookie: C, body: { status: "Inactive" } })).status, 409);
  assert.equal((await req("PATCH", `/api/v2/companies/${both.json.id}`, { cookie: C, body: { status: "Inactive" } })).status, 200);
  assert.equal((await req("GET", "/api/v2/companies?role=unclassified", { cookie: C })).json.items.every(c => c.roles.length === 0), true);
});

/* ---------------------------------------------------------------- worker app / mobile / destructive */
test("worker app no longer exposes salary; mobile PIN header-only", async () => {
  raw.prepare("UPDATE workers SET salary=1234 WHERE worker_code='T011'").run();
  const r = await req("POST", "/api/worker-app/login", { body: { identifier: "T011" } });
  assert.equal(r.status, 200);
  assert.ok(!("salary" in r.json.worker));
  const ck = r.headers["set-cookie"][0].split(";")[0];
  assert.ok(!("salary" in (await req("GET", "/api/worker-app/me", { cookie: ck })).json.worker));
  assert.equal((await req("GET", "/api/mobile/companies?mobile_pin=424242")).status, 401);   // query string rejected
  assert.equal((await req("GET", "/api/mobile/companies", { headers: { "x-mobile-pin": "424242" } })).status, 200);
  assert.equal((await req("GET", "/api/mobile/companies", { headers: { "x-mobile-pin": "wrong" } })).status, 401);
});

test("permanent test-delete needs confirm_code and is audited", async () => {
  const w = (await req("POST", "/api/v2/workers", { cookie: C, body: { worker_code: "DEL1", name: "Delete Me" } })).json.id;
  assert.equal((await req("DELETE", `/api/workers/${w}/test-delete`, { cookie: C })).status, 400);
  assert.ok(raw.prepare("SELECT 1 FROM workers WHERE id=?").get(w));
  assert.equal((await req("DELETE", `/api/workers/${w}/test-delete`, { cookie: C, body: { confirm_code: "del1" } })).status, 200);
  assert.ok(raw.prepare("SELECT 1 FROM audit_log WHERE action='worker.test_delete'").get());
});

test("audit log records admin changes", async () => {
  const a = (await req("GET", "/api/v2/audit", { cookie: C })).json.items;
  const acts = new Set(a.map(x => x.action));
  for (const k of ["worker.create", "worker.reassign", "company.create", "import.commit"]) assert.ok(acts.has(k), k);
});

test("migration is non-destructive on existing data (synthetic legacy DB)", () => {
  const { migrate } = require("../lib/migrate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alsabiha-mig-"));
  const f = path.join(dir, "attendance.db");
  const d = new Database(f);
  d.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'admin');
   CREATE TABLE companies(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE NOT NULL,contact_person TEXT,contact_number TEXT,status TEXT DEFAULT 'Active');
   CREATE TABLE sites(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,location TEXT,company_id INTEGER,contact_person TEXT,contact_number TEXT,status TEXT DEFAULT 'Active');
   CREATE TABLE workers(id INTEGER PRIMARY KEY AUTOINCREMENT,worker_code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,employee_type TEXT DEFAULT 'Company',vendor TEXT,mobile TEXT,designation TEXT,salary REAL DEFAULT 0,status TEXT DEFAULT 'Active',joining_date TEXT,company_id INTEGER);
   CREATE TABLE attendance(id INTEGER PRIMARY KEY AUTOINCREMENT,worker_id INTEGER NOT NULL,company_id INTEGER,site_id INTEGER NOT NULL,attendance_date TEXT NOT NULL,check_in TEXT,check_out TEXT,latitude REAL,longitude REAL,is_manual INTEGER DEFAULT 0,remarks TEXT,created_by INTEGER);
   INSERT INTO companies(name) VALUES('AL SABIHA'),('MTC');
   INSERT INTO workers(worker_code,name,vendor,company_id) VALUES('W1','One','AL SABIHA',2),('W2','Two','Unknown Vendor',1);
   INSERT INTO attendance(worker_id,company_id,site_id,attendance_date,check_in,check_out) VALUES(1,2,1,'2026-10-01','2026-10-01 08:00:00','2026-10-01 17:00:00');`);
  const snap = () => JSON.stringify([d.prepare("SELECT * FROM attendance").all(), d.prepare("SELECT id,worker_code,name,vendor,company_id FROM workers").all()]);
  const before = snap();
  const r = migrate(d, f);
  assert.equal(r.migrated, true); assert.ok(fs.existsSync(r.backup));
  assert.equal(snap(), before);                                                        // data identical
  assert.equal(d.prepare("SELECT sponsor_company_id s FROM workers WHERE worker_code='W1'").get().s, 1);   // exact match only
  assert.equal(d.prepare("SELECT sponsor_company_id s FROM workers WHERE worker_code='W2'").get().s, null);
  assert.equal(migrate(d, f).migrated, false);                                          // idempotent
  d.close(); fs.rmSync(dir, { recursive: true, force: true });
});
