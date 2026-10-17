"use strict";
const crypto = require("crypto");
const express = require("express");
const XLSX = require("xlsx");
const S = require("./shared");
const { xlsxSafe, looksLikeFormula } = require("./security");
const { clean, normCode, normType, normStatus, normMobile, normName, audit } = S;

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const PREVIEW_TTL = 30 * 60 * 1000;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const HEADERS = ["Employee ID", "Employee Name", "Designation", "Company Type",
  "Visa/Sponsor Company", "Working/Assigned Company", "Status", "Mobile Number"];

const hkey = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIASES = {
  worker_code: ["employee id", "employee_id", "worker code", "worker id", "emp id", "id"],
  name: ["employee name", "worker name", "name"],
  designation: ["designation", "designation trade", "trade"],
  company_type: ["company type", "employee type", "type"],
  sponsor: ["visa sponsor company", "sponsor company", "sponsor", "visa company", "vendor", "supplier"],
  working: ["working assigned company", "working company", "assigned company", "company"],
  status: ["status", "worker status"],
  mobile: ["mobile number", "mobile", "phone", "phone number"]
};
const FIELD_LABEL = { worker_code: "Employee ID", name: "Employee Name", designation: "Designation",
  company_type: "Company Type", sponsor: "Visa/Sponsor Company", working: "Working/Assigned Company",
  status: "Status", mobile: "Mobile Number" };

