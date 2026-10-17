-- OPTIONAL manual alternative (SQLite >= 3.35). Prefer restoring the backup file.
-- Removes only the objects added by migration v1; original tables/rows are untouched.
-- Back up first, stop the server, then run with: sqlite3 attendance.db < rollback-migration.sql
DROP INDEX IF EXISTS uq_att_one_open;
DROP TABLE IF EXISTS company_roles;
DROP TABLE IF EXISTS worker_assignments;
DROP TABLE IF EXISTS import_history;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS sessions;
ALTER TABLE workers DROP COLUMN sponsor_company_id;
ALTER TABLE workers DROP COLUMN updated_at;
ALTER TABLE companies DROP COLUMN review_required;
ALTER TABLE companies DROP COLUMN notes;
DELETE FROM schema_meta WHERE key='version';
-- Companies seeded by the migration (the 7 owner-supplied names + EMK STEEL) are NOT removed
-- automatically because they may already be referenced; delete manually if truly unused.
