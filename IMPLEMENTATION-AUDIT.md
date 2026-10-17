# IMPLEMENTATION AUDIT — AL SABIHA Manpower Attendance System

Audit date: 13 Oct 2026. Based on inspection of the supplied ZIP (source read, DB schema/data inspected on a **copy**, git history checked). Nothing here was verified against the live Railway deployment.

## 1. Backup
- Original ZIP preserved unchanged: `backup/ORIGINAL-AL-SABIHA-20261012-125619.zip` (SHA-256 `d9d694f9…091ada`).
- The supplied `DATA/attendance.db` was **never opened in place**; a copy was used for inspection. Upgrade code creates its own timestamped DB backup before any migration (see §6).

## 2. Architecture
| Item | Finding |
|---|---|
| Runtime | Node ≥ 22 (tested on v22.22.2), Express 4, express-session, better-sqlite3 11, bcryptjs, qrcode, xlsx (SheetJS 0.18.5) |
| Database | SQLite, `DATA_DIR/attendance.db`, WAL. Tables: `users, workers, companies, sites, attendance` |
| Backend | One 4,117-line `server.js` (no modules, no tests) |
| Frontend | Static HTML in `public/`; legacy pages call `shell()` from `app.js`, which rewrites `document.body` and injects ~740 lines of CSS from JS |
| Mobile | `mobile.html` (admin, PIN-gated `/api/mobile/*`) and `worker-app.html` (worker, session). **No Android project exists in the ZIP** (no Gradle, manifest, or APK) |
| Deploy | Railway, `npm start`, health `/api/health` |
| Existing data | 9 workers, 5 companies, 5 sites, 22 attendance rows, 1 user (`admin`) — looks like real/test data; treat as production |

## 3. Data model facts (drive the upgrade design)
- `workers.employee_type` = **Company Type** (`Company` | `Supplier`). Stored codes preserved; UI labels become *Group Company* / *Supplier (SUP)*.
- `workers.vendor` = free-text **Visa/Sponsor company** (e.g. `AL SABIHA`, often blank).
- `workers.company_id` = **Working/Assigned company**.
- `attendance.company_id` is already a **snapshot at check-in**, so transfers do not rewrite history. 0 existing rows have NULL company.
- `companies` has **no category**; `sites` has duplicate names with different companies (ids 1–3) — intentional per-client sites, left alone.
- Timestamps are naive `YYYY-MM-DD HH:MM:SS` strings produced in `Asia/Dubai` (correct, server-side).

## 4. Features: working / incomplete / broken
**Working (verified by reading code; re-tested in TEST-REPORT.md):** admin login, worker CRUD (soft-disable), QR generation (QR payload = `worker_code`), QR lookup/check-in/check-out, one-open-attendance rule, manual attendance, 12-hour auto-checkout (timer + on dashboard load; manual checkout earlier stays valid), transfer preserves history, attendance report + XLSX export, worker app login/QR/history, mobile admin API.

**Incomplete:** no company categories; no import; only one export; no pagination (all workers returned); no worker profile page; no audit log; no import history; dashboard analytics limited; no Android projects.

**Broken / wrong:**
| # | Issue | Risk |
|---|---|---|
| B1 | `absent_today = active workers − present` treats every worker as absent (violates spec) | Medium (wrong metric) |
| B2 | Six pages reference `/logo.svg`, file is `Logo.svg` → 404 on Linux/Railway (git also shows `logo.svg` deleted) | Low |
| B3 | Dashboard embeds Recent Attendance, Quick Actions and an Add Worker block (violates module separation) | Medium |
| B4 | `PUT /api/workers/:id` overwrites omitted fields with defaults (status→Active, salary→0); UNIQUE conflict leaks raw SQLite message | Medium |
| B5 | `DELETE /api/workers/:id` registered twice (second is dead code) | Low |
| B6 | `/api/analytics` runs 2 queries per day (N+1) and builds dates with server-local tz | Low |
| B7 | Site `worker_count` counts workers of the site's company (misleading) | Low |
| B8 | Manual attendance accepts any `check_in`/`check_out`/`attendance_date` string, no order check, no default company | Medium |
| B9 | `manifest.json` has empty `icons` | Low |
| B10 | `html5-qrcode` loaded from `unpkg.com` unpinned (supply-chain, offline failure) | Medium |
| B11 | `mobile-backup.html`, `worker-app-backup.html` (stale pages) served publicly from `public/` | Low |

