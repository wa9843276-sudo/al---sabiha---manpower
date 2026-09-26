const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);

const DATA_DIR =
  process.env.DATA_DIR ||
  path.join(__dirname, "data");

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(
  path.join(DATA_DIR, "attendance.db")
);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");


/* =========================================================
   DATABASE
   ========================================================= */

db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS workers(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 worker_code TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 employee_type TEXT DEFAULT 'Company',
 vendor TEXT,
 mobile TEXT,
 designation TEXT,
 salary REAL DEFAULT 0,
 status TEXT DEFAULT 'Active',
 joining_date TEXT,
 company_id INTEGER REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS companies(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT UNIQUE NOT NULL,
 contact_person TEXT,
 contact_number TEXT,
 status TEXT DEFAULT 'Active'
);

CREATE TABLE IF NOT EXISTS sites(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 location TEXT,
 company_id INTEGER,
 contact_person TEXT,
 contact_number TEXT,
 status TEXT DEFAULT 'Active',
 FOREIGN KEY(company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS attendance(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 worker_id INTEGER NOT NULL,
 company_id INTEGER,
 site_id INTEGER NOT NULL,
 attendance_date TEXT NOT NULL,
 check_in TEXT,
 check_out TEXT,
 latitude REAL,
 longitude REAL,
 is_manual INTEGER DEFAULT 0,
 remarks TEXT,
 created_by INTEGER,
 FOREIGN KEY(worker_id) REFERENCES workers(id),
 FOREIGN KEY(company_id) REFERENCES companies(id),
 FOREIGN KEY(site_id) REFERENCES sites(id)
);

CREATE INDEX IF NOT EXISTS idx_att_date
ON attendance(attendance_date);
`);


/* =========================================================
   SAFE DATABASE MIGRATION
   ========================================================= */

const workerCols = db
  .prepare("PRAGMA table_info(workers)")
  .all()
  .map(c => c.name);

if (!workerCols.includes("company_id")) {
  db.exec(
    "ALTER TABLE workers ADD COLUMN company_id INTEGER REFERENCES companies(id)"
  );
}


/* =========================================================
   DEFAULT ADMIN
   ========================================================= */

if (
  !db
    .prepare("SELECT id FROM users WHERE username=?")
    .get("admin")
) {
  db.prepare(`
    INSERT INTO users(
      username,
      password_hash,
      role
    )
    VALUES(?,?,?)
  `).run(
    "admin",
    bcrypt.hashSync("admin123", 10),
    "admin"
  );
}


/* =========================================================
   EXPRESS
   ========================================================= */

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.set("trust proxy", 1);

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      crypto.randomBytes(32).toString("hex"),

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure:
        process.env.NODE_ENV === "production",
      maxAge: 12 * 60 * 60 * 1000
    }
  })
);


/* =========================================================
   HELPERS
   ========================================================= */

const clean = v =>
  v === undefined || v === null
    ? null
    : String(v).trim();


/* =========================================================
   UAE / DUBAI TIMEZONE
   ========================================================= */

const UAE_TIMEZONE = "Asia/Dubai";

function uaeDateTime(date = new Date()) {

  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: UAE_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }
  ).formatToParts(date);

  const get = type =>
    parts.find(p => p.type === type)?.value || "";

  return {
    date:
      `${get("year")}-${get("month")}-${get("day")}`,

    time:
      `${get("year")}-${get("month")}-${get("day")} ` +
      `${get("hour")}:${get("minute")}:${get("second")}`
  };
}

const today = () =>
  uaeDateTime().date;

const now = () =>
  uaeDateTime().time;


/* =========================================================
   AUTH MIDDLEWARE
   ========================================================= */

function login(req, res, next) {

  if (req.session.user) {
    return next();
  }

  return res.status(401).json({
    error: "Please login first."
  });
}

function admin(req, res, next) {
  return login(req, res, next);
}


/* =========================================================
   AUTO CHECKOUT AFTER 12 HOURS
   ========================================================= */

function autoCheckoutExpired() {

  const cutoff =
    uaeDateTime(
      new Date(
        Date.now() -
        12 * 60 * 60 * 1000
      )
    ).time;

  db.prepare(`
    UPDATE attendance

    SET
      check_out = datetime(
        check_in,
        '+12 hours'
      ),

      remarks =
        CASE
          WHEN remarks IS NULL
            OR remarks=''
          THEN
            'Automatic checkout after 12 hours'

          ELSE
            remarks ||
            ' | Automatic checkout after 12 hours'
        END

    WHERE check_in IS NOT NULL
      AND check_out IS NULL
      AND check_in <= ?
  `).run(cutoff);
}

setInterval(() => {

  try {

    autoCheckoutExpired();

  } catch (e) {

    console.error(
      "Auto-checkout error:",
      e.message
    );

  }

}, 60 * 1000).unref();


/* =========================================================
   AUTH API
   ========================================================= */

app.post(
  "/api/auth/login",
  (req, res) => {

    const u =
      clean(req.body.username);

    const p =
      clean(req.body.password);

    const user =
      db.prepare(`
        SELECT
          id,
          username,
          password_hash,
          role
        FROM users
        WHERE username=?
      `).get(u);

    if (
      !user ||
      !bcrypt.compareSync(
        p || "",
        user.password_hash
      )
    ) {

      return res.status(401).json({
        error:
          "Invalid username or password."
      });

    }

    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role
    };

    res.json({
      success: true,
      user: req.session.user
    });

  }
);


app.post(
  "/api/auth/logout",
  (req, res) =>
    req.session.destroy(
      () => res.json({ success: true })
    )
);


app.get(
  "/api/auth/me",
  login,
  (req, res) =>
    res.json({
      user: req.session.user
    })
);


/* =========================================================
   PASSWORD
   ========================================================= */

app.post(
  "/api/settings/password",
  admin,
  (req, res) => {

    const old =
      clean(req.body.current_password);

    const np =
      clean(req.body.new_password);

    const u =
      db.prepare(`
        SELECT password_hash
        FROM users
        WHERE id=?
      `).get(req.session.user.id);

    if (
      !u ||
      !bcrypt.compareSync(
        old || "",
        u.password_hash
      )
    ) {

      return res.status(400).json({
        error:
          "Current password is incorrect."
      });

    }

    if (!np || np.length < 6) {

      return res.status(400).json({
        error:
          "New password must be at least 6 characters."
      });

    }

    db.prepare(`
      UPDATE users
      SET password_hash=?
      WHERE id=?
    `).run(
      bcrypt.hashSync(np, 10),
      req.session.user.id
    );

    res.json({
      success: true
    });

  }
);


/* =========================================================
   DASHBOARD API
   ========================================================= */

app.get(
  "/api/dashboard",
  login,
  (req, res) => {

    autoCheckoutExpired();

    const d = today();

    const total_workers =
      db.prepare(`
        SELECT COUNT(*) c
        FROM workers
        WHERE status='Active'
      `).get().c;

    const total_companies =
      db.prepare(`
        SELECT COUNT(*) c
        FROM companies
        WHERE status='Active'
      `).get().c;

    const total_sites =
      db.prepare(`
        SELECT COUNT(*) c
        FROM sites
        WHERE status='Active'
      `).get().c;

    const present =
      db.prepare(`
        SELECT COUNT(DISTINCT worker_id) c
        FROM attendance
        WHERE attendance_date=?
          AND check_in IS NOT NULL
      `).get(d).c;

    const open =
      db.prepare(`
        SELECT COUNT(*) c
        FROM attendance
        WHERE attendance_date=?
          AND check_in IS NOT NULL
          AND check_out IS NULL
      `).get(d).c;

    const company_summary =
      db.prepare(`
        SELECT
          c.id company_id,
          c.name company_name,

          COUNT(
            DISTINCT w.id
          ) total_workers,

          COUNT(
            DISTINCT CASE
              WHEN a.check_in IS NOT NULL
              THEN a.worker_id
            END
          ) present,

          COUNT(
            DISTINCT CASE
              WHEN a.check_in IS NULL
              THEN w.id
            END
          ) absent

        FROM companies c

        LEFT JOIN workers w
          ON w.company_id=c.id
         AND w.status='Active'

        LEFT JOIN attendance a
          ON a.company_id=c.id
         AND a.attendance_date=?

        GROUP BY
          c.id,
          c.name

        ORDER BY c.name
      `).all(d);

    const rows =
      db.prepare(`
        SELECT
          a.*,
          w.name worker_name,
          w.worker_code,
          c.name company_name,
          s.name site_name

        FROM attendance a

        JOIN workers w
          ON w.id=a.worker_id

        LEFT JOIN companies c
          ON c.id=a.company_id

        LEFT JOIN sites s
          ON s.id=a.site_id

        WHERE
          a.attendance_date=?

        ORDER BY a.id DESC

        LIMIT 20
      `).all(d);

    res.json({
      total_workers,
      total_companies,
      total_sites,
      present_today: present,
      absent_today:
        Math.max(
          0,
          total_workers - present
        ),
      checked_in: open,
      todays_attendance: rows,
      company_summary,
      date: d
    });

  }
);


/* =========================================================
   WORKERS API
   ========================================================= */

/* GET WORKERS */

app.get(
  "/api/workers",
  login,
  (req, res) => {

    const q =
      clean(req.query.search);

    const baseSql = `
      SELECT
        w.*,
        c.name AS company_name

      FROM workers w

      LEFT JOIN companies c
        ON c.id=w.company_id
    `;

    if (q) {

      const sql =
        baseSql +
        `
        WHERE
          w.worker_code LIKE ?
          OR w.name LIKE ?
          OR w.designation LIKE ?
          OR w.vendor LIKE ?
          OR w.mobile LIKE ?
          OR c.name LIKE ?

        ORDER BY w.name
        `;

      const params = [
        `%${q}%`,
        `%${q}%`,
        `%${q}%`,
        `%${q}%`,
        `%${q}%`,
        `%${q}%`
      ];

      return res.json(
        db.prepare(sql).all(...params)
      );

    }

    const sql =
      baseSql +
      `
      ORDER BY w.name
      `;

    res.json(
      db.prepare(sql).all()
    );

  }
);


/* =========================================================
   ADD WORKER
   ========================================================= */

app.post(
  "/api/workers",
  admin,
  (req, res) => {

    try {

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : null;

      if (
        companyId &&
        !db.prepare(`
          SELECT id
          FROM companies
          WHERE id=?
            AND status='Active'
        `).get(companyId)
      ) {

        return res.status(400).json({
          error:
            "Selected company is not active."
        });

      }

      const r =
        db.prepare(`
          INSERT INTO workers(
            worker_code,
            name,
            employee_type,
            vendor,
            mobile,
            designation,
            salary,
            status,
            joining_date,
            company_id
          )

          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            'Active',
            ?,
            ?
          )
        `).run(

          clean(req.body.worker_code),

          clean(req.body.name),

          clean(req.body.employee_type)
            || "Company",

          clean(req.body.vendor),

          clean(req.body.mobile),

          clean(req.body.designation),

          Number(
            req.body.salary || 0
          ),

          clean(
            req.body.joining_date
          ),

          companyId
        );

      res.json({
        success: true,
        id: r.lastInsertRowid
      });

    } catch (e) {

      res.status(400).json({

        error:
          e.message.includes("UNIQUE")
            ? "Worker code already exists."
            : e.message

      });

    }

  }
);


/* =========================================================
   UPDATE WORKER
   ========================================================= */

app.put(
  "/api/workers/:id",
  admin,
  (req, res) => {

    try {

      const workerId =
        Number(req.params.id);

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : null;

      const worker =
        db.prepare(`
          SELECT id
          FROM workers
          WHERE id=?
        `).get(workerId);

      if (!worker) {

        return res.status(404).json({
          error:
            "Worker not found."
        });

      }

      if (
        companyId &&
        !db.prepare(`
          SELECT id
          FROM companies
          WHERE id=?
            AND status='Active'
        `).get(companyId)
      ) {

        return res.status(400).json({
          error:
            "Selected company is not active."
        });

      }

      db.prepare(`
        UPDATE workers SET

          worker_code=?,
          name=?,
          employee_type=?,
          vendor=?,
          mobile=?,
          designation=?,
          salary=?,
          status=?,
          joining_date=?,
          company_id=?

        WHERE id=?
      `).run(

        clean(req.body.worker_code),

        clean(req.body.name),

        clean(req.body.employee_type)
          || "Company",

        clean(req.body.vendor),

        clean(req.body.mobile),

        clean(req.body.designation),

        Number(
          req.body.salary || 0
        ),

        clean(req.body.status)
          || "Active",

        clean(req.body.joining_date),

        companyId,

        workerId
      );

      res.json({
        success: true
      });

    } catch (e) {

      res.status(400).json({
        error: e.message
      });

    }

  }
);


/* =========================================================
   TRANSFER WORKER
   ========================================================= */

app.post(
  "/api/workers/:id/transfer",
  admin,
  (req, res) => {

    try {

      const workerId =
        Number(req.params.id);

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : null;

      const worker =
        db.prepare(`
          SELECT id
          FROM workers
          WHERE id=?
        `).get(workerId);

      if (!worker) {

        return res.status(404).json({
          error:
            "Worker not found."
        });

      }

      if (
        companyId &&
        !db.prepare(`
          SELECT id
          FROM companies
          WHERE id=?
            AND status='Active'
        `).get(companyId)
      ) {

        return res.status(400).json({
          error:
            "Active company not found."
        });

      }

      db.prepare(`
        UPDATE workers
        SET company_id=?
        WHERE id=?
      `).run(
        companyId,
        workerId
      );

      res.json({
        success: true
      });

    } catch (e) {

      console.error(
        "Worker transfer error:",
        e
      );

      res.status(500).json({
        error:
          "Worker transfer failed."
      });

    }

  }
);


/* =========================================================
   DISABLE WORKER
   ========================================================= */

app.delete(
  "/api/workers/:id",
  admin,
  (req, res) => {

    try {

      const workerId =
        Number(req.params.id);

      const worker =
        db.prepare(`
          SELECT id
          FROM workers
          WHERE id=?
        `).get(workerId);

      if (!worker) {

        return res.status(404).json({
          error:
            "Worker not found."
        });

      }

      db.prepare(`
        UPDATE workers
        SET status='Inactive'
        WHERE id=?
      `).run(workerId);

      res.json({
        success: true
      });

    } catch (e) {

      console.error(
        "Disable worker error:",
        e
      );

      res.status(500).json({
        error:
          "Unable to disable worker."
      });

    }

  }
);


/* =========================================================
   DELETE TEST WORKER + ALL TEST ATTENDANCE
   ========================================================= */

app.delete(
  "/api/workers/:id/test-delete",
  admin,
  (req, res) => {

    try {

      const workerId =
        Number(req.params.id);

      if (!workerId) {

        return res.status(400).json({
          error:
            "Invalid worker ID."
        });

      }

      const worker =
        db.prepare(`
          SELECT
            id,
            name,
            worker_code
          FROM workers
          WHERE id=?
        `).get(workerId);

      if (!worker) {

        return res.status(404).json({
          error:
            "Worker not found."
        });

      }


      /*
       * IMPORTANT:
       * Delete attendance first because
       * attendance.worker_id has a foreign key
       * pointing to workers.id.
       */

      const transaction =
        db.transaction(() => {

          db.prepare(`
            DELETE FROM attendance
            WHERE worker_id=?
          `).run(workerId);


          db.prepare(`
            DELETE FROM workers
            WHERE id=?
          `).run(workerId);

        });


      transaction();


      res.json({

        success: true,

        message:
          "Test worker and attendance records deleted successfully."

      });

    } catch (error) {

      console.error(
        "Test worker delete error:",
        error
      );

      res.status(500).json({

        error:
          "Unable to delete test worker."

      });

    }

  }
);

/* =========================================================
   WORKER QR CODE
   ========================================================= */

app.get(
  "/api/workers/:id/qrcode",
  login,
  async (req, res) => {

    try {

      const w =
        db.prepare(`
          SELECT *
          FROM workers
          WHERE id=?
        `).get(
          Number(req.params.id)
        );

      if (!w) {

        return res.status(404).send(
          "Worker not found"
        );

      }

      const data =
        await QRCode.toDataURL(
          w.worker_code,
          {
            width: 420,
            margin: 2
          }
        );

      res.json({
        worker: w,
        qr: data
      });

    } catch (e) {

      console.error(
        "QR generation error:",
        e
      );

      res.status(500).json({
        error:
          "Unable to generate QR code."
      });

    }

  }
);


/* =========================================================
   COMPANIES API
   ========================================================= */

app.get(
  "/api/companies",
  login,
  (req, res) => {

    res.json(
      db.prepare(`
        SELECT
          c.*,

          (
            SELECT COUNT(*)
            FROM sites s
            WHERE s.company_id=c.id
          ) site_count

        FROM companies c

        ORDER BY c.name
      `).all()
    );

  }
);


app.post(
  "/api/companies",
  admin,
  (req, res) => {

    try {

      const r =
        db.prepare(`
          INSERT INTO companies(
            name,
            contact_person,
            contact_number,
            status
          )

          VALUES(
            ?,
            ?,
            ?,
            'Active'
          )
        `).run(
          clean(req.body.name),
          clean(req.body.contact_person),
          clean(req.body.contact_number)
        );

      res.json({
        success: true,
        id: r.lastInsertRowid
      });

    } catch (e) {

      res.status(400).json({
        error:
          e.message.includes("UNIQUE")
            ? "Company already exists."
            : e.message
      });

    }

  }
);


app.put(
  "/api/companies/:id",
  admin,
  (req, res) => {

    try {

      db.prepare(`
        UPDATE companies
        SET
          name=?,
          contact_person=?,
          contact_number=?,
          status=?
        WHERE id=?
      `).run(
        clean(req.body.name),
        clean(req.body.contact_person),
        clean(req.body.contact_number),
        clean(req.body.status)
          || "Active",
        Number(req.params.id)
      );

      res.json({
        success: true
      });

    } catch (e) {

      res.status(400).json({
        error: e.message
      });

    }

  }
);


/* =========================================================
   ARCHIVE WORKER
   Worker record + attendance history محفوظ رہے گی
   ========================================================= */

app.delete("/api/workers/:id", admin, (req, res) => {

  try {

    const workerId = Number(req.params.id);

    if (!workerId) {
      return res.status(400).json({
        error: "Invalid worker ID."
      });
    }

    const worker = db.prepare(`
      SELECT id, name, worker_code
      FROM workers
      WHERE id=?
    `).get(workerId);

    if (!worker) {
      return res.status(404).json({
        error: "Worker not found."
      });
    }

    // Worker ko sirf Inactive/Archived karega.
    // Attendance aur worker ka record delete nahi hoga.
    db.prepare(`
      UPDATE workers
      SET status='Inactive'
      WHERE id=?
    `).run(workerId);

    res.json({
      success: true,
      message: "Worker archived successfully.",
      worker: {
        id: worker.id,
        name: worker.name,
        worker_code: worker.worker_code
      }
    });

  } catch (error) {

    console.error("Archive worker error:", error);

    res.status(500).json({
      error: "Unable to archive worker."
    });

  }

});

    /* =========================================================
   ARCHIVE COMPANY
   ========================================================= */

app.delete("/api/companies/:id", admin, (req, res) => {

  try {

    const companyId = Number(req.params.id);

    if (!companyId) {
      return res.status(400).json({
        error: "Invalid company ID."
      });
    }

    const company = db.prepare(`
      SELECT id, name
      FROM companies
      WHERE id=?
    `).get(companyId);

    if (!company) {
      return res.status(404).json({
        error: "Company not found."
      });
    }

    db.prepare(`
      UPDATE companies
      SET status='Inactive'
      WHERE id=?
    `).run(companyId);

    res.json({
      success: true,
      message: "Company archived successfully.",
      company: {
        id: company.id,
        name: company.name
      }
    });

  } catch (error) {

    console.error("Archive company error:", error);

    res.status(500).json({
      error: "Unable to archive company."
    });

  }

});
/* =========================================================
   SITES / LOCATION API
   ========================================================= */

app.get(
  "/api/sites",
  login,
  (req, res) => {

    try {

      const rows =
        db.prepare(`
          SELECT
            s.id,
            s.name,
            s.location,
            s.company_id,
            s.contact_person,
            s.contact_number,
            s.status,
            c.name AS company_name

          FROM sites s

          LEFT JOIN companies c
            ON c.id=s.company_id

          ORDER BY s.name
        `).all();

      res.json(rows);

    } catch (e) {

      console.error(
        "Sites GET error:",
        e
      );

      res.status(500).json({
        error:
          "Unable to load sites."
      });

    }

  }
);


app.post(
  "/api/sites",
  admin,
  (req, res) => {

    try {

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : null;

      if (
        companyId &&
        !db.prepare(`
          SELECT id
          FROM companies
          WHERE id=?
            AND status='Active'
        `).get(companyId)
      ) {

        return res.status(400).json({
          error:
            "Selected company is not active."
        });

      }

      const name =
        clean(req.body.name);

      if (!name) {

        return res.status(400).json({
          error:
            "Site name is required."
        });

      }

      const r =
        db.prepare(`
          INSERT INTO sites(
            name,
            location,
            company_id,
            contact_person,
            contact_number,
            status
          )

          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            'Active'
          )
        `).run(
          name,
          clean(req.body.location),
          companyId,
          clean(req.body.contact_person),
          clean(req.body.contact_number)
        );

      res.json({
        success: true,
        id: r.lastInsertRowid
      });

    } catch (e) {

      console.error(
        "Sites POST error:",
        e
      );

      res.status(400).json({
        error: e.message
      });

    }

  }
);


app.put(
  "/api/sites/:id",
  admin,
  (req, res) => {

    try {

      const siteId =
        Number(req.params.id);

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : null;

      const site =
        db.prepare(`
          SELECT id
          FROM sites
          WHERE id=?
        `).get(siteId);

      if (!site) {

        return res.status(404).json({
          error:
            "Site not found."
        });

      }

      if (
        companyId &&
        !db.prepare(`
          SELECT id
          FROM companies
          WHERE id=?
            AND status='Active'
        `).get(companyId)
      ) {

        return res.status(400).json({
          error:
            "Selected company is not active."
        });

      }

      db.prepare(`
        UPDATE sites
        SET
          name=?,
          location=?,
          company_id=?,
          contact_person=?,
          contact_number=?,
          status=?

        WHERE id=?
      `).run(
        clean(req.body.name),
        clean(req.body.location),
        companyId,
        clean(req.body.contact_person),
        clean(req.body.contact_number),
        clean(req.body.status)
          || "Active",
        siteId
      );

      res.json({
        success: true
      });

    } catch (e) {

      console.error(
        "Sites PUT error:",
        e
      );

      res.status(400).json({
        error: e.message
      });

    }

  }
);


app.delete(
  "/api/sites/:id",
  admin,
  (req, res) => {

    try {

      db.prepare(`
        UPDATE sites
        SET status='Inactive'
        WHERE id=?
      `).run(
        Number(req.params.id)
      );

      res.json({
        success: true
      });

    } catch (e) {

      res.status(400).json({
        error: e.message
      });

    }

  }
);


/* =========================================================
   ATTENDANCE LOOKUP
   ========================================================= */

function attendanceLookup(req, res) {

  try {

    const workerCode =
      clean(
        req.method === "GET"
          ? req.query.worker_code
          : req.body.worker_code
      );

    if (!workerCode) {

      return res.status(400).json({
        error:
          "Worker code is required."
      });

    }

    const w =
      db.prepare(`
        SELECT *
        FROM workers

        WHERE worker_code=?
          AND status='Active'
      `).get(workerCode);

    if (!w) {

      return res.status(404).json({
        error:
          "Active worker not found."
      });

    }


    /* ASSIGNED COMPANY */

    const assigned_company =
      w.company_id
        ? db.prepare(`
            SELECT
              id,
              name

            FROM companies

            WHERE id=?
              AND status='Active'
          `).get(w.company_id)
        : null;


    /* ALL ACTIVE COMPANIES */

    const companies =
      db.prepare(`
        SELECT
          id,
          name

        FROM companies

        WHERE status='Active'

        ORDER BY name
      `).all();


    /* ALL ACTIVE SITES */

    const sites =
      db.prepare(`
        SELECT
          s.id,
          s.name,
          s.location,
          s.company_id,
          s.contact_person,
          s.contact_number,
          s.status,
          c.name AS company_name

        FROM sites s

        LEFT JOIN companies c
          ON c.id=s.company_id

        WHERE s.status='Active'

        ORDER BY s.name
      `).all();


    /* ASSIGNED COMPANY SITES */

    const assigned_company_sites =
      w.company_id
        ? db.prepare(`
            SELECT
              s.id,
              s.name,
              s.location,
              s.company_id,
              s.contact_person,
              s.contact_number,
              s.status,
              c.name AS company_name

            FROM sites s

            LEFT JOIN companies c
              ON c.id=s.company_id

            WHERE s.company_id=?
              AND s.status='Active'

            ORDER BY s.name
          `).all(w.company_id)
        : [];


    /* CURRENT OPEN ATTENDANCE */

    const open =
      db.prepare(`
        SELECT
          a.*,
          c.name AS company_name,
          s.name AS site_name,
          s.location AS site_location

        FROM attendance a

        LEFT JOIN companies c
          ON c.id=a.company_id

        LEFT JOIN sites s
          ON s.id=a.site_id

        WHERE a.worker_id=?
          AND a.check_in IS NOT NULL
          AND a.check_out IS NULL

        ORDER BY a.id DESC

        LIMIT 1
      `).get(w.id);


    res.json({

      success: true,

      worker: w,

      assigned_company:
        assigned_company,

      assigned_company_sites:
        assigned_company_sites,

      sites: sites,

      companies: companies,

      currently_checked_in:
        !!open,

      open_attendance:
        open || null

    });

  } catch (error) {

    console.error(
      "Attendance Lookup Error:",
      error
    );

    res.status(500).json({
      error:
        "Unable to load worker attendance information."
    });

  }

}


app.get(
  "/api/attendance/lookup",
  login,
  attendanceLookup
);

app.post(
  "/api/attendance/lookup",
  login,
  attendanceLookup
);


/* =========================================================
   QR CHECK-IN
   ========================================================= */

app.post(
  "/api/attendance/checkin",
  login,
  (req, res) => {

    try {

      const workerCode =
        clean(req.body.worker_code);

      if (!workerCode) {

        return res.status(400).json({
          error:
            "Worker code is required."
        });

      }

      const w =
        db.prepare(`
          SELECT *
          FROM workers

          WHERE worker_code=?
            AND status='Active'
        `).get(workerCode);

      if (!w) {

        return res.status(404).json({
          error:
            "Worker not found."
        });

      }

      const siteId =
        Number(req.body.site_id);

      if (!siteId) {

        return res.status(400).json({
          error:
            "Site is required."
        });

      }

      const site =
        db.prepare(`
          SELECT *
          FROM sites

          WHERE id=?
            AND status='Active'
        `).get(siteId);

      if (!site) {

        return res.status(400).json({
          error:
            "Active site is required."
        });

      }


      /* ONE OPEN ATTENDANCE PER WORKER */

      const open =
        db.prepare(`
          SELECT
            a.*,
            c.name AS company_name,
            s.name AS site_name

          FROM attendance a

          LEFT JOIN companies c
            ON c.id=a.company_id

          LEFT JOIN sites s
            ON s.id=a.site_id

          WHERE a.worker_id=?
            AND a.check_in IS NOT NULL
            AND a.check_out IS NULL

          ORDER BY a.id DESC

          LIMIT 1
        `).get(w.id);

      if (open) {

        return res.status(409).json({

          error:
            "Worker is already checked in. Check out first.",

          attendance_id:
            open.id,

          check_in:
            open.check_in,

          company_name:
            open.company_name || "",

          site_name:
            open.site_name || ""

        });

      }


      /* COMPANY SELECTED BY ATTENDANCE SCREEN */

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : (
              w.company_id ||
              site.company_id ||
              null
            );


      const r =
        db.prepare(`
          INSERT INTO attendance(
            worker_id,
            company_id,
            site_id,
            attendance_date,
            check_in,
            check_out,
            latitude,
            longitude,
            is_manual,
            created_by
          )

          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `).run(

          w.id,

          companyId,

          siteId,

          today(),

          now(),

          null,

          req.body.latitude ??
            null,

          req.body.longitude ??
            null,

          0,

          req.session.user.id
        );

      res.json({

        success: true,

        attendance_id:
          r.lastInsertRowid,

        time: now()

      });

    } catch (error) {

      console.error(
        "QR Check-In Error:",
        error
      );

      res.status(500).json({
        error:
          "Check-in failed."
      });

    }

  }
);


/* =========================================================
   CHECK-OUT
   ========================================================= */

app.post(
  "/api/attendance/checkout",
  login,
  (req, res) => {

    const w =
      db.prepare(`
        SELECT *
        FROM workers

        WHERE worker_code=?
          AND status='Active'
      `).get(
        clean(req.body.worker_code)
      );

    if (!w) {

      return res.status(404).json({
        error:
          "Worker not found."
      });

    }

    const a =
      db.prepare(`
        SELECT *
        FROM attendance

        WHERE worker_id=?
          AND check_in IS NOT NULL
          AND check_out IS NULL

        ORDER BY id DESC

        LIMIT 1
      `).get(w.id);

    if (!a) {

      return res.status(404).json({
        error:
          "No open check-in found."
      });

    }

    db.prepare(`
      UPDATE attendance
      SET check_out=?
      WHERE id=?
    `).run(
      now(),
      a.id
    );

    res.json({
      success: true,
      time: now()
    });

  }
);


/* =========================================================
   MANUAL ATTENDANCE
   ========================================================= */

app.post(
  "/api/attendance/manual",
  admin,
  (req, res) => {

    try {

      const workerId =
        Number(req.body.worker_id);

      if (!workerId) {

        return res.status(400).json({
          error:
            "Worker is required."
        });

      }

      const worker =
        db.prepare(`
          SELECT id
          FROM workers

          WHERE id=?
            AND status='Active'
        `).get(workerId);

      if (!worker) {

        return res.status(404).json({
          error:
            "Active worker not found."
        });

      }

      const companyId =
        req.body.company_id
          ? Number(req.body.company_id)
          : null;

      const siteId =
        Number(req.body.site_id);

      if (!siteId) {

        return res.status(400).json({
          error:
            "Site is required."
        });

      }

      const site =
        db.prepare(`
          SELECT *
          FROM sites

          WHERE id=?
            AND status='Active'
        `).get(siteId);

      if (!site) {

        return res.status(400).json({
          error:
            "Active site is required."
        });

      }

      const checkIn =
        clean(req.body.check_in)
          || now();

      const checkOut =
        clean(req.body.check_out)
          || null;


      /* PREVENT DUPLICATE OPEN ATTENDANCE */

      if (!checkOut) {

        const openAttendance =
          db.prepare(`
            SELECT
              id,
              check_in,
              company_id,
              site_id

            FROM attendance

            WHERE worker_id=?
              AND check_in IS NOT NULL
              AND check_out IS NULL

            ORDER BY id DESC

            LIMIT 1
          `).get(workerId);

        if (openAttendance) {

          return res.status(409).json({

            error:
              "Worker is already checked in. Check out first.",

            attendance_id:
              openAttendance.id,

            check_in:
              openAttendance.check_in

          });

        }

      }


      const r =
        db.prepare(`
          INSERT INTO attendance(
            worker_id,
            company_id,
            site_id,
            attendance_date,
            check_in,
            check_out,
            latitude,
            longitude,
            is_manual,
            remarks,
            created_by
          )

          VALUES(
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            1,
            ?,
            ?
          )
        `).run(

          workerId,

          companyId,

          siteId,

          clean(
            req.body.attendance_date
          ) || today(),

          checkIn,

          checkOut,

          req.body.latitude ??
            null,

          req.body.longitude ??
            null,

          clean(req.body.remarks),

          req.session.user.id

        );

      res.json({
        success: true,
        attendance_id:
          r.lastInsertRowid
      });

    } catch (error) {

      console.error(
        "Manual Attendance Error:",
        error
      );

      res.status(500).json({
        error:
          "Manual attendance failed."
      });

    }

  }
);


/* =========================================================
   REPORTS
   ========================================================= */

app.get(
  "/api/reports",
  login,
  (req, res) => {

    let sql = `
      SELECT
        a.*,
        w.worker_code,
        w.name worker_name,
        w.employee_type,
        w.vendor,
        c.name company_name,
        s.name site_name

      FROM attendance a

      JOIN workers w
        ON w.id=a.worker_id

      LEFT JOIN companies c
        ON c.id=a.company_id

      LEFT JOIN sites s
        ON s.id=a.site_id

      WHERE 1=1
    `;

    const p = [];

    if (req.query.date_from) {

      sql +=
        " AND a.attendance_date>=?";

      p.push(
        req.query.date_from
      );

    }

    if (req.query.date_to) {

      sql +=
        " AND a.attendance_date<=?";

      p.push(
        req.query.date_to
      );

    }

    if (req.query.company_id) {

      sql +=
        " AND a.company_id=?";

      p.push(
        Number(req.query.company_id)
      );

    }

    if (req.query.site_id) {

      sql +=
        " AND a.site_id=?";

      p.push(
        Number(req.query.site_id)
      );

    }

    sql +=
      " ORDER BY a.attendance_date DESC,a.id DESC";

    res.json(
      db.prepare(sql).all(...p)
    );

  }
);


/* =========================================================
   EXCEL EXPORT
   ========================================================= */

app.get(
  "/api/reports/export.xlsx",
  login,
  (req, res) => {

    try {

      let sql = `
        SELECT
          a.attendance_date AS "Attendance Date",
          w.worker_code AS "Worker Code",
          w.name AS "Worker Name",
          w.employee_type AS "Employee Type",
          w.vendor AS "Supplier",
          c.name AS "Company",
          s.name AS "Site / Location",
          a.check_in AS "Check In",
          a.check_out AS "Check Out",

          CASE
            WHEN a.is_manual=1
            THEN 'MANUAL'
            ELSE 'QR'
          END AS "Attendance Type",

          a.remarks AS "Remarks"

        FROM attendance a

        JOIN workers w
          ON w.id=a.worker_id

        LEFT JOIN companies c
          ON c.id=a.company_id

        LEFT JOIN sites s
          ON s.id=a.site_id

        WHERE 1=1
      `;

      const params = [];

      if (req.query.date_from) {

        sql +=
          " AND a.attendance_date>=?";

        params.push(
          req.query.date_from
        );

      }

      if (req.query.date_to) {

        sql +=
          " AND a.attendance_date<=?";

        params.push(
          req.query.date_to
        );

      }

      if (req.query.company_id) {

        sql +=
          " AND a.company_id=?";

        params.push(
          Number(req.query.company_id)
        );

      }

      if (req.query.site_id) {

        sql +=
          " AND a.site_id=?";

        params.push(
          Number(req.query.site_id)
        );

      }

      sql +=
        " ORDER BY a.attendance_date DESC,a.id DESC";

      const rows =
        db.prepare(sql).all(...params);

      const worksheet =
        XLSX.utils.json_to_sheet(rows);

      worksheet["!cols"] = [
        { wch: 16 },
        { wch: 16 },
        { wch: 25 },
        { wch: 18 },
        { wch: 22 },
        { wch: 25 },
        { wch: 25 },
        { wch: 22 },
        { wch: 22 },
        { wch: 18 },
        { wch: 35 }
      ];

      const workbook =
        XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Attendance"
      );

      const buffer =
        XLSX.write(
          workbook,
          {
            type: "buffer",
            bookType: "xlsx"
          }
        );

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="AL-SABIHA-Attendance-Report.xlsx"'
      );

      res.send(buffer);

    } catch (error) {

      console.error(
        "Excel Export Error:",
        error
      );

      res.status(500).json({
        error:
          "Excel export failed."
      });

    }

  }
);


/* =========================================================
   DATABASE BACKUP
   ========================================================= */

app.get(
  "/api/backup/download",
  admin,
  (req, res) =>
    res.download(
      path.join(
        DATA_DIR,
        "attendance.db"
      ),
      "al-sabiha-attendance-backup.db"
    )
);


/* =========================================================
   STATIC FILES
   ========================================================= */

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);


app.get(
  "/",
  (req, res) =>
    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    )
);


/* =========================================================
   404
   ========================================================= */

app.use(
  (req, res) =>
    req.path.startsWith("/api/")
      ? res.status(404).json({
          error:
            "API endpoint not found."
        })
      : res.status(404).send(
          "Page not found."
        )
);


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () =>
    console.log(
      `AL SABIHA ONLINE running on port ${PORT}`
    )
);