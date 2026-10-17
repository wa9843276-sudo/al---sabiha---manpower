"use strict";
const { normName } = require("./migrate");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const clean = v => (v === undefined || v === null ? "" : String(v).trim().replace(/\s+/g, " "));

/* Employee ID: trim + upper-case. Allowed: letters, digits . _ - / */
function normCode(v) {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return { error: "Employee ID is required." };
  if (s.length > 40) return { error: "Employee ID is too long (max 40)." };
  if (!/^[A-Z0-9][A-Z0-9._\-/]*$/.test(s))
    return { error: "Employee ID may contain only letters, digits, . _ - / and no spaces." };
  return { value: s };
}

/* Company Type: stored legacy codes stay 'Company' / 'Supplier'. */
function normType(v) {
  const s = clean(v).toUpperCase();
  if (!s) return null;
  if (["COMPANY", "GROUP", "GROUP COMPANY"].includes(s)) return "Company";
  if (["SUPPLIER", "SUP", "SUPPLIER (SUP)"].includes(s)) return "Supplier";
  return undefined; // invalid
}
const typeLabel = t => (t === "Supplier" ? "Supplier (SUP)" : t === "Company" ? "Group Company" : t || "");

function normStatus(v) {
  const s = clean(v).toLowerCase();
  if (!s) return null;
  if (s === "active") return "Active";
  if (s === "inactive") return "Inactive";
  return undefined;
}

function normMobile(v) {
  const s = clean(v);
  if (!s) return { value: null };
  if (!/^[+0-9()\-\s]{7,25}$/.test(s)) return { error: "Invalid mobile number." };
  return { value: s };
}

const likeEsc = s => String(s).replace(/[\\%_]/g, m => "\\" + m);

/* Whitespace-tolerant, case-insensitive "contains all words". */
function tokenLike(col, text, where, params) {
  const toks = clean(text).split(" ").filter(Boolean).slice(0, 6);
  for (const t of toks) { where.push(`${col} LIKE ? ESCAPE '\\'`); params.push(`%${likeEsc(t)}%`); }
}

const WORKER_SELECT = `
SELECT w.id, w.worker_code, w.name, w.designation, w.employee_type, w.status,
       w.mobile, w.joining_date, w.company_id, w.vendor, w.sponsor_company_id,
       c.name AS company_name,
       COALESCE(sc.name, NULLIF(TRIM(w.vendor),'')) AS sponsor_name
FROM workers w
LEFT JOIN companies c  ON c.id=w.company_id
LEFT JOIN companies sc ON sc.id=w.sponsor_company_id`;

const WORKER_SORT = {
  code: "w.worker_code COLLATE NOCASE", name: "w.name COLLATE NOCASE",
  designation: "w.designation COLLATE NOCASE", type: "w.employee_type",
  sponsor: "sponsor_name COLLATE NOCASE", company: "company_name COLLATE NOCASE",
  status: "w.status"
};

function workerFilter(q) {
  const where = [], params = [];
  tokenLike("w.name", q.name, where, params);
  tokenLike("w.worker_code", q.code, where, params);
  tokenLike("w.designation", q.designation, where, params);
  const st = normStatus(q.status);
  if (st) { where.push("w.status=?"); params.push(st); }
  const ty = normType(q.company_type);
  if (ty) { where.push("w.employee_type=?"); params.push(ty); }
  if (q.company_id === "none") where.push("w.company_id IS NULL");
  else if (Number(q.company_id)) { where.push("w.company_id=?"); params.push(Number(q.company_id)); }
  if (Number(q.sponsor_id)) { where.push("w.sponsor_company_id=?"); params.push(Number(q.sponsor_id)); }
  return { where, params };
}

