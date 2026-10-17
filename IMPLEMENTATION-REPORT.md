# IMPLEMENTATION REPORT — AL SABIHA Manpower Platform upgrade

**Scope delivered:** an in-place upgrade of the existing Node/Express/SQLite app. Nothing was rebuilt, no table/column was dropped, existing routes and response shapes were kept. **Nothing was deployed, pushed to GitHub, or migrated on production.** Everything was run against throw-away databases (and a *copy* of the supplied DB).

## 1. Status at a glance
### ✅ Completed and tested (automated: 24 API/security tests + 58 real-browser checks, all passing — see TEST-REPORT.md)
- Pre-change backup; additive, idempotent, transactional DB migration with its own pre-migration file backup; rollback script (restore tested).
- Worker Database page: two independent search boxes (name / Employee ID), whitespace + case tolerant, clear buttons, safe `<mark>` highlighting, total count, "No workers found", pagination, sorting, filters, filters preserved after viewing a worker, export of the filtered list.
- Add Worker page with front- and back-end validation, normalized unique Employee ID, success link, duplicate → link to the existing worker.
- Worker profile: view, controlled edit (Employee ID immutable), reassignment with history, activate/deactivate with confirmation, QR, recent attendance.
- Company master data: categories **Group / External Supplier / Client-Project** (a company may hold several), active/inactive, search/filter, duplicate prevention, worker counts, "needs review" flag, deactivation blocked while active workers are assigned.
- Separate Sponsor vs Working company; reassignment never rewrites attendance history (verified).
- Excel: template, upload → validation → preview → mode choice → transactional import → summary → history → downloadable error report; add-only and update modes; formula-injection protection both ways.
- Exports: workers, attendance, company-wise workforce, monthly (filters respected, real Excel date cells, sensible widths, formula-safe).
- Dashboard (analytics only) with documented definitions, filters, KPI cards, bar/donut/line charts, company distribution; Recent Attendance, Quick Actions, Attendance Analytics, Company-wise Workforce, Monthly Reports as **separate pages**.
- Shared light design system + responsive shell applied to every page (including legacy scan/manual/reports/sites/settings); 15/15 navigation links resolve; no console errors; no horizontal overflow at 1280 and 390 px.
- Security: rate limiting, constant-time PIN compare (query-string PIN removed), CSRF origin check, persistent SQLite sessions, security headers, salary removed from Worker App responses, audit log, confirmation required for permanent delete, manual-attendance validation.
- Existing behaviour re-verified: login, QR check-in/out, duplicate check-in block, 12-hour auto-checkout (and early manual checkout), current assignment in QR lookup.

### 🟡 Implemented but NOT fully tested
- **Android Admin + Worker apps** (`android/`): source for a hardened WebView shell with two flavors. **Never compiled or installed** (no JDK compiler/Gradle/SDK in this environment). The per-flavor signing hook uses an AGP 8.x API I could not verify.
- Camera scanning in the browser: pages render and degrade gracefully, but real camera/QR decoding was **not** exercised (no camera, and the CDN library is unreachable offline).
- Behaviour on the live Railway host (HTTPS cookies, `NODE_ENV=production`) — not tested.
- Imports of very large files (5,000 rows is the limit; only small files were tested).

### ⛔ Blocked (credentials / external access)
- **Signed APKs:** no signing keystores supplied, no Android toolchain. Steps in `android/README.md`.
- Deployment, GitHub push, production migration: not authorized, not done.
- Upgrading SheetJS and vendoring the QR library (no network). See audit S13/S14.

### ❌ Not implemented
- **User Accounts & Permissions UI / multi-role RBAC:** the existing system has a single `admin` role; the upgrade enforces admin-only writes but adds no user management.
- Redesign of `index.html`/`login.html` (public entry pages), `mobile.html`, `worker-app.html` — kept as-is because they are APK content; they were only given the logo-path fix and pinned scanner library.
- Expected-attendance roster → **"Today's Absent" is intentionally shown as N/A.**
- Worker App secret login (see decision below).