/* ---------- workbook helpers ---------- */
function sheetFrom(headers, rows, { widths, dateCols = [] } = {}) {
  const aoa = [headers.map(xlsxSafe)];
  for (const r of rows) aoa.push(r.map((v, i) => {
    if (v === null || v === undefined || v === "") return "";
    if (dateCols.includes(i)) {
      const n = S.excelSerial(v);
      return n === null ? xlsxSafe(String(v)) : { t: "n", v: n, z: "yyyy-mm-dd hh:mm:ss" };
    }
    return typeof v === "string" ? xlsxSafe(v) : v;
  }));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = (widths || headers.map(h => Math.max(12, h.length + 4))).map(w => ({ wch: w }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  ws["!autofilter"] = { ref: ws["!ref"] || "A1" };
  return ws;
}
function sendXlsx(res, wb, filename) {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type", XLSX_MIME);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buf);
}
const stamp = () => new Date().toISOString().slice(0, 10);

function mount({ app, db, login, admin, v2 }) {
  const previews = new Map();
  const sweep = () => { const t = Date.now(); for (const [k, v] of previews) if (v.expires < t) previews.delete(k); };
  setInterval(sweep, 60 * 1000).unref();

  /* ---------- template ---------- */
  app.get("/api/v2/import/template.xlsx", login, (req, res) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(HEADERS, [], { widths: [16, 28, 20, 18, 30, 30, 12, 18] }), "Workers");
    const ins = [
      ["AL SABIHA — Worker import template"], [""],
      ["1. Fill the 'Workers' sheet (headers in row 1). Delete nothing from the header row."],
      ["2. Required: Employee ID, Employee Name. Everything else is optional."],
      ["3. Company Type: Group Company or Supplier (SUP). Blank = Group Company for new workers."],
      ["4. Visa/Sponsor Company and Working/Assigned Company must match a company listed on the 'Valid Companies' sheet exactly (case-insensitive). Unknown names are reported, never auto-created."],
      ["5. Status: Active or Inactive. Blank = Active for new workers."],
      ["6. Existing Employee IDs are never duplicated. In 'update' mode only non-empty cells change; blank cells never erase data."],
      ["7. Workers missing from your file are never deleted."],
      ["8. Example row (do NOT leave it in the Workers sheet): AAT001 | Waqas Ali | Admin | Group Company | Allail Al Sari Technical | Arcelor Mittal | Active | +971500000000"]
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ins), "Instructions");
    const comp = db.prepare("SELECT name,status FROM companies ORDER BY name COLLATE NOCASE").all();
    const ws = sheetFrom(["Company name", "Status"], comp.map(c => [c.name, c.status]), { widths: [44, 12] });
    XLSX.utils.book_append_sheet(wb, ws, "Valid Companies");
    sendXlsx(res, wb, "AL-SABIHA-Worker-Import-Template.xlsx");
  });

  /* ---------- parse + validate ---------- */
  function parseFile(buf, filename) {
    const name = String(filename || "").toLowerCase();
    if (!/\.(xlsx|csv)$/.test(name)) return { fatal: "Only .xlsx or .csv files are accepted." };
    if (!buf || !buf.length) return { fatal: "The file is empty." };
    if (buf.length > MAX_BYTES) return { fatal: "File is larger than 10 MB." };
    if (name.endsWith(".xlsx") && !(buf[0] === 0x50 && buf[1] === 0x4b))
      return { fatal: "This is not a valid .xlsx file." };
    if (name.endsWith(".csv") && buf.includes(0)) return { fatal: "This is not a valid CSV file." };
    let wb;
    try { wb = XLSX.read(buf, { type: "buffer", cellFormula: false, cellHTML: false, cellStyles: false }); }
    catch (e) { return { fatal: "The file could not be read. Re-save it as .xlsx and try again." }; }
    const sheetName = wb.SheetNames.includes("Workers") ? "Workers" : wb.SheetNames[0];
    if (!sheetName) return { fatal: "The workbook has no sheets." };
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false });
    if (!aoa.length) return { fatal: "The sheet is empty." };
    const map = {};
    aoa[0].forEach((h, i) => {
      const k = hkey(h);
      for (const f of Object.keys(ALIASES)) if (map[f] === undefined && ALIASES[f].includes(k)) map[f] = i;
    });
    const missing = ["worker_code", "name"].filter(f => map[f] === undefined);
    if (missing.length) return { fatal: `Missing required column(s): ${missing.map(f => FIELD_LABEL[f]).join(", ")}.` };
    if (aoa.length - 1 > MAX_ROWS) return { fatal: `Too many rows (max ${MAX_ROWS} per import).` };
    const rows = aoa.slice(1).map((r, i) => {
      const o = { row: i + 2 };
      for (const f of Object.keys(map)) o[f] = clean(r[map[f]]);
      return o;
    }).filter(o => Object.keys(map).some(f => o[f]));
    return { rows, sheetName, columns: Object.keys(map).map(f => FIELD_LABEL[f]) };
  }

  function companyIndex() {
    const m = new Map();
    for (const c of db.prepare("SELECT id,name,status FROM companies").all()) m.set(normName(c.name), c);
    return m;
  }

  function validate(rows) {
    const comps = companyIndex();
    const errors = [], good = [];
    const seen = new Map();
    const counts = { new: 0, update: 0, unchanged: 0, invalid: 0, duplicate_in_file: 0,
      existing_ids: 0, missing_required: 0, unresolved_company: 0, invalid_values: 0 };
    const err = (r, field, msg, kind) => { errors.push({ row: r.row, employee_id: r.worker_code, field, problem: msg }); if (kind) counts[kind] += 0; };

    for (const r of rows) {
      const problems = [];
      const add = (field, msg, kind) => { problems.push({ field, msg, kind }); };
      for (const f of Object.keys(FIELD_LABEL)) if (looksLikeFormula(r[f] || "")) add(FIELD_LABEL[f], "Value looks like a spreadsheet formula and was rejected.", "invalid_values");
      const c = normCode(r.worker_code);
      if (c.error) add("Employee ID", c.error, r.worker_code ? "invalid_values" : "missing_required");
      if (!r.name) add("Employee Name", "Employee Name is required.", "missing_required");
      if (r.name && r.name.length > 120) add("Employee Name", "Too long (max 120).", "invalid_values");
      const type = normType(r.company_type);
      if (type === undefined) add("Company Type", `"${r.company_type}" is not valid. Use Group Company or Supplier.`, "invalid_values");
      const status = normStatus(r.status);
      if (status === undefined) add("Status", `"${r.status}" is not valid. Use Active or Inactive.`, "invalid_values");
      const mob = normMobile(r.mobile);
      if (mob.error) add("Mobile Number", mob.error, "invalid_values");
      let sponsor, working;
      for (const [f, label] of [["sponsor", "Visa/Sponsor Company"], ["working", "Working/Assigned Company"]]) {
        if (!r[f]) continue;
        const hit = comps.get(normName(r[f]));
        if (!hit) add(label, `Company "${r[f]}" is not in the company list. Add it under Companies & Suppliers first.`, "unresolved_company");
        else if (hit.status !== "Active") add(label, `Company "${hit.name}" is inactive.`, "invalid_values");
        else if (f === "sponsor") sponsor = hit; else working = hit;
      }
      if (c.value) {
        if (seen.has(c.value)) { add("Employee ID", `Duplicate Employee ID in file (first seen on row ${seen.get(c.value)}).`, "duplicate_in_file"); }
        else seen.set(c.value, r.row);
      }
      if (problems.length) {
        counts.invalid++;
        const kinds = new Set(problems.map(p => p.kind));
        kinds.forEach(k => counts[k]++);
        problems.forEach(p => errors.push({ row: r.row, employee_id: r.worker_code, field: p.field, problem: p.msg }));
        continue;
      }
      good.push({ row: r.row, code: c.value, name: r.name, designation: r.designation || "",
        type, status, mobile: mob.value, sponsor, working });
    }
    return { good, errors, counts };
  }

  /* Compare a valid row to the DB and decide new/update/unchanged. */
  function plan(g) {
    const ex = db.prepare(`SELECT w.*, c.name company_name FROM workers w
      LEFT JOIN companies c ON c.id=w.company_id WHERE UPPER(w.worker_code)=?`).get(g.code);
    if (!ex) return { action: "new", changes: [] };
    const ch = [];
    const cmp = (label, col, val, shown) => {
      if (val === "" || val === null || val === undefined) return;       // blank never overwrites
      if (String(ex[col] ?? "") !== String(val)) ch.push({ label, col, from: shown?.from ?? ex[col] ?? "", to: shown?.to ?? val, val });
    };
    cmp("Employee Name", "name", g.name);
    cmp("Designation", "designation", g.designation);
    if (g.type) cmp("Company Type", "employee_type", g.type);
    if (g.status) cmp("Status", "status", g.status);
    cmp("Mobile Number", "mobile", g.mobile);
    if (g.sponsor && ex.sponsor_company_id !== g.sponsor.id)
      ch.push({ label: "Visa/Sponsor Company", col: "sponsor", from: ex.vendor || "", to: g.sponsor.name, val: g.sponsor.id });
    if (g.working && ex.company_id !== g.working.id)
      ch.push({ label: "Working/Assigned Company", col: "working", from: ex.company_name || "", to: g.working.name, val: g.working.id });
    return { action: ch.length ? "update" : "unchanged", changes: ch, id: ex.id };
  }

  app.post("/api/v2/import/preview", admin,
    express.raw({ type: () => true, limit: MAX_BYTES + 1024 }), (req, res) => {
      let filename = "upload";
      try { filename = decodeURIComponent(req.headers["x-filename"] || "upload"); } catch (_) {}
      const p = parseFile(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), filename);
      if (p.fatal) return res.status(400).json({ success: false, error: p.fatal, message: p.fatal });
      const v = validate(p.rows);
      const items = v.good.map(g => ({ ...g, ...plan(g) }));
      v.counts.new = items.filter(i => i.action === "new").length;
      v.counts.update = items.filter(i => i.action === "update").length;
      v.counts.unchanged = items.filter(i => i.action === "unchanged").length;
      v.counts.existing_ids = v.counts.update + v.counts.unchanged;
      const token = crypto.randomBytes(24).toString("hex");
      if (previews.size >= 20) previews.delete(previews.keys().next().value);
      previews.set(token, { items, errors: v.errors, filename, counts: v.counts, total: p.rows.length,
        user: req.session.user.id, expires: Date.now() + PREVIEW_TTL });
      res.json({ success: true, token, filename, total_rows: p.rows.length, valid_rows: items.length,
        counts: v.counts, columns_found: p.columns,
        rules: ["Employee ID is the matching key (case-insensitive). Existing IDs are never duplicated.",
          "Add-only mode: existing workers are left untouched.",
          "Update mode: only non-empty cells that differ are changed; blank cells never erase data.",
          "Workers not present in the file are never deleted or deactivated.",
          "Company names must match existing companies; nothing is created or merged automatically.",
          "Rows with errors are skipped and listed in the error report; valid rows are imported in one transaction."],
        sample: items.slice(0, 50).map(i => ({ row: i.row, employee_id: i.code, name: i.name, action: i.action,
          changes: i.changes.map(c => ({ field: c.label, from: c.from, to: c.to })) })),
        errors: v.errors.slice(0, 200), errors_total: v.errors.length });
    });

  app.post("/api/v2/import/commit", admin, (req, res) => {
    const pv = previews.get(String(req.body.token || ""));
    if (!pv || pv.expires < Date.now() || pv.user !== req.session.user.id)
      return res.status(400).json({ success: false, error: "Preview expired. Upload the file again.", message: "Preview expired. Upload the file again." });
    const mode = req.body.mode === "add_and_update" ? "add_and_update" : "add_only";
    const u = req.session.user;
    const result = { created: 0, updated: 0, skipped: 0 };
    const errors = pv.errors.slice();
    try {
      db.transaction(() => {
        const ins = db.prepare(`INSERT INTO workers(worker_code,name,employee_type,vendor,sponsor_company_id,mobile,
          designation,salary,status,joining_date,company_id,updated_at) VALUES(?,?,?,?,?,?,?,0,?,NULL,?,?)`);
        for (const g of pv.items) {
          const p = plan(g);                       // re-evaluate against live data
          if (p.action === "new") {
            const r = ins.run(g.code, g.name, g.type || "Company", g.sponsor?.name ?? null, g.sponsor?.id ?? null,
              g.mobile, g.designation || null, g.status || "Active", g.working?.id ?? null, v2.nowUae());
            if (g.working) db.prepare(`INSERT INTO worker_assignments(worker_id,from_company_id,to_company_id,changed_by,changed_at,note)
              VALUES(?,?,?,?,?,'Excel import')`).run(r.lastInsertRowid, null, g.working.id, u.username, v2.nowUae());
            result.created++;
          } else if (p.action === "update" && mode === "add_and_update") {
            const sets = {}; let newCompany;
            for (const c of p.changes) {
              if (c.col === "sponsor") { sets.sponsor_company_id = c.val; sets.vendor = c.to; }
              else if (c.col === "working") newCompany = c.val;
              else sets[c.col] = c.val;
            }
            const keys = Object.keys(sets);
            if (keys.length) db.prepare(`UPDATE workers SET ${keys.map(k => `${k}=?`).join(",")}, updated_at=? WHERE id=?`)
              .run(...keys.map(k => sets[k]), v2.nowUae(), p.id);
            if (newCompany !== undefined) v2.reassign(p.id, newCompany, req, "Excel import");
            result.updated++;
          } else {
            result.skipped++;
            if (p.action === "update") errors.push({ row: g.row, employee_id: g.code, field: "Employee ID",
              problem: "Existing worker skipped (add-only mode)." });
          }
        }
      })();
    } catch (e) {
      console.error("Import failed, rolled back:", e);
      db.prepare(`INSERT INTO import_history(at,user_id,username,filename,mode,total_rows,created,updated,skipped,invalid,outcome,errors_json)
        VALUES(?,?,?,?,?,?,0,0,0,?,?,?)`).run(v2.nowUae(), u.id, u.username, pv.filename, mode, pv.total,
        pv.counts.invalid, "failed_rolled_back", JSON.stringify([{ row: 0, field: "", problem: "Import failed and was rolled back. No changes were saved." }]));
      return res.status(500).json({ success: false, error: "Import failed and was rolled back. No changes were saved.",
        message: "Import failed and was rolled back. No changes were saved." });
    }
    const outcome = pv.counts.invalid || result.skipped ? "completed_with_issues" : "completed";
    const h = db.prepare(`INSERT INTO import_history(at,user_id,username,filename,mode,total_rows,created,updated,skipped,invalid,outcome,errors_json)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(v2.nowUae(), u.id, u.username, pv.filename, mode, pv.total,
      result.created, result.updated, result.skipped, pv.counts.invalid, outcome, JSON.stringify(errors.slice(0, 2000)));
    audit(db, req, "import.commit", "import", h.lastInsertRowid, { mode, ...result, invalid: pv.counts.invalid });
    previews.delete(req.body.token);
    res.json({ success: true, history_id: Number(h.lastInsertRowid), mode, ...result,
      invalid: pv.counts.invalid, outcome, error_report_url: `/api/v2/import/history/${h.lastInsertRowid}/errors.xlsx` });
  });

  app.get("/api/v2/import/history", admin, (req, res) => {
    res.json({ items: db.prepare(`SELECT id,at,username,filename,mode,total_rows,created,updated,skipped,invalid,outcome,
      (errors_json IS NOT NULL AND errors_json<>'[]') has_errors FROM import_history ORDER BY id DESC LIMIT 100`).all() });
  });

  const errorSheet = (errs, res, name) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(["Row", "Employee ID", "Field", "Problem"],
      errs.map(e => [e.row, e.employee_id || "", e.field || "", e.problem]), { widths: [8, 18, 26, 80] }), "Import errors");
    sendXlsx(res, wb, name);
  };
  app.get("/api/v2/import/history/:id/errors.xlsx", admin, (req, res) => {
    const h = db.prepare("SELECT errors_json FROM import_history WHERE id=?").get(Number(req.params.id));
    if (!h) return res.status(404).json({ error: "Import not found." });
    errorSheet(JSON.parse(h.errors_json || "[]"), res, `AL-SABIHA-Import-Errors-${req.params.id}.xlsx`);
  });
  app.get("/api/v2/import/preview/:token/errors.xlsx", admin, (req, res) => {
    const pv = previews.get(req.params.token);
    if (!pv) return res.status(404).json({ error: "Preview expired." });
    errorSheet(pv.errors, res, "AL-SABIHA-Import-Errors-preview.xlsx");
  });

  /* ---------- exports (respect the same filters as the screens) ---------- */
  app.get("/api/v2/export/workers.xlsx", login, (req, res) => {
    const r = S.workerQuery(db, { ...req.query, sort: req.query.sort || "code" }, { paged: false });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(
      ["Employee ID", "Employee Name", "Designation", "Company Type", "Visa/Sponsor Company", "Working/Assigned Company", "Status"],
      r.items.map(w => [w.worker_code, w.name, w.designation, w.company_type_label, w.sponsor_name, w.company_name, w.status]),
      { widths: [16, 28, 20, 18, 32, 32, 12] }), "Worker Database");
    audit(db, req, "export.workers", "export", null, { rows: r.items.length });
    sendXlsx(res, wb, `AL-SABIHA-Workers-${stamp()}.xlsx`);
  });

  app.get("/api/v2/export/attendance.xlsx", login, (req, res) => {
    const r = S.attendanceQuery(db, { ...req.query, page_size: 500 }, { paged: false });
    const rows = r.items.slice(0, 50000);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(
      ["Employee ID", "Worker Name", "Designation", "Company", "Site", "Check-In", "Check-Out", "Attendance Status", "Entry Type"],
      rows.map(a => [a.worker_code, a.worker_name, a.designation, a.company_name, a.site_name,
        a.check_in, a.check_out, a.attendance_status, a.is_manual ? "Manual" : "QR"]),
      { widths: [14, 26, 18, 28, 32, 20, 20, 18, 12], dateCols: [5, 6] }), "Attendance Records");
    sendXlsx(res, wb, `AL-SABIHA-Attendance-${stamp()}.xlsx`);
  });

  app.get("/api/v2/export/company-workforce.xlsx", login, (req, res) => {
    const items = S.companyWorkforceRows(db);
    const lab = { group: "Group", supplier: "Supplier", client: "Client" };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(
      ["Company", "Category", "Status", "Total Workers", "Active", "Inactive", "Group Company Workers", "Supplier Workers", "Sponsored (Active)"],
      items.map(r => [r.company_name, r.roles.map(x => lab[x]).join(" / ") || "Unclassified", r.company_status,
        r.total_workers, r.active_workers, r.inactive_workers, r.group_workers, r.supplier_workers, r.sponsored_active]),
      { widths: [38, 22, 10, 14, 10, 10, 22, 18, 18] }), "Company Workforce");
    sendXlsx(res, wb, `AL-SABIHA-Company-Workforce-${stamp()}.xlsx`);
  });

  app.get("/api/v2/export/monthly.xlsx", login, (req, res) => {
    const m = S.monthlyRows(db, req.query);
    if (m.error) return res.status(400).json({ error: m.error });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheetFrom(
      ["Employee ID", "Worker Name", "Designation", "Days Present", "Records", "Total Hours", "Manual Records", "Open Records"],
      m.items.map(r => [r.worker_code, r.worker_name, r.designation, r.days_present, r.records, r.total_hours, r.manual_records, r.open_records]),
      { widths: [14, 28, 20, 14, 10, 12, 16, 14] }), `Monthly ${m.month}`);
    sendXlsx(res, wb, `AL-SABIHA-Monthly-${m.month}.xlsx`);
  });
}

module.exports = { mount, HEADERS };