## 5. Security findings
| # | Finding | Risk | Action |
|---|---|---|---|
| S1 | **Worker App login needs only a worker name or code (no secret)** and `/login` + `/me` return **`salary`** and mobile number. Codes like `WK001` are guessable | **High** | Stop returning salary (done). Identification-only login is a product decision from commit "Remove worker app PIN login" — **not changed**; options listed in report |
| S2 | No rate limiting on admin login, worker login, or mobile PIN | High | Added in-memory limiter |
| S3 | Mobile PIN compared with `!==`, also accepted in query string (ends up in logs) | Medium | Constant-time compare; header/body only |
| S4 | In-memory session store (sessions lost on restart; leaks in production) and random fallback secret if `SESSION_SECRET` unset | Medium | SQLite session store; startup warning |
| S5 | No CSRF defence beyond `SameSite=Lax` | Medium | Origin/Host check on unsafe methods |
| S6 | Default bootstrap admin `admin / admin123`; no forced change | High | Documented; startup warns while default password still valid |
| S7 | `DELETE /api/workers/:id/test-delete` irreversibly deletes a worker **and all attendance** with no confirmation/audit | Medium | Now requires `confirm_code` = worker code and is audit-logged |
| S8 | No audit trail for admin changes | Medium | `audit_log` table |
| S9 | No security headers | Low | Added basic headers (CSP deferred: inline scripts) |
| S10 | `.env` (contains `MOBILE_APP_PIN`) is inside the ZIP | Medium | **Rotate the PIN**; `.env` and DB were **never committed** to git (checked history) and are in `.gitignore` |
| S11 | Legacy `PUT`/`POST` trust client values (company/status) lightly | Low | v2 endpoints validate server-side |
| S12 | Parameterized queries used everywhere (no SQL injection found); dynamic SQL in reports only concatenates fixed fragments | OK | — |

## 6. Upgrade strategy (conservative)
1. Keep `server.js`, DB, routes, response shapes. New work lives in `/api/v2/*` and new files under `lib/` (migration, security, analytics, import, export).
2. Additive, idempotent migration; `db.backup()` to `DATA_DIR/backups/` first. No column/table dropped. Rollback script provided.
3. New light design system (`public/css/ds.css`, `public/js/core.js`). Legacy `shell()` delegates to it so untouched pages (scan, manual, sites, settings) share the frozen layout.
4. Android: no project exists → source scaffolds only; cannot be compiled in this environment (no JDK compiler/Gradle/SDK, no network).

## 7. Environment limits during this work
No network (cannot `npm install`, so **no new dependencies**; import uses SheetJS already present). Linux `better-sqlite3` was compiled in a separate test runtime; the project's own `node_modules` (Windows binary) was not modified. Production deployment, GitHub push, and DB migration on production were **not** performed.

## 8. Addendum — found while implementing the import
| # | Finding | Risk | Action |
|---|---|---|---|
| S13 | The bundled spreadsheet library (SheetJS `xlsx` 0.18.5, the last version on npm) has publicly known issues when parsing **maliciously crafted** workbooks (prototype pollution, ReDoS; fixed upstream in 0.19.3 / 0.20.2, which are only distributed from SheetJS's own site, not npm). It was already used by the legacy exports; the new **import reads uploaded files** | Medium | Import is admin-only, size/row-limited, extension + signature checked, and never evaluates formulas. **Residual risk remains. Only upload workbooks you created or trust.** Recommended follow-up (needs network, not possible here): upgrade to SheetJS ≥ 0.20.2 from cdn.sheetjs.com |
| S14 | Camera library `html5-qrcode` is loaded from `unpkg.com` at runtime (no integrity hash; scanning fails if the CDN is unreachable) | Low–Medium | Pinned to 2.3.8. Recommended follow-up: vendor the file into `public/js/` and add an SRI hash (needs network) |
| S15 | `GET /api/workers/:id/qrcode` and the legacy `POST /api/mobile/workers` return/accept the full worker row and have older, looser validation | Low | Unchanged (backward compatible); only reachable by an authenticated admin or with the mobile PIN |
| S16 | No Content-Security-Policy | Low | Not added: every page uses inline scripts, a strict CSP would break them. Requires moving scripts to files first |