function workerQuery(db, q, { paged = true } = {}) {
  const { where, params } = workerFilter(q);
  const W = where.length ? " WHERE " + where.join(" AND ") : "";
  const sortCol = WORKER_SORT[q.sort] || WORKER_SORT.name;
  const dir = String(q.dir).toLowerCase() === "desc" ? "DESC" : "ASC";
  const total = db.prepare(`SELECT COUNT(*) c FROM workers w
     LEFT JOIN companies c ON c.id=w.company_id ${W}`).get(...params).c;
  const page = Math.max(1, parseInt(q.page) || 1);
  const size = Math.min(200, Math.max(1, parseInt(q.page_size) || 25));
  let sql = `${WORKER_SELECT}${W} ORDER BY ${sortCol} ${dir}, w.id`;
  const p = [...params];
  if (paged) { sql += " LIMIT ? OFFSET ?"; p.push(size, (page - 1) * size); }
  const items = db.prepare(sql).all(...p)
    .map(r => ({ ...r, company_type_label: typeLabel(r.employee_type) }));
  return { items, total, page, page_size: size, pages: Math.max(1, Math.ceil(total / size)) };
}

function attendanceFilter(q) {
  const where = [], params = [];
  if (DATE_RE.test(q.date_from || "")) { where.push("a.attendance_date>=?"); params.push(q.date_from); }
  if (DATE_RE.test(q.date_to || "")) { where.push("a.attendance_date<=?"); params.push(q.date_to); }
  if (Number(q.company_id)) { where.push("a.company_id=?"); params.push(Number(q.company_id)); }
  if (Number(q.site_id)) { where.push("a.site_id=?"); params.push(Number(q.site_id)); }
  if (Number(q.worker_id)) { where.push("a.worker_id=?"); params.push(Number(q.worker_id)); }
  if (clean(q.worker)) {
    const t = `%${likeEsc(clean(q.worker))}%`;
    where.push("(w.name LIKE ? ESCAPE '\\' OR w.worker_code LIKE ? ESCAPE '\\')");
    params.push(t, t);
  }
  if (q.status === "checked_in") where.push("a.check_in IS NOT NULL AND a.check_out IS NULL");
  else if (q.status === "checked_out") where.push("a.check_out IS NOT NULL");
  if (q.type === "manual") where.push("a.is_manual=1");
  else if (q.type === "qr") where.push("COALESCE(a.is_manual,0)=0");
  return { where, params };
}

const ATT_SELECT = `
SELECT a.id, a.attendance_date, a.check_in, a.check_out, a.is_manual, a.remarks,
       w.id AS worker_id, w.worker_code, w.name AS worker_name, w.designation,
       c.name AS company_name, s.name AS site_name,
       CASE WHEN a.check_out IS NULL THEN 'Checked In'
            WHEN a.remarks LIKE '%Automatic checkout%' THEN 'Auto Checkout'
            ELSE 'Checked Out' END AS attendance_status
FROM attendance a
JOIN workers w ON w.id=a.worker_id
LEFT JOIN companies c ON c.id=a.company_id
LEFT JOIN sites s ON s.id=a.site_id`;

function attendanceQuery(db, q, { paged = true } = {}) {
  const { where, params } = attendanceFilter(q);
  const W = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = db.prepare(`SELECT COUNT(*) c FROM attendance a JOIN workers w ON w.id=a.worker_id ${W}`)
    .get(...params).c;
  const page = Math.max(1, parseInt(q.page) || 1);
  const size = Math.min(500, Math.max(1, parseInt(q.page_size) || 25));
  const dir = String(q.dir).toLowerCase() === "asc" ? "ASC" : "DESC";
  let sql = `${ATT_SELECT}${W} ORDER BY a.attendance_date ${dir}, a.check_in ${dir}, a.id ${dir}`;
  const p = [...params];
  if (paged) { sql += " LIMIT ? OFFSET ?"; p.push(size, (page - 1) * size); }
  return { items: db.prepare(sql).all(...p), total, page, page_size: size,
           pages: Math.max(1, Math.ceil(total / size)) };
}

