# USER GUIDE — AL SABIHA Manpower Platform

Sign in at `/login.html`. The left menu is the same on every page. On a phone, tap ☰ to open it.

## Menu map
| Group | Page | Use it to |
|---|---|---|
| Main Menu | **Dashboard** | See totals and charts (analytics only). Filters: date, company, site, status. The “i” on a card explains how it is calculated. |
| | **Worker Database** | Find, filter, open, edit, export workers |
| | **Add Worker** | Create one worker |
| | **Companies & Suppliers** | Company master data and categories |
| | **Quick Actions** | Shortcuts to other pages |
| Attendance | **Scan QR Attendance** | Check in / out by QR or Worker Code |
| | **Manual Attendance** | Enter attendance by hand |
| | **Attendance Records** | Search/export/delete attendance (original reports page) |
| | **Recent Attendance** | Latest attendance list with filters and paging |
| Analytics & Reports | **Attendance Analytics** | Daily/monthly trends |
| | **Company-wise Workforce** | Headcount per company, split Group/Supplier |
| | **Monthly Reports** | Days present and hours per worker |
| | **Import & Export** | Excel import, history, export shortcuts |
| Administration | **Sites & Locations**, **Settings** | Sites; change password, download DB backup |

## Find a worker
Two separate boxes: **Employee Name** and **Employee ID**. Type any part; case and extra spaces don't matter; several words must all match. Use **×** to clear a box. Matches are highlighted in yellow. Use the column headers to sort, the filters for status/type/company, and **Export Excel** to download exactly what you see. After opening a worker, **Back to Worker Database** restores your search.

## Add a worker
Required: Employee ID and Name. The ID is saved in capitals and **cannot be changed later** (it is on the QR code). **Visa/Sponsor Company** (who holds the visa) and **Working/Assigned Company** (where they work now) are different fields. Duplicate IDs are refused with a link to the existing worker.

## Move a worker to another company
Open the worker → **Reassign working company** → choose company → Reassign. Past attendance keeps the company it was recorded with; the **Assignment history** table shows who changed what and when.

## Companies & suppliers
Categories: **AL SABIHA Group**, **External Supplier**, **Client / Project** — a company can have several. Companies marked **Needs review** were not classified automatically: edit them and tick the right categories. A company with active workers cannot be deactivated until they are reassigned.

## Import workers from Excel
1. **Import & Export → Download Excel template** (also in `templates/`). Fill the **Workers** sheet (row 1 = headers). Required: Employee ID, Employee Name. Company names must match the **Valid Companies** sheet.
2. **Upload & preview.** Nothing is saved yet. Read the counts, the rules and the problem list; download the error report if needed.
3. Choose a mode: **Add new only** (existing IDs are skipped) or **Add new and update existing** (only non-empty cells that differ are changed; blank cells never erase data).
4. **Import** → confirm. A summary and a history entry are created. Workers missing from your file are never deleted. Rows with errors are skipped, valid rows are imported together (all or nothing if a technical failure happens).
Limits: .xlsx / .csv, 10 MB, 5,000 rows. Unknown company names are reported — add the company first. Only upload files you trust.

## Reading the dashboard
- **Total / Active / Inactive**: unique worker records.
- **Group Company / Supplier Workers**: active workers by *Company Type*.
- **Today's Present**: unique workers with a check-in on the selected date. The % is *present ÷ active workers*.
- **Currently Checked-In**: open check-ins (they auto-close 12 hours after check-in).
- **Today's Absent = N/A** on purpose: the system has no expected-attendance roster, so absence can't be calculated honestly.

## Attendance rules (unchanged)
One open check-in per worker. Auto check-out exactly 12 hours after check-in; checking out earlier by hand is fine. Times are UAE time (UTC+4).

## Backups & safety
Settings → *Download Database Backup*. The upgrade also writes an automatic backup into `DATA/backups/` the first time it migrates. To undo the upgrade: stop the server and run `node scripts/rollback-migration.js <backup-file>`.
