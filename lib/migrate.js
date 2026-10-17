"use strict";
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 1;

/* Company names supplied by the owner. Spelling preserved exactly.
   They are NOT assigned a group/supplier/client role: that must be reviewed. */
const SEED_UNCLASSIFIED = [
  "AL SABIHA ELECTROMECHANICAL WORKS",
  "ALLAIL AL SARI TECHNICAL",
  "AL SABIHA CLEANING SERVICES",
  "SAHAT AL MADINA",
  "IZZAT AL MADINA",
  "DIWAKAR KUMAR TECHNICAL SERVICES",
  "SAFA AL SAMA TECHNICAL SERVICES"
];
/* The owner explicitly described these as client/working companies. */
const CLIENTS = ["ARCELOR MITTAL", "MTC", "EMK STEEL"];

const normName = s => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

function hasCol(db, table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
}

function migrate(db, dbPath) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT)`);
  const row = db.prepare("SELECT value FROM schema_meta WHERE key='version'").get();
  const current = row ? Number(row.value) : 0;
  if (current >= SCHEMA_VERSION) return { migrated: false, backup: null };

  /* 1. File backup BEFORE touching anything (only when there is data). */
  let backup = null;
  const hasData = db.prepare("SELECT COUNT(*) c FROM workers").get().c +
                  db.prepare("SELECT COUNT(*) c FROM attendance").get().c > 0;
  if (hasData && dbPath && fs.existsSync(dbPath)) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    const dir = path.join(path.dirname(dbPath), "backups");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    backup = path.join(dir, `attendance-pre-migration-v${SCHEMA_VERSION}-${stamp}.db`);
    fs.copyFileSync(dbPath, backup);
  }

  /* 2. Migration inside one transaction: all or nothing. */
  const run = db.transaction(() => {
    if (!hasCol(db, "companies", "review_required"))
      db.exec("ALTER TABLE companies ADD COLUMN review_required INTEGER DEFAULT 0");
    if (!hasCol(db, "companies", "notes"))
      db.exec("ALTER TABLE companies ADD COLUMN notes TEXT");
    if (!hasCol(db, "workers", "sponsor_company_id"))
      db.exec("ALTER TABLE workers ADD COLUMN sponsor_company_id INTEGER REFERENCES companies(id)");
    if (!hasCol(db, "workers", "updated_at"))
      db.exec("ALTER TABLE workers ADD COLUMN updated_at TEXT");

    db.exec(`
CREATE TABLE IF NOT EXISTS company_roles(
  company_id INTEGER NOT NULL REFERENCES companies(id),
  role TEXT NOT NULL CHECK(role IN ('group','supplier','client')),
  PRIMARY KEY(company_id, role)
);
CREATE TABLE IF NOT EXISTS worker_assignments(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id),
  from_company_id INTEGER,
  to_company_id INTEGER,
  changed_by TEXT,
  changed_at TEXT NOT NULL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT
);
CREATE TABLE IF NOT EXISTS import_history(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  filename TEXT,
  mode TEXT,
  total_rows INTEGER DEFAULT 0,
  created INTEGER DEFAULT 0,
  updated INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  invalid INTEGER DEFAULT 0,
  outcome TEXT,
  errors_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_workers_name ON workers(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);
CREATE INDEX IF NOT EXISTS idx_workers_company ON workers(company_id);
CREATE INDEX IF NOT EXISTS idx_workers_sponsor ON workers(sponsor_company_id);
CREATE INDEX IF NOT EXISTS idx_att_worker ON attendance(worker_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_att_company ON attendance(company_id);
CREATE INDEX IF NOT EXISTS idx_att_site ON attendance(site_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
`);

    /* Backfill sponsor reference ONLY on exact (case/space-insensitive) match. */
    const companies = db.prepare("SELECT id,name FROM companies").all();
    const byName = new Map(companies.map(c => [normName(c.name), c.id]));
    const ws = db.prepare(`SELECT id,vendor FROM workers
      WHERE sponsor_company_id IS NULL AND vendor IS NOT NULL AND TRIM(vendor)<>''`).all();
    const setSponsor = db.prepare("UPDATE workers SET sponsor_company_id=? WHERE id=?");
    for (const w of ws) {
      const id = byName.get(normName(w.vendor));
      if (id) setSponsor.run(id, w.id);
    }

    /* Seed companies (never overwrite / reclassify existing ones). */
    const insC = db.prepare(
      "INSERT INTO companies(name,status,review_required) VALUES(?, 'Active', ?)");
    const addRole = db.prepare(
      "INSERT OR IGNORE INTO company_roles(company_id,role) VALUES(?,?)");
    const existing = () => new Map(
      db.prepare("SELECT id,name FROM companies").all().map(c => [normName(c.name), c.id]));
    let map = existing();
    for (const n of SEED_UNCLASSIFIED)
      if (!map.has(normName(n))) insC.run(n, 1);
    for (const n of CLIENTS)
      if (!map.has(normName(n))) insC.run(n, 0);
    map = existing();
    for (const n of CLIENTS) addRole.run(map.get(normName(n)), "client");
    /* Existing companies without any role are flagged for review. */
    db.exec(`UPDATE companies SET review_required=1
             WHERE id NOT IN (SELECT company_id FROM company_roles)`);

    db.prepare("INSERT OR REPLACE INTO schema_meta(key,value) VALUES('version',?)")
      .run(String(SCHEMA_VERSION));
  });
  run();

  /* 3. One open attendance per worker, enforced by the database when the
        existing data allows it (otherwise the app-level check remains). */
  try {
    const dup = db.prepare(`SELECT COUNT(*) c FROM (
      SELECT worker_id FROM attendance WHERE check_in IS NOT NULL AND check_out IS NULL
      GROUP BY worker_id HAVING COUNT(*)>1)`).get().c;
    if (!dup) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_att_one_open
      ON attendance(worker_id) WHERE check_in IS NOT NULL AND check_out IS NULL`);
  } catch (e) { console.warn("Open-attendance index skipped:", e.message); }

  return { migrated: true, backup };
}

module.exports = { migrate, normName, SCHEMA_VERSION };