function companyWorkforceRows(db) {
  const rows = db.prepare(`
    SELECT c.id company_id, c.name company_name, c.status company_status,
      (SELECT group_concat(role) FROM company_roles r WHERE r.company_id=c.id) roles,
      COUNT(w.id) total_workers,
      SUM(CASE WHEN w.status='Active' THEN 1 ELSE 0 END) active_workers,
      SUM(CASE WHEN w.status<>'Active' THEN 1 ELSE 0 END) inactive_workers,
      SUM(CASE WHEN w.status='Active' AND w.employee_type='Company' THEN 1 ELSE 0 END) group_workers,
      SUM(CASE WHEN w.status='Active' AND w.employee_type='Supplier' THEN 1 ELSE 0 END) supplier_workers,
      (SELECT COUNT(*) FROM workers x WHERE x.sponsor_company_id=c.id AND x.status='Active') sponsored_active
    FROM companies c LEFT JOIN workers w ON w.company_id=c.id
    GROUP BY c.id ORDER BY c.name COLLATE NOCASE`).all();
  const un = db.prepare(`
    SELECT 0 company_id, 'Unassigned' company_name, 'Active' company_status, '' roles,
      COUNT(*) total_workers,
      COALESCE(SUM(status='Active'),0) active_workers,
      COALESCE(SUM(status<>'Active'),0) inactive_workers,
      COALESCE(SUM(status='Active' AND employee_type='Company'),0) group_workers,
      COALESCE(SUM(status='Active' AND employee_type='Supplier'),0) supplier_workers,
      0 sponsored_active
    FROM workers WHERE company_id IS NULL`).get();
  if (un.total_workers) rows.push(un);
  return rows.map(r => ({ ...r, active_workers: r.active_workers || 0, inactive_workers: r.inactive_workers || 0,
    group_workers: r.group_workers || 0, supplier_workers: r.supplier_workers || 0,
    roles: r.roles ? r.roles.split(",") : [] }));
}

function monthlyRows(db, q) {
  const month = MONTH_RE.test(q.month || "") ? q.month : null;
  if (!month) return { error: "month (YYYY-MM) is required." };
  const where = ["substr(a.attendance_date,1,7)=?", "a.check_in IS NOT NULL"], params = [month];
  if (Number(q.company_id)) { where.push("a.company_id=?"); params.push(Number(q.company_id)); }
  if (Number(q.site_id)) { where.push("a.site_id=?"); params.push(Number(q.site_id)); }
  const items = db.prepare(`
    SELECT w.id worker_id, w.worker_code, w.name worker_name, w.designation,
      COUNT(DISTINCT a.attendance_date) days_present,
      COUNT(*) records,
      ROUND(COALESCE(SUM(CASE WHEN a.check_out IS NOT NULL
        THEN (julianday(a.check_out)-julianday(a.check_in))*24 END),0),2) total_hours,
      SUM(CASE WHEN a.is_manual=1 THEN 1 ELSE 0 END) manual_records,
      SUM(CASE WHEN a.check_out IS NULL THEN 1 ELSE 0 END) open_records
    FROM attendance a JOIN workers w ON w.id=a.worker_id
    WHERE ${where.join(" AND ")}
    GROUP BY w.id ORDER BY w.name COLLATE NOCASE`).all(...params);
  return { month, items,
    totals: { workers: items.length,
      days: items.reduce((s, r) => s + r.days_present, 0),
      hours: Math.round(items.reduce((s, r) => s + r.total_hours, 0) * 100) / 100 } };
}

/* 'YYYY-MM-DD HH:MM[:SS]' -> Excel serial (timezone-free). */
function excelSerial(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(str || ""));
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return ms / 86400000 + 25569;
}

function audit(db, req, action, entity, entityId, details) {
  try {
    const u = (req && req.session && req.session.user) || {};
    db.prepare(`INSERT INTO audit_log(at,user_id,username,action,entity,entity_id,details)
      VALUES(datetime('now','+4 hours'),?,?,?,?,?,?)`)
      .run(u.id || null, u.username || null, action, entity || null,
        entityId == null ? null : String(entityId),
        details ? JSON.stringify(details).slice(0, 2000) : null);
  } catch (e) { console.error("audit error:", e.message); }
}

module.exports = {
  DATE_RE, DATETIME_RE, MONTH_RE, clean, normName, normCode, normType, typeLabel,
  normStatus, normMobile, likeEsc, workerQuery, attendanceQuery, attendanceFilter,
  companyWorkforceRows, monthlyRows, excelSerial, audit, WORKER_SELECT
};
