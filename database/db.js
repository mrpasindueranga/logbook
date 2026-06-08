const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DB || "logbook",
  user: process.env.PG_USER || "postgres",
  password: process.env.PG_PASSWORD || "postgres",
});

/** Run a query, return all rows. */
async function q(text, params) {
  const res = await pool.query(text, params);
  return res.rows;
}

/** Run a query, return first row or null. */
async function one(text, params) {
  const res = await pool.query(text, params);
  return res.rows[0] ?? null;
}

/** Run a query, ignore return value. */
async function run(text, params) {
  await pool.query(text, params);
}

async function init() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS citext;

    CREATE TABLE IF NOT EXISTS organizations (
      id          SERIAL PRIMARY KEY,
      name        TEXT    NOT NULL UNIQUE,
      description TEXT    NOT NULL DEFAULT '',
      color       TEXT    NOT NULL DEFAULT '#6366f1',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS projects (
      id          SERIAL PRIMARY KEY,
      org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      status      TEXT    NOT NULL DEFAULT 'active',
      color       TEXT    NOT NULL DEFAULT '#818cf8',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL DEFAULT 'Untitled',
      content     TEXT    NOT NULL DEFAULT '',
      tags        TEXT    NOT NULL DEFAULT '[]',
      pinned      INTEGER NOT NULL DEFAULT 0,
      type        TEXT    NOT NULL DEFAULT 'descriptive',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS todos (
      id          SERIAL PRIMARY KEY,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title       TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'todo',
      priority    TEXT    NOT NULL DEFAULT 'medium',
      due_date    DATE    DEFAULT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id          SERIAL PRIMARY KEY,
      entity_type TEXT    NOT NULL,
      entity_id   INTEGER NOT NULL,
      entity_name TEXT    NOT NULL DEFAULT '',
      project_id  INTEGER DEFAULT NULL,
      org_id      INTEGER DEFAULT NULL,
      action      TEXT    NOT NULL,
      meta        TEXT    NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS labels (
      id         SERIAL PRIMARY KEY,
      name       CITEXT NOT NULL UNIQUE,
      color      TEXT   NOT NULL DEFAULT '#3b82f6',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS note_labels (
      note_id  INTEGER NOT NULL REFERENCES notes(id)  ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, label_id)
    );

    CREATE TABLE IF NOT EXISTS ideas (
      id         SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      source     TEXT NOT NULL DEFAULT 'manual',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS note_attachments (
      id           SERIAL PRIMARY KEY,
      note_id      INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      filename     TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes   BIGINT NOT NULL DEFAULT 0,
      object_key   TEXT NOT NULL,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id          SERIAL PRIMARY KEY,
      title       TEXT    NOT NULL,
      note        TEXT    NOT NULL DEFAULT '',
      remind_at   TIMESTAMPTZ NOT NULL,
      entity_type TEXT    NOT NULL DEFAULT 'standalone',
      entity_id   INTEGER DEFAULT NULL,
      project_id  INTEGER DEFAULT NULL REFERENCES projects(id) ON DELETE CASCADE,
      is_done     INTEGER NOT NULL DEFAULT 0,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_projects_org_id     ON projects(org_id);
    CREATE INDEX IF NOT EXISTS idx_notes_project_id    ON notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at    ON notes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_todos_project_id    ON todos(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_project    ON activity_log(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_entity     ON activity_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_note_labels_note    ON note_labels(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_labels_label   ON note_labels(label_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_project       ON ideas(project_id);
    CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at ASC);
    CREATE INDEX IF NOT EXISTS idx_reminders_project   ON reminders(project_id);
  `);

  // Optional Todoist sync support (idempotent migration).
  await pool.query(`
    ALTER TABLE todos
      ADD COLUMN IF NOT EXISTS todoist_task_id TEXT DEFAULT NULL;

    ALTER TABLE todos
      ADD COLUMN IF NOT EXISTS todoist_last_sync_at TIMESTAMPTZ DEFAULT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_todoist_task_id
      ON todos(todoist_task_id)
      WHERE todoist_task_id IS NOT NULL;
  `);

  // ── Sections migration (idempotent) ──────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sections (
      id         SERIAL PRIMARY KEY,
      org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sections_org ON sections(org_id);
  `);

  // Add section_id to projects if it doesn't exist yet
  await pool.query(`
    ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS section_id INTEGER DEFAULT NULL
        REFERENCES sections(id) ON DELETE SET NULL;
  `);

  // Seed a default "Projects" section for each org that doesn't have any yet
  await pool.query(`
    INSERT INTO sections (org_id, name, position)
    SELECT o.id, 'Projects', 0
    FROM organizations o
    WHERE NOT EXISTS (
      SELECT 1 FROM sections s WHERE s.org_id = o.id
    );

    -- Assign existing unsectioned projects to the first section of their org
    UPDATE projects p
    SET section_id = (
      SELECT s.id FROM sections s WHERE s.org_id = p.org_id ORDER BY s.position ASC, s.id ASC LIMIT 1
    )
    WHERE p.section_id IS NULL;
  `);

  console.log("✓  PostgreSQL schema ready");
}

module.exports = { q, one, run, pool, init };
