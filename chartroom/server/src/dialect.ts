/**
 * Chartroom's tables, in the registry's portable idiom (ADR-4): SQLite and
 * T-SQL flavours of the same schema, ISO-8601 text timestamps, and the same
 * append-only storage model — a dashboard version is never updated, and the
 * audit log is the one table with no delete story at all.
 *
 * `chartroom_dashboard.status` is the single mutable column here, mirroring
 * the registry's channel pointer: what a dashboard *is* lives in its versions;
 * where it stands in the promotion pipeline is a pointer whose every move is
 * audited.
 */

import { toNamedParameters, type Dialect, type DialectName } from '../../../server/dialect';

const DASHBOARD = 'chartroom_dashboard';
const VERSION = 'chartroom_version';
const AUDIT = 'chartroom_audit';
const BRIEF = 'chartroom_brief';

const SQLITE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ${DASHBOARD} (
  id         TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL,
  owner      TEXT NOT NULL,
  created_at TEXT NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS ${VERSION} (
  dashboard_id TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  spec         TEXT NOT NULL,
  spec_hash    TEXT NOT NULL,
  parent_no    INTEGER,
  author       TEXT NOT NULL,
  lint_report  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  UNIQUE (dashboard_id, version_no)
)`,
  `CREATE INDEX IF NOT EXISTS ix_${VERSION}_dash ON ${VERSION} (dashboard_id, version_no)`,
  `CREATE TABLE IF NOT EXISTS ${AUDIT} (
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_id   TEXT NOT NULL,
  payload_hash  TEXT NOT NULL,
  created_at    TEXT NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS ix_${AUDIT}_artifact ON ${AUDIT} (artifact_type, artifact_id)`,
  // Briefs are versioned like everything else: an edit appends the next
  // version_no; approval stamps the *current* one. `status` moves
  // draft → approved → superseded, and only a human actor may move it to
  // approved — the API enforces that, the schema just records who and when.
  `CREATE TABLE IF NOT EXISTS ${BRIEF} (
  dashboard_id TEXT NOT NULL,
  version_no   INTEGER NOT NULL,
  content      TEXT NOT NULL,
  status       TEXT NOT NULL,
  author       TEXT NOT NULL,
  approved_by  TEXT,
  approved_at  TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (dashboard_id, version_no)
)`,
];

const MSSQL_SCHEMA = [
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${DASHBOARD}')
CREATE TABLE ${DASHBOARD} (
  id         NVARCHAR(120) NOT NULL UNIQUE,
  title      NVARCHAR(200) NOT NULL,
  status     NVARCHAR(20) NOT NULL,
  owner      NVARCHAR(120) NOT NULL,
  created_at NVARCHAR(30) NOT NULL
)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${VERSION}')
CREATE TABLE ${VERSION} (
  dashboard_id NVARCHAR(120) NOT NULL,
  version_no   INT NOT NULL,
  spec         NVARCHAR(MAX) NOT NULL,
  spec_hash    NVARCHAR(64) NOT NULL,
  parent_no    INT,
  author       NVARCHAR(120) NOT NULL,
  lint_report  NVARCHAR(MAX) NOT NULL,
  created_at   NVARCHAR(30) NOT NULL,
  CONSTRAINT uq_${VERSION} UNIQUE (dashboard_id, version_no)
)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_${VERSION}_dash')
CREATE INDEX ix_${VERSION}_dash ON ${VERSION} (dashboard_id, version_no)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${AUDIT}')
CREATE TABLE ${AUDIT} (
  actor         NVARCHAR(200) NOT NULL,
  action        NVARCHAR(60) NOT NULL,
  artifact_type NVARCHAR(40) NOT NULL,
  artifact_id   NVARCHAR(120) NOT NULL,
  payload_hash  NVARCHAR(64) NOT NULL,
  created_at    NVARCHAR(30) NOT NULL
)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_${AUDIT}_artifact')
CREATE INDEX ix_${AUDIT}_artifact ON ${AUDIT} (artifact_type, artifact_id)`,
  `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = '${BRIEF}')
CREATE TABLE ${BRIEF} (
  dashboard_id NVARCHAR(120) NOT NULL,
  version_no   INT NOT NULL,
  content      NVARCHAR(MAX) NOT NULL,
  status       NVARCHAR(20) NOT NULL,
  author       NVARCHAR(200) NOT NULL,
  approved_by  NVARCHAR(200),
  approved_at  NVARCHAR(30),
  created_at   NVARCHAR(30) NOT NULL,
  CONSTRAINT uq_${BRIEF} UNIQUE (dashboard_id, version_no)
)`,
];

export const STATEMENTS = {
  insertDashboard:
    `INSERT INTO ${DASHBOARD} (id, title, status, owner, created_at) VALUES (?, ?, ?, ?, ?)`,
  dashboard: `SELECT id, title, status, owner, created_at FROM ${DASHBOARD} WHERE id = ?`,
  dashboards: `SELECT id, title, status, owner, created_at FROM ${DASHBOARD} ORDER BY id`,
  // The one mutable column — the promotion pointer (see header comment).
  setStatus: `UPDATE ${DASHBOARD} SET status = ? WHERE id = ?`,

  insertVersion:
    `INSERT INTO ${VERSION} (dashboard_id, version_no, spec, spec_hash, parent_no, author, lint_report, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  latestVersion:
    `SELECT version_no, spec, spec_hash, parent_no, author, lint_report, created_at
     FROM ${VERSION} WHERE dashboard_id = ?
       AND version_no = (SELECT MAX(version_no) FROM ${VERSION} WHERE dashboard_id = ?)`,
  version:
    `SELECT version_no, spec, spec_hash, parent_no, author, lint_report, created_at
     FROM ${VERSION} WHERE dashboard_id = ? AND version_no = ?`,
  versions:
    `SELECT version_no, spec_hash, parent_no, author, created_at
     FROM ${VERSION} WHERE dashboard_id = ? ORDER BY version_no`,
  maxVersion: `SELECT MAX(version_no) AS v FROM ${VERSION} WHERE dashboard_id = ?`,

  insertBrief:
    `INSERT INTO ${BRIEF} (dashboard_id, version_no, content, status, author, approved_by, approved_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
  latestBrief:
    `SELECT version_no, content, status, author, approved_by, approved_at, created_at
     FROM ${BRIEF} WHERE dashboard_id = ?
       AND version_no = (SELECT MAX(version_no) FROM ${BRIEF} WHERE dashboard_id = ?)`,
  maxBrief: `SELECT MAX(version_no) AS v FROM ${BRIEF} WHERE dashboard_id = ?`,
  briefsOf:
    `SELECT version_no, content, status, author, approved_by, approved_at, created_at
     FROM ${BRIEF} WHERE dashboard_id = ? ORDER BY version_no`,
  // The two status moves. Approval stamps who and when; superseding does not
  // erase them — an approval that was later superseded is history, not error.
  approveBrief:
    `UPDATE ${BRIEF} SET status = 'approved', approved_by = ?, approved_at = ?
     WHERE dashboard_id = ? AND version_no = ? AND status = 'draft'`,
  supersedeBriefs:
    `UPDATE ${BRIEF} SET status = 'superseded' WHERE dashboard_id = ? AND status <> 'superseded'`,

  insertAudit:
    `INSERT INTO ${AUDIT} (actor, action, artifact_type, artifact_id, payload_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  auditOf:
    `SELECT actor, action, artifact_type, artifact_id, payload_hash, created_at
     FROM ${AUDIT} WHERE artifact_type = ? AND artifact_id = ? ORDER BY created_at`,
};

export function chartroomDialect(name: DialectName): Dialect {
  return {
    name,
    schema: () => (name === 'mssql' ? MSSQL_SCHEMA.slice() : SQLITE_SCHEMA.slice()),
    // The registry's own marker rewriter — string-literal-aware, tested there.
    bind: name === 'mssql' ? (sql) => toNamedParameters(sql) : (sql) => sql,
  };
}
