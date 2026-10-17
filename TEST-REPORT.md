# TEST REPORT

**Environment:** Node v22.22.2 on Linux; `better-sqlite3` compiled for Linux in a separate test runtime (the project's own `node_modules` holds a Windows binary and was not modified). Headless Chromium via Playwright 1.56. All tests use **throw-away databases with synthetic data**. The supplied production-like DB was only ever used as a **copy** (migration/rollback check).
**Run again:** `npm test` (API/security/import/export, needs only project deps) · `NODE_PATH=$(npm root -g) node tests/browser.check.js` (UI; needs Playwright).

## Result: 24/24 API tests ✅ · 58/58 browser checks ✅

### A. API / security / data (tests/api.test.js)
| Requirement | Test | Result |
|---|---|---|
| Existing login works; bad login rejected; v2 needs login | health + login | ✅ |
| Brute-force protection | 12 bad logins → 429 | ✅ |
| CSRF | cross-origin POST → 403 | ✅ |
| Security headers | nosniff, no X-Powered-By | ✅ |
| Migration non-destructive | synthetic legacy DB: attendance + worker rows byte-identical before/after, backup written, idempotent, sponsor backfill exact-match only | ✅ |
| Migration on supplied data | **copy** of supplied DB: 9 workers / 22 attendance / 5 companies unchanged, backup created, 8 companies added | ✅ (manual run) |
| Rollback | restore from backup on a copy: new tables gone, original counts intact | ✅ (manual run) |
| Worker create/edit | normalization (` t001 `→`T001`), case-insensitive duplicate 409, bad ID / missing name / unknown company / bad type / unknown sponsor 400, partial PATCH leaves other fields, Employee ID immutable | ✅ |
| Sponsor ≠ Working company | stored separately | ✅ |
| Name / ID search | token + case + whitespace, combined, `%` treated literally, pagination, type filter | ✅ |
| Company counts match unique workers | totals = COUNT(workers) | ✅ |
| Reassignment | counts move; **historical attendance rows unchanged**; history recorded; no-op detected | ✅ |
| QR check-in/out | works; duplicate check-in 409; checkout without open 404; lookup shows *current* assignment | ✅ |
| Manual attendance | invalid date 400; checkout < checkin 400; `datetime-local` accepted; company defaults to worker's current company | ✅ |
| Auto-checkout (12 h) | 13 h-old open record closed at exactly check-in + 12 h with remark; <12 h stays open; early manual checkout valid | ✅ |
| Dashboard accuracy | every KPI equals an independent SQL query; charts sum to unique active workers; absent = null; company filter | ✅ |
| Legacy dashboard | no longer reports everyone as absent; legacy shape kept | ✅ |
| Template | downloads, sheets/headers correct | ✅ |
| Import preview | counts: new / update / unchanged / invalid / duplicates-in-file / missing required / unresolved company / formula-like / bad phone; **nothing written before commit**; change list correct | ✅ |
| Import add-only | creates new, leaves existing untouched, token single-use, history row, error report downloads | ✅ |
| Import update mode | only non-empty differing cells change; blank never erases; company change logged; nobody deleted | ✅ |
| Bad files | .txt, fake .xlsx, empty, missing columns, unauthenticated → rejected; .csv accepted | ✅ |
| Export | filtered rows only; formula `=HYPERLINK(...)` neutralized; no salary/mobile; attendance dates are real Excel numbers; company/monthly exports; hours 08:00→17:30 = 9.5 | ✅ |
| Company master | duplicate (case/space) 409, invalid role 400, multi-role, unclassified filter, deactivation blocked with active workers | ✅ |
| Worker App | salary absent from login and /me | ✅ |
| Mobile PIN | query-string PIN rejected, header accepted, wrong rejected | ✅ |
| Permanent delete | needs `confirm_code`, audited | ✅ |
| Audit log | create / reassign / company / import events recorded | ✅ |

### B. Real browser (tests/browser.check.js) — Chromium, 1280 px and 390 px
- All 15 pages load with correct H1, correct active nav item, **no console/page errors, no horizontal overflow** (30 checks).
- All 15 nav links return 200; `/Logo.svg` resolves.
- Dashboard has no forms, no recent-attendance table, no quick actions; all 10 required KPI cards; Absent shows **N/A**.
- Worker Database: two search boxes; highlight on name matches (`rgb(255,216,77)` on `rgb(26,19,0)`); count text; ID search; combined filters; "No workers found"; **`<img onerror>` and `<b>` in imported names render as text, no script runs**; pagination; sortable headers with `aria-sort`.
- Filters survive *View profile → Back*; reassignment appears in history; Add Worker validation, success link, duplicate rejection with link.
- Import via UI: preview shows problems/unresolved companies, confirm dialog, summary, history lists the file.
- Scan page renders inside the shared layout with exactly one level-1 heading (a duplicate H1 was found and fixed during testing).
- Screenshots were reviewed manually (dashboard desktop, scan, workers mobile).

## Defects found and fixed during testing
1. Test-fixture miscounts (7 invalid rows, not 6; 1 history row, not 2) — tests corrected, no product change.
2. Duplicate `<h1>` on the legacy scan page (accessibility) — fixed in the shell.
3. Single-point monthly chart stretched very tall — height capped.
4. Page-generation script silently produced 5 empty pages (shell quirk) — caught by file-size check, regenerated, re-verified.

## NOT tested (be aware)
- Real camera / QR decoding, GPS, and the CDN-hosted scanner library (sandbox is offline, no camera).
- Android apps (not compiled, not installed on any device/emulator).
- Production host behaviour (HTTPS-only cookies, Railway restarts), concurrent multi-user load, imports near the 5,000-row limit, browsers other than Chromium (Safari/Firefox/Android WebView).
- `worker-app.html` and `mobile.html` UI flows (only their API behaviour: PIN header, no salary).
- Automated accessibility audit (axe/Lighthouse); only keyboard-focusable sort headers, labels, `aria` attributes, focus ring and contrast choices were implemented by design.
