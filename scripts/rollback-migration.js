#!/usr/bin/env node
"use strict";
/* Roll the database back to a pre-migration backup.
   Usage:  node scripts/rollback-migration.js <backup-file> [DATA_DIR]
   STOP THE SERVER FIRST. The current DB is kept as attendance.rolled-back-<time>.db,
   so nothing is lost and the rollback itself can be undone. */
const fs = require("fs");
const path = require("path");
const [backup, dirArg] = process.argv.slice(2);
if (!backup) { console.error("Usage: node scripts/rollback-migration.js <backup-file> [DATA_DIR]"); process.exit(1); }
const dataDir = path.resolve(dirArg || process.env.DATA_DIR || path.join(__dirname, "..", "DATA"));
const live = path.join(dataDir, "attendance.db");
if (!fs.existsSync(backup)) { console.error("Backup not found:", backup); process.exit(1); }
const head = Buffer.alloc(16); const fd = fs.openSync(backup, "r"); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
if (head.toString("utf8", 0, 15) !== "SQLite format 3") { console.error("Not a SQLite database file:", backup); process.exit(1); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
if (fs.existsSync(live)) fs.copyFileSync(live, path.join(dataDir, `attendance.rolled-back-${stamp}.db`));
for (const ext of ["-wal", "-shm"]) if (fs.existsSync(live + ext)) fs.rmSync(live + ext);
fs.copyFileSync(backup, live);
console.log("Rolled back to", backup, "\nPrevious database saved as attendance.rolled-back-" + stamp + ".db");
