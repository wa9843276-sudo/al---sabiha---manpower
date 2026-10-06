AL SABIHA MANPOWER MANAGEMENT & ATTENDANCE SYSTEM
=====================================================

This package is the modified production-ready source for the existing Railway deployment.

STACK
-----
Node.js 22+
Express
SQLite / better-sqlite3
Express Session
QRCode
SheetJS (XLSX)

RUN LOCALLY
-----------
1. Install Node.js 22+.
2. Open this project folder in VS Code.
3. Run:
   npm install
4. Create .env from .env.example.
5. Run:
   npm start
6. Open:
   http://localhost:3000

DEFAULT ADMIN
-------------
The existing admin account is preserved by the application if it already exists.
If a fresh database is created, the legacy bootstrap account is:
username: admin
password: admin123

For a real deployment, change the password immediately from System Settings.

IMPORTANT DATABASE
------------------
Existing worker, company, site and attendance records are preserved.
The obsolete worker_pin column is removed automatically on startup when present.
Worker PIN is no longer used by the UI, API, attendance flow or Worker App.

WORKER MOBILE NUMBER
--------------------
The worker mobile number is stored in workers.mobile.
Admin can add/edit it from Workers.
A logged-in Worker App user can update only their own mobile number.

RAILWAY
-------
Start command:
npm start

Recommended Railway variables:
SESSION_SECRET=<long-random-secret>
MOBILE_APP_PIN=<private mobile admin app PIN, only if /mobile.html is used>
DATA_DIR=<persistent Railway Volume path, if using SQLite persistence>

IMPORTANT: SQLite data on Railway should be placed on a Railway Volume if the database
must survive redeploys/restarts. Do not expose the .env file publicly.

HEALTH CHECK
------------
GET /api/health

MAIN PAGES
----------
/                 Home
/login.html       Admin Login
/dashboard.html   Analytics Dashboard
/workers.html     Worker Database
/companies.html   Companies
/sites.html       Sites / Locations
/scan.html        QR Attendance
/manual-attendance.html
/reports.html
/settings.html
/worker-app.html  Worker mobile-friendly app
/mobile.html      Mobile attendance interface

QUALITY NOTES
-------------
- Sticky headers for major tables.
- Responsive desktop/tablet/mobile layouts.
- Apple-inspired glass/premium UI system.
- Premium dimensional sidebar icons.
- Dashboard analytics and recent attendance.
- Worker search by name/code.
- QR generation/scanning and manual attendance preserved.
- Reports support worker and attendance-status filters.
- Existing records are not intentionally deleted.
