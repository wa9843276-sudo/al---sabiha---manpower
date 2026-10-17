"use strict";
/* /api/v2/* — additive API. Legacy /api/* routes are untouched. */
const S = require("./shared");
const { clean, normCode, normType, normStatus, normMobile, normName, typeLabel, audit } = S;

const ROLES = ["group", "supplier", "client"];
const ROLE_LABEL = { group: "AL SABIHA Group", supplier: "External Supplier", client: "Client / Project" };

const fail = (res, code, msg, extra = {}) =>
  res.status(code).json({ success: false, error: msg, message: msg, ...extra });

function mount({ app, db, login, admin, today, autoCheckoutExpired }) {
  const nowUae = () => db.prepare("SELECT datetime('now','+4 hours') t").get().t;
  const activeCompany = id => db.prepare("SELECT id,name FROM companies WHERE id=? AND status='Active'").get(id);
  const isAdmin = req => String(req.session.user?.role || "").toLowerCase() === "admin";

  function companyRoles(ids) {
    const map = new Map();
    for (const r of db.prepare("SELECT company_id,role FROM company_roles").all()) {
      if (!map.has(r.company_id)) map.set(r.company_id, []);
      map.get(r.company_id).push(r.role);
    }
    return id => map.get(id) || [];
  }

  /* ---------- lookups for forms/filters (one call) ---------- */
  app.get("/api/v2/lookups", login, (req, res) => {
    const rolesOf = companyRoles();
    const companies = db.prepare("SELECT id,name,status,review_required FROM companies ORDER BY name COLLATE NOCASE").all()
      .map(c => ({ ...c, roles: rolesOf(c.id) }));
    res.json({
      companies,
      sites: db.prepare("SELECT id,name,location,company_id,status FROM sites ORDER BY name").all(),
      designations: db.prepare(`SELECT DISTINCT UPPER(TRIM(designation)) d FROM workers
        WHERE designation IS NOT NULL AND TRIM(designation)<>'' ORDER BY d`).all().map(r => r.d),
      company_types: [{ value: "Company", label: typeLabel("Company") }, { value: "Supplier", label: typeLabel("Supplier") }],
      role_labels: ROLE_LABEL
    });
  });

  /* ---------- workers ---------- */
  app.get("/api/v2/workers", login, (req, res) => {
    try { res.json(S.workerQuery(db, req.query)); }
    catch (e) { console.error("v2 workers:", e); fail(res, 500, "Unable to load workers."); }
  });

  function readWorkerInput(b, { partial }) {
    const out = {}, errors = [];
    const has = k => !partial || b[k] !== undefined;
    if (has("name")) {
      const n = clean(b.name);
      if (!n) errors.push("Employee name is required.");
      else if (n.length > 120) errors.push("Employee name is too long (max 120).");
      else out.name = n;
    }
    if (has("designation")) out.designation = clean(b.designation).slice(0, 80) || null;
    if (has("company_type") || b.employee_type !== undefined) {
      const t = normType(b.company_type ?? b.employee_type);
      if (t === undefined) errors.push("Company Type must be Group Company or Supplier.");
      else if (t || !partial) out.employee_type = t || "Company";
    }
    if (has("status")) {
      const s = normStatus(b.status);
      if (s === undefined) errors.push("Status must be Active or Inactive.");
      else if (s || !partial) out.status = s || "Active";
    }
    if (has("mobile")) {
      const m = normMobile(b.mobile);
      if (m.error) errors.push(m.error); else out.mobile = m.value;
    }
    if (has("joining_date")) {
      const d = clean(b.joining_date);
      if (d && !S.DATE_RE.test(d)) errors.push("Joining date must be YYYY-MM-DD.");
      else out.joining_date = d || null;
    }
    if (has("salary")) {
      const n = b.salary === "" || b.salary == null ? 0 : Number(b.salary);
      if (!Number.isFinite(n) || n < 0) errors.push("Salary must be a non-negative number.");
      else out.salary = n;
    }
    if (b.sponsor_company_id === undefined && clean(b.vendor)) {
      const hit = db.prepare("SELECT id,name FROM companies").all()
        .find(c => normName(c.name) === normName(b.vendor));
      if (!hit) errors.push(`Visa/Sponsor company "${clean(b.vendor)}" is not in the company list. Add it under Companies & Suppliers first.`);
      else b = { ...b, sponsor_company_id: hit.id };
    }
    if (b.sponsor_company_id !== undefined || (!partial && b.sponsor_company_id === undefined)) {
      const id = b.sponsor_company_id === "" || b.sponsor_company_id == null ? null : Number(b.sponsor_company_id);
      if (id) {
        const c = activeCompany(id);
        if (!c) errors.push("Visa/Sponsor company must be an active company.");
        else { out.sponsor_company_id = id; out.vendor = c.name; }
      } else { out.sponsor_company_id = null; out.vendor = null; }
    }
    if (b.company_id !== undefined) {
      const id = b.company_id === "" || b.company_id == null ? null : Number(b.company_id);
      if (id && !activeCompany(id)) errors.push("Working/Assigned company must be an active company.");
      else out.company_id = id;
    }
    return { out, errors };
  }

  function reassign(workerId, newId, req, note) {
    const w = db.prepare("SELECT company_id FROM workers WHERE id=?").get(workerId);
    if ((w.company_id || null) === (newId || null)) return false;
    db.prepare("UPDATE workers SET company_id=?, updated_at=? WHERE id=?").run(newId || null, nowUae(), workerId);
    db.prepare(`INSERT INTO worker_assignments(worker_id,from_company_id,to_company_id,changed_by,changed_at,note)
      VALUES(?,?,?,?,?,?)`).run(workerId, w.company_id || null, newId || null,
      req.session.user?.username || null, nowUae(), clean(note).slice(0, 200) || null);
    audit(db, req, "worker.reassign", "worker", workerId, { from: w.company_id, to: newId });
    return true;
  }

  app.post("/api/v2/workers", admin, (req, res) => {
    const c = normCode(req.body.worker_code ?? req.body.employee_id);
    if (c.error) return fail(res, 400, c.error, { field: "worker_code" });
    const { out, errors } = readWorkerInput(req.body, { partial: false });
    if (errors.length) return fail(res, 400, errors[0], { errors });
    const dup = db.prepare("SELECT id,name FROM workers WHERE UPPER(worker_code)=?").get(c.value);
    if (dup) return fail(res, 409, `Employee ID ${c.value} already exists (${dup.name}).`,
      { field: "worker_code", existing_id: dup.id });
    try {
      const r = db.prepare(`INSERT INTO workers(worker_code,name,employee_type,vendor,sponsor_company_id,mobile,
        designation,salary,status,joining_date,company_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(c.value, out.name, out.employee_type, out.vendor ?? null, out.sponsor_company_id ?? null,
          out.mobile ?? null, out.designation ?? null, out.salary ?? 0, out.status, out.joining_date ?? null,
          out.company_id ?? null, nowUae());
      if (out.company_id) db.prepare(`INSERT INTO worker_assignments(worker_id,from_company_id,to_company_id,
        changed_by,changed_at,note) VALUES(?,?,?,?,?,'Initial assignment')`)
        .run(r.lastInsertRowid, null, out.company_id, req.session.user?.username || null, nowUae());
      audit(db, req, "worker.create", "worker", r.lastInsertRowid, { code: c.value });
      res.status(201).json({ success: true, id: Number(r.lastInsertRowid), worker_code: c.value,
        profile_url: `/worker.html?id=${r.lastInsertRowid}` });
    } catch (e) {
      if (String(e.message).includes("UNIQUE")) return fail(res, 409, `Employee ID ${c.value} already exists.`);
      console.error("v2 create worker:", e); fail(res, 500, "Unable to create worker.");
    }
  });

  app.get("/api/v2/workers/:id", login, (req, res) => {
    const id = Number(req.params.id);
    const w = db.prepare(`${S.WORKER_SELECT} WHERE w.id=?`).get(id);
    if (!w) return fail(res, 404, "Worker not found.");
    const full = db.prepare("SELECT salary FROM workers WHERE id=?").get(id);
    const worker = { ...w, company_type_label: typeLabel(w.employee_type) };
    if (isAdmin(req)) worker.salary = full.salary;
    const history = db.prepare(`SELECT h.id,h.changed_at,h.changed_by,h.note,
        fc.name from_company, tc.name to_company FROM worker_assignments h
        LEFT JOIN companies fc ON fc.id=h.from_company_id LEFT JOIN companies tc ON tc.id=h.to_company_id
        WHERE h.worker_id=? ORDER BY h.id DESC LIMIT 50`).all(id);
    const recent = S.attendanceQuery(db, { worker_id: id, page_size: 10 });
    const stats = db.prepare(`SELECT COUNT(DISTINCT attendance_date) days, COUNT(*) records,
      MAX(attendance_date) last_date FROM attendance WHERE worker_id=? AND check_in IS NOT NULL`).get(id);
    const open = db.prepare("SELECT id FROM attendance WHERE worker_id=? AND check_in IS NOT NULL AND check_out IS NULL").get(id);
    res.json({ worker, assignment_history: history, recent_attendance: recent.items, stats,
      currently_checked_in: !!open });
  });

  app.patch("/api/v2/workers/:id", admin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM workers WHERE id=?").get(id)) return fail(res, 404, "Worker not found.");
    if (req.body.worker_code !== undefined)
      return fail(res, 400, "Employee ID cannot be changed (it is printed on the worker's QR code).");
    const { out, errors } = readWorkerInput(req.body, { partial: true });
    if (errors.length) return fail(res, 400, errors[0], { errors });
    const { company_id, ...cols } = out;
    try {
      db.transaction(() => {
        const keys = Object.keys(cols);
        if (keys.length) {
          db.prepare(`UPDATE workers SET ${keys.map(k => `${k}=?`).join(",")}, updated_at=? WHERE id=?`)
            .run(...keys.map(k => cols[k]), nowUae(), id);
          audit(db, req, "worker.update", "worker", id, { fields: keys.filter(k => k !== "salary") });
        }
        if (company_id !== undefined) reassign(id, company_id, req, req.body.note);
      })();
      res.json({ success: true });
    } catch (e) { console.error("v2 patch worker:", e); fail(res, 500, "Unable to update worker."); }
  });

  app.post("/api/v2/workers/:id/reassign", admin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare("SELECT 1 FROM workers WHERE id=?").get(id)) return fail(res, 404, "Worker not found.");
    const cid = req.body.company_id === "" || req.body.company_id == null ? null : Number(req.body.company_id);
    if (cid && !activeCompany(cid)) return fail(res, 400, "Working/Assigned company must be an active company.");
    const changed = db.transaction(() => reassign(id, cid, req, req.body.note))();
    res.json({ success: true, changed, note: "Historical attendance records keep their original company." });
  });

  /* ---------- companies ---------- */
  function companyRows(q) {
    const where = [], params = [];
    if (clean(q.search)) { where.push("c.name LIKE ? ESCAPE '\\'"); params.push(`%${S.likeEsc(clean(q.search))}%`); }
    if (q.status === "Active" || q.status === "Inactive") { where.push("c.status=?"); params.push(q.status); }
    if (ROLES.includes(q.role)) { where.push("c.id IN (SELECT company_id FROM company_roles WHERE role=?)"); params.push(q.role); }
    if (q.role === "unclassified") where.push("c.id NOT IN (SELECT company_id FROM company_roles)");
    const rolesOf = companyRoles();
    return db.prepare(`SELECT c.id,c.name,c.status,c.contact_person,c.contact_number,c.notes,c.review_required,
      (SELECT COUNT(*) FROM workers w WHERE w.company_id=c.id AND w.status='Active') active_workers,
      (SELECT COUNT(*) FROM workers w WHERE w.sponsor_company_id=c.id AND w.status='Active') sponsored_workers,
      (SELECT COUNT(*) FROM sites s WHERE s.company_id=c.id) site_count
      FROM companies c ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY c.name COLLATE NOCASE`).all(...params).map(c => ({ ...c, roles: rolesOf(c.id) }));
  }
  app.get("/api/v2/companies", login, (req, res) => {
    const items = companyRows(req.query);
    const byRole = {};
    for (const r of ROLES) byRole[r] = items.filter(c => c.roles.includes(r)).length;
    byRole.unclassified = items.filter(c => !c.roles.length).length;
    res.json({ items, total: items.length, by_role: byRole, role_labels: ROLE_LABEL });
  });

  function readRoles(v) {
    if (v === undefined) return { value: undefined };
    const arr = Array.isArray(v) ? v : [];
    if (arr.some(r => !ROLES.includes(r))) return { error: "Invalid company category." };
    return { value: [...new Set(arr)] };
  }
  const setRoles = (id, roles) => {
    db.prepare("DELETE FROM company_roles WHERE company_id=?").run(id);
    const ins = db.prepare("INSERT INTO company_roles(company_id,role) VALUES(?,?)");
    roles.forEach(r => ins.run(id, r));
  };
  function dupCompany(name, exceptId) {
    const n = normName(name);
    return db.prepare("SELECT id,name FROM companies").all().find(c => normName(c.name) === n && c.id !== exceptId);
  }

  app.post("/api/v2/companies", admin, (req, res) => {
    const name = clean(req.body.name);
    if (!name) return fail(res, 400, "Company name is required.");
    if (name.length > 120) return fail(res, 400, "Company name is too long (max 120).");
    const r = readRoles(req.body.roles ?? []);
    if (r.error) return fail(res, 400, r.error);
    const d = dupCompany(name);
    if (d) return fail(res, 409, `Company already exists: ${d.name}.`, { existing_id: d.id });
    const id = db.transaction(() => {
      const x = db.prepare(`INSERT INTO companies(name,contact_person,contact_number,notes,status,review_required)
        VALUES(?,?,?,?, 'Active', ?)`).run(name, clean(req.body.contact_person) || null,
        clean(req.body.contact_number) || null, clean(req.body.notes) || null, r.value.length ? 0 : 1);
      setRoles(x.lastInsertRowid, r.value);
      return Number(x.lastInsertRowid);
    })();
    audit(db, req, "company.create", "company", id, { name, roles: r.value });
    res.status(201).json({ success: true, id });
  });

  app.patch("/api/v2/companies/:id", admin, (req, res) => {
    const id = Number(req.params.id);
    const cur = db.prepare("SELECT * FROM companies WHERE id=?").get(id);
    if (!cur) return fail(res, 404, "Company not found.");
    const b = req.body, sets = {}, r = readRoles(b.roles);
    if (r.error) return fail(res, 400, r.error);
    if (b.name !== undefined) {
      const n = clean(b.name);
      if (!n) return fail(res, 400, "Company name is required.");
      const d = dupCompany(n, id);
      if (d) return fail(res, 409, `Company already exists: ${d.name}.`, { existing_id: d.id });
      sets.name = n;
    }
    for (const k of ["contact_person", "contact_number", "notes"])
      if (b[k] !== undefined) sets[k] = clean(b[k]) || null;
    if (b.status !== undefined) {
      if (!["Active", "Inactive"].includes(b.status)) return fail(res, 400, "Status must be Active or Inactive.");
      if (b.status === "Inactive") {
        const n = db.prepare("SELECT COUNT(*) c FROM workers WHERE company_id=? AND status='Active'").get(id).c;
        if (n) return fail(res, 409, `${n} active worker(s) are assigned to this company. Reassign them first.`, { worker_count: n });
      }
      sets.status = b.status;
    }
    if (r.value !== undefined) sets.review_required = r.value.length ? 0 : 1;
    if (b.mark_reviewed === true) sets.review_required = 0;
    db.transaction(() => {
      const keys = Object.keys(sets);
      if (keys.length) db.prepare(`UPDATE companies SET ${keys.map(k => `${k}=?`).join(",")} WHERE id=?`)
        .run(...keys.map(k => sets[k]), id);
      if (r.value !== undefined) setRoles(id, r.value);
    })();
    audit(db, req, "company.update", "company", id, { fields: Object.keys(sets), roles: r.value });
    res.json({ success: true });
  });

  /* ---------- attendance (paged; Recent Attendance + records) ---------- */
  app.get("/api/v2/attendance", login, (req, res) => {
    try { autoCheckoutExpired(); res.json(S.attendanceQuery(db, req.query)); }
    catch (e) { console.error("v2 attendance:", e); fail(res, 500, "Unable to load attendance."); }
  });

  /* ---------- dashboard analytics ---------- */
  const addDays = (d, n) => {
    const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };

  app.get("/api/v2/dashboard", login, (req, res) => {
    try {
      autoCheckoutExpired();
      const q = req.query;
      const date = S.DATE_RE.test(q.date || "") ? q.date : today();
      const month = S.MONTH_RE.test(q.month || "") ? q.month : null;
      const companyId = Number(q.company_id) || null;
      const siteId = Number(q.site_id) || null;
      const wStatus = S.normStatus(q.status) || null;

      /* headcount scope (unique workers, by CURRENT working company) */
      const wW = [], wP = [];
      if (companyId) { wW.push("w.company_id=?"); wP.push(companyId); }
      const WH = wW.length ? " AND " + wW.join(" AND ") : "";
      const one = (sql, ...p) => db.prepare(sql).get(...p);

      const hc = one(`SELECT COUNT(*) total,
        COALESCE(SUM(status='Active'),0) active, COALESCE(SUM(status<>'Active'),0) inactive,
        COALESCE(SUM(status='Active' AND employee_type='Company'),0) group_workers,
        COALESCE(SUM(status='Active' AND employee_type='Supplier'),0) supplier_workers
        FROM workers w WHERE 1=1 ${WH}`, ...wP);

      /* attendance scope (records snapshot company/site at check-in time) */
      const aW = ["a.check_in IS NOT NULL"], aP = [];
      if (companyId) { aW.push("a.company_id=?"); aP.push(companyId); }
      if (siteId) { aW.push("a.site_id=?"); aP.push(siteId); }
      const AW = aW.join(" AND ");
      const present = one(`SELECT COUNT(DISTINCT a.worker_id) c FROM attendance a
        WHERE ${AW} AND a.attendance_date=?`, ...aP, date).c;
      const checkedIn = one(`SELECT COUNT(DISTINCT a.worker_id) c FROM attendance a
        WHERE ${AW} AND a.check_out IS NULL`, ...aP).c;

      const sW = ["status='Active'"], sP = [];
      if (companyId) { sW.push("company_id=?"); sP.push(companyId); }
      const sites = one(`SELECT COUNT(*) c FROM sites WHERE ${sW.join(" AND ")}`, ...sP).c;
      const companies = one("SELECT COUNT(*) c FROM companies WHERE status='Active'").c;

      /* charts: unique workers; status filter defaults to Active */
      const chartStatus = wStatus || "Active";
      const cW = ["w.status=?", ...wW], cP = [chartStatus, ...wP];
      const CW = cW.join(" AND ");
      const byCompany = db.prepare(`SELECT COALESCE(c.name,'Unassigned') name, COUNT(*) count
        FROM workers w LEFT JOIN companies c ON c.id=w.company_id WHERE ${CW}
        GROUP BY c.id ORDER BY count DESC, name`).all(...cP);
      const bySponsor = db.prepare(`SELECT COALESCE(sc.name, NULLIF(TRIM(w.vendor),''), 'Not specified') name, COUNT(*) count
        FROM workers w LEFT JOIN companies sc ON sc.id=w.sponsor_company_id WHERE ${CW}
        GROUP BY 1 ORDER BY count DESC, name`).all(...cP);
      const byDesignation = db.prepare(`SELECT COALESCE(NULLIF(UPPER(TRIM(w.designation)),''),'Not specified') name, COUNT(*) count
        FROM workers w WHERE ${CW} GROUP BY 1 ORDER BY count DESC, name LIMIT 15`).all(...cP);
      const byType = db.prepare(`SELECT w.employee_type type, COUNT(*) count FROM workers w WHERE ${CW}
        GROUP BY 1`).all(...cP).map(r => ({ name: typeLabel(r.type), count: r.count }));

      /* trends: distinct workers per day / month */
      const days = Math.min(90, Math.max(7, parseInt(q.days) || 30));
      const from = month ? month + "-01" : addDays(date, -(days - 1));
      const to = month ? addDays(addDays(month + "-01", 32).slice(0, 8) + "01", -1) : date;
      const rows = db.prepare(`SELECT a.attendance_date d, COUNT(DISTINCT a.worker_id) workers, COUNT(*) records
        FROM attendance a WHERE ${AW} AND a.attendance_date BETWEEN ? AND ? GROUP BY a.attendance_date`)
        .all(...aP, from, to);
      const map = new Map(rows.map(r => [r.d, r]));
      const daily = [];
      for (let d = from; d <= to && daily.length < 400; d = addDays(d, 1))
        daily.push({ date: d, workers: map.get(d)?.workers || 0, records: map.get(d)?.records || 0 });
      const monthly = db.prepare(`SELECT substr(a.attendance_date,1,7) month, COUNT(DISTINCT a.worker_id) workers,
        COUNT(*) records, COUNT(DISTINCT a.attendance_date) days FROM attendance a
        WHERE ${AW} AND a.attendance_date>=? GROUP BY 1 ORDER BY 1`)
        .all(...aP, addDays(date.slice(0, 7) + "-01", -366).slice(0, 7) + "-01");

      /* company distribution table */
      const presentBy = new Map(db.prepare(`SELECT COALESCE(a.company_id,0) id, COUNT(DISTINCT a.worker_id) c
        FROM attendance a WHERE a.check_in IS NOT NULL AND a.attendance_date=? ${siteId ? "AND a.site_id=?" : ""}
        GROUP BY 1`).all(...(siteId ? [date, siteId] : [date])).map(r => [r.id, r.c]));
      const distribution = S.companyWorkforceRows(db)
        .filter(r => !companyId || r.company_id === companyId)
        .map(r => ({ ...r, present_on_date: presentBy.get(r.company_id) || 0 }));

      res.json({
        date, month, filters: { company_id: companyId, site_id: siteId, status: wStatus },
        kpis: {
          total_workers: hc.total, active_workers: hc.active, inactive_workers: hc.inactive,
          group_company_workers: hc.group_workers, supplier_workers: hc.supplier_workers,
          present_today: present, checked_in_now: checkedIn,
          absent_today: null,
          attendance_rate_pct: hc.active ? Math.round((present / hc.active) * 1000) / 10 : null,
          total_companies: companies, active_sites: sites
        },
        charts: { by_company: byCompany, by_sponsor: bySponsor, by_designation: byDesignation,
          by_type: byType, active_vs_inactive: [{ name: "Active", count: hc.active }, { name: "Inactive", count: hc.inactive }],
          daily_trend: daily, monthly_trend: monthly },
        distribution,
        definitions: {
          total_workers: "Unique worker records (all statuses) in scope.",
          active_workers: "Unique workers with status Active.",
          group_company_workers: "Unique Active workers whose Company Type is Group Company.",
          supplier_workers: "Unique Active workers whose Company Type is Supplier (SUP).",
          present_today: "Unique workers with at least one check-in on the selected date.",
          checked_in_now: "Unique workers with an open check-in (no check-out yet).",
          absent_today: "Unavailable: the system has no expected-attendance roster/shift, so absence cannot be derived reliably. Active workers without a check-in are NOT counted as absent.",
          attendance_rate_pct: "Workers present on the date ÷ Active workers in scope × 100. A participation rate, not an absence measure.",
          charts: `Headcount charts count unique workers with status ${chartStatus} grouped by current working company. Trends count distinct workers per day/month (records shown separately).`,
          filters: "Company filter: headcount uses the worker's current company; attendance uses the company recorded at check-in. Site filter applies to attendance only."
        }
      });
    } catch (e) { console.error("v2 dashboard:", e); fail(res, 500, "Unable to load dashboard."); }
  });

  /* ---------- reports ---------- */
  app.get("/api/v2/reports/company-workforce", login, (req, res) => {
    const items = S.companyWorkforceRows(db);
    const sum = k => items.reduce((s, r) => s + (r[k] || 0), 0);
    res.json({ items, totals: { total_workers: sum("total_workers"), active_workers: sum("active_workers"),
      inactive_workers: sum("inactive_workers"), group_workers: sum("group_workers"), supplier_workers: sum("supplier_workers") } });
  });
  app.get("/api/v2/reports/monthly", login, (req, res) => {
    autoCheckoutExpired();
    const r = S.monthlyRows(db, req.query);
    if (r.error) return fail(res, 400, r.error);
    res.json(r);
  });
  app.get("/api/v2/audit", admin, (req, res) => {
    const size = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    res.json({ items: db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(size) });
  });

  return { nowUae, reassign };
}

module.exports = { mount, ROLES };
