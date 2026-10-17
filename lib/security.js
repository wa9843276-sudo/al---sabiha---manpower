"use strict";
const crypto = require("crypto");
const session = require("express-session");

/* Constant-time string comparison (length is hashed away first). */
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* In-memory fixed-window rate limiter (single-process deployment). */
function rateLimiter({ max = 10, windowMs = 15 * 60 * 1000, key } = {}) {
  const hits = new Map();
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
  }, 60 * 1000);
  timer.unref();
  return function limiter(req, res, next) {
    const k = (key ? key(req) : req.ip) || "anon";
    const t = Date.now();
    let e = hits.get(k);
    if (!e || e.reset <= t) { e = { n: 0, reset: t + windowMs }; hits.set(k, e); }
    e.n++;
    if (e.n > max) {
      res.setHeader("Retry-After", Math.ceil((e.reset - t) / 1000));
      return res.status(429).json({
        error: "Too many attempts. Please wait a few minutes and try again.",
        message: "Too many attempts. Please wait a few minutes and try again."
      });
    }
    next();
  };
}

/* CSRF defence for cookie sessions: unsafe requests carrying an Origin
   header must come from the same host. Non-browser clients send no Origin. */
function originCheck(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch (_) { /* fallthrough */ }
  return res.status(403).json({ error: "Cross-site request blocked." });
}

function securityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(self), microphone=()");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
}

/* Persistent session store on the existing SQLite database. */
class SqliteStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS sessions(
      sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires)");
    this.timer = setInterval(() => {
      try { db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now()); } catch (_) {}
    }, 10 * 60 * 1000);
    this.timer.unref();
  }
  get(sid, cb) {
    try {
      const r = this.db.prepare("SELECT sess,expires FROM sessions WHERE sid=?").get(sid);
      if (!r || r.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(r.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime() : Date.now() + 12 * 3600 * 1000;
      this.db.prepare(`INSERT INTO sessions(sid,sess,expires) VALUES(?,?,?)
        ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires`)
        .run(sid, JSON.stringify(sess), exp);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
  destroy(sid, cb) {
    try { this.db.prepare("DELETE FROM sessions WHERE sid=?").run(sid); cb && cb(null); }
    catch (e) { cb && cb(e); }
  }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}

/* Spreadsheet formula-injection guard for exported text cells. */
function xlsxSafe(v) {
  if (typeof v !== "string") return v;
  return /^[=+\-@\t\r]/.test(v) ? "'" + v : v;
}

/* Imported cells that look like formulas are rejected, not executed. */
function looksLikeFormula(v) {
  return typeof v === "string" && /^[=@\t\r]/.test(v.trim() === v ? v : v.trimStart());
}

module.exports = {
  safeEqual, rateLimiter, originCheck, securityHeaders,
  SqliteStore, xlsxSafe, looksLikeFormula
};