## 2. Decisions you should review
1. **"Absent" is not computed.** There is no roster/shift data; counting every non-present worker as absent (the old behaviour) was wrong. The dashboard shows *Attendance rate = present ÷ active workers* with the definition on screen. If you supply an expected-attendance rule (e.g. per-site rosters) it can be added.
2. **Company classification.** Only ARCELOR MITTAL, MTC and the newly added EMK STEEL are marked *Client/Project* (you described them so). Your seven named companies were added **unclassified + "Needs review"**; so were the pre-existing ABS ENG, LEFTEK and AL SABIHA. Classify them on *Companies & Suppliers*. Until then "Workers by supplier/group" uses the worker's **Company Type** field (Group Company / Supplier (SUP), stored as the legacy `Company` / `Supplier`).
3. **Sponsor field.** Existing free-text `vendor` is preserved; a validated `sponsor_company_id` is filled only on an exact name match (e.g. `AL SABIHA`).
4. **Worker App login still needs only a worker name/code** (your earlier "remove PIN" commit). I removed salary from its responses and rate-limited it, but anyone who knows a code can see that worker's profile and mark attendance. Safer options: code + last 4 digits of mobile, or a per-worker PIN. Not changed without your approval.
5. **Employee ID is immutable** in the new UI (it is printed on the QR code).

## 3. Actions required from you
1. **Rotate `MOBILE_APP_PIN` and the admin password.** The ZIP you shared contained `.env`; it was never in git history, but treat it as exposed. The default `admin/admin123` account still works until you change it (a startup warning is printed).
2. Set `SESSION_SECRET` in Railway (sessions are now persisted, but a missing secret regenerates on each restart).
3. Back up production, deploy to a **staging** service first, check the log line `Database upgraded to schema v1. Backup: …`.
4. Classify the companies flagged *Needs review*.
5. Android: supply HTTPS URL + two keystores, build on a machine with Android Studio.

## 4. Database changes (migration v1, additive)
New tables: `schema_meta, company_roles, worker_assignments, audit_log, import_history, sessions`. New columns: `companies.review_required, companies.notes, workers.sponsor_company_id, workers.updated_at`. New indexes (names, status, company, sponsor, attendance lookups) and a partial unique index allowing **one open attendance per worker** (created only if current data has no violations). No existing row is modified except the sponsor backfill (exact matches) and the review flags. Rollback: `node scripts/rollback-migration.js <backup>` (tested) or the optional SQL.

## 5. API additions (`/api/v2/*`, legacy routes untouched)
`lookups`; `workers` (list, get, create, PATCH, reassign); `companies` (list, create, PATCH); `attendance` (paged); `dashboard`; `reports/company-workforce`, `reports/monthly`; `import/template.xlsx`, `import/preview`, `import/commit`, `import/history`, error reports; `export/workers|attendance|company-workforce|monthly.xlsx`; `audit`.

## 6. Changed / added files
**Modified:** `server.js` (migration call, security middleware, SQLite sessions, rate limiting, v2 mount, salary removal, PIN hardening, manual-attendance validation, test-delete confirmation, absent fix), `package.json` (test script, version 2.0.0), `.gitignore`, `public/app.js` (new shared shell/helpers; original in `archive/app.js.original`), `public/dashboard.html`, `workers.html`, `companies.html` (rewritten; originals in `archive/`), `public/scan.html`, `mobile.html` (pinned scanner library, logo path, page title), all pages referencing `/logo.svg` (now `/Logo.svg`).
**Added:** `lib/{security,migrate,shared,v2,importexport}.js`, `public/css/ds.css`, `public/js/charts.js`, pages `worker-add, worker, quick-actions, recent-attendance, analytics, company-report, monthly-report, import`, `scripts/rollback-migration.{js,sql}`, `templates/AL-SABIHA-Worker-Import-Template.xlsx`, `tests/{api.test.js,browser.check.js}`, `android/**`, and the five documents.
**Moved (not deleted):** stale `public/mobile-backup.html`, `public/worker-app-backup.html` → `archive/` (they were publicly served).
**Not touched:** `DATA/`, `.env`, `node_modules/`, `.git/`, `Logo.svg`, `login.html`, `index.html` (logo fix only), `worker-app.html`.

## 7. Known limitations
- Legacy pages (`scan`, `manual-attendance`, `reports`, `sites`, `settings`) keep their own internal logic and use `alert()`; they only inherit the new shell/styling. `scan.html` keeps its dark hero banner.
- Legacy `/api/analytics` still runs per-day queries; the new pages don't use it.
- Site "worker count" on the Sites page still means workers of the site's company (legacy meaning).
- Header quick-search replaced the old global search dropdown; it opens the Worker Database.
- Import limits: 10 MB, 5,000 rows; previews are held in server memory for 30 minutes (lost on restart).
- Rate limiting is per-process memory (fine for the single Railway instance).
