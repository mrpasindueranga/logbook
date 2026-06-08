/**
 * One-shot migration helper:
 *   node scripts/pg-migrate.js [--data]
 *
 *   --data   also copy existing SQLite rows into PostgreSQL
 */
"use strict";
const fs = require("fs");
const path = require("path");

/* ── File content ── */

const files = {};

// ─────────────────────────────────────────────────────────────────────────────
files["database/db.js"] = `
const { Pool } = require("pg");

const pool = new Pool({
  host:     process.env.PG_HOST     || "localhost",
  port:     parseInt(process.env.PG_PORT || "5432"),
  database: process.env.PG_DB       || "logbook",
  user:     process.env.PG_USER     || "postgres",
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
  await pool.query(\`
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

    CREATE INDEX IF NOT EXISTS idx_projects_org_id     ON projects(org_id);
    CREATE INDEX IF NOT EXISTS idx_notes_project_id    ON notes(project_id);
    CREATE INDEX IF NOT EXISTS idx_notes_updated_at    ON notes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_todos_project_id    ON todos(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_project    ON activity_log(project_id);
    CREATE INDEX IF NOT EXISTS idx_activity_entity     ON activity_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_note_labels_note    ON note_labels(note_id);
    CREATE INDEX IF NOT EXISTS idx_note_labels_label   ON note_labels(label_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_project       ON ideas(project_id);
  \`);
  console.log("✓  PostgreSQL schema ready");
}

module.exports = { q, one, run, pool, init };
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["lib/logger.js"] = `
const db = require("../database/db");

async function log({
  entity_type,
  entity_id,
  entity_name = "",
  project_id  = null,
  org_id      = null,
  action,
  meta        = {},
}) {
  try {
    await db.run(
      \`INSERT INTO activity_log
         (entity_type, entity_id, entity_name, project_id, org_id, action, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)\`,
      [entity_type, entity_id, entity_name, project_id, org_id, action, JSON.stringify(meta)],
    );
  } catch (_) {
    // Never let logging crash the main request
  }
}

module.exports = { log };
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/organizations.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

// GET /api/organizations
router.get("/", async (req, res, next) => {
  try {
    const rows = await db.q(\`
      SELECT o.*,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT n.id) AS note_count
      FROM organizations o
      LEFT JOIN projects p ON p.org_id = o.id
      LEFT JOIN notes   n ON n.project_id = p.id
      GROUP BY o.id
      ORDER BY o.name ASC
    \`);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/organizations/:id
router.get("/:id", async (req, res, next) => {
  try {
    const org = await db.one("SELECT * FROM organizations WHERE id = $1", [req.params.id]);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    org.projects = await db.q(\`
      SELECT p.*, COUNT(n.id) AS note_count
      FROM projects p
      LEFT JOIN notes n ON n.project_id = p.id
      WHERE p.org_id = $1
      GROUP BY p.id
      ORDER BY p.name ASC
    \`, [req.params.id]);

    res.json(org);
  } catch (e) { next(e); }
});

// POST /api/organizations
router.post("/", async (req, res, next) => {
  try {
    const { name, description = "", color = "#6366f1" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    const org = await db.one(
      "INSERT INTO organizations (name, description, color) VALUES ($1,$2,$3) RETURNING *",
      [name.trim(), description.trim(), color],
    );
    res.status(201).json(org);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Organization name already exists" });
    next(e);
  }
});

// PUT /api/organizations/:id
router.put("/:id", async (req, res, next) => {
  try {
    const org = await db.one("SELECT * FROM organizations WHERE id = $1", [req.params.id]);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const name        = (req.body.name        ?? org.name).trim();
    const description = (req.body.description ?? org.description).trim();
    const color       =  req.body.color       ?? org.color;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const updated = await db.one(
      \`UPDATE organizations SET name=$1, description=$2, color=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *\`,
      [name, description, color, req.params.id],
    );
    res.json(updated);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Organization name already exists" });
    next(e);
  }
});

// DELETE /api/organizations/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const org = await db.one("SELECT id FROM organizations WHERE id = $1", [req.params.id]);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    await db.run("DELETE FROM organizations WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/projects.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

// GET /api/projects?org_id=X
router.get("/", async (req, res, next) => {
  try {
    const { org_id } = req.query;
    const rows = org_id
      ? await db.q(\`SELECT p.*, COUNT(n.id) AS note_count, o.name AS org_name
                    FROM projects p
                    LEFT JOIN notes n ON n.project_id = p.id
                    JOIN organizations o ON o.id = p.org_id
                    WHERE p.org_id = $1
                    GROUP BY p.id, o.name ORDER BY p.name ASC\`, [org_id])
      : await db.q(\`SELECT p.*, COUNT(n.id) AS note_count, o.name AS org_name
                    FROM projects p
                    LEFT JOIN notes n ON n.project_id = p.id
                    JOIN organizations o ON o.id = p.org_id
                    GROUP BY p.id, o.name ORDER BY p.name ASC\`);
    res.json(rows);
  } catch (e) { next(e); }
});

// GET /api/projects/:id
router.get("/:id", async (req, res, next) => {
  try {
    const project = await db.one(\`
      SELECT p.*, o.name AS org_name, o.id AS org_id, o.color AS org_color
      FROM projects p JOIN organizations o ON o.id = p.org_id
      WHERE p.id = $1\`, [req.params.id]);
    if (!project) return res.status(404).json({ error: "Project not found" });

    project.notes = await db.q(\`
      SELECT id, title, tags, pinned, type, created_at, updated_at,
        LEFT(content, 300) AS excerpt
      FROM notes WHERE project_id = $1
      ORDER BY pinned DESC, updated_at DESC\`, [req.params.id]);

    res.json(project);
  } catch (e) { next(e); }
});

// POST /api/projects
router.post("/", async (req, res, next) => {
  try {
    const { org_id, name, description = "", status = "active", color = "#818cf8" } = req.body;
    if (!org_id)       return res.status(400).json({ error: "org_id is required" });
    if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
    if (!await db.one("SELECT id FROM organizations WHERE id = $1", [org_id]))
      return res.status(404).json({ error: "Organization not found" });

    const p = await db.one(
      "INSERT INTO projects (org_id, name, description, status, color) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [org_id, name.trim(), description.trim(), status, color],
    );
    res.status(201).json(p);
  } catch (e) { next(e); }
});

// PUT /api/projects/:id
router.put("/:id", async (req, res, next) => {
  try {
    const p = await db.one("SELECT * FROM projects WHERE id = $1", [req.params.id]);
    if (!p) return res.status(404).json({ error: "Project not found" });

    const name        = (req.body.name        ?? p.name).trim();
    const description = (req.body.description ?? p.description).trim();
    const status      =  req.body.status      ?? p.status;
    const color       =  req.body.color       ?? p.color;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const updated = await db.one(
      \`UPDATE projects SET name=$1, description=$2, status=$3, color=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *\`,
      [name, description, status, color, req.params.id],
    );
    res.json(updated);
  } catch (e) { next(e); }
});

// DELETE /api/projects/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const p = await db.one("SELECT id FROM projects WHERE id = $1", [req.params.id]);
    if (!p) return res.status(404).json({ error: "Project not found" });
    await db.run("DELETE FROM projects WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/notes.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");
const { log } = require("../lib/logger");

async function attachLabels(rows) {
  if (!rows.length) return rows.map(r => ({ ...r, labels: [] }));
  const ids = rows.map(r => r.id);
  const lblRows = await db.q(
    \`SELECT nl.note_id, l.id, l.name, l.color
     FROM note_labels nl JOIN labels l ON l.id = nl.label_id
     WHERE nl.note_id = ANY($1::int[])\`,
    [ids],
  );
  const byNote = {};
  lblRows.forEach(l => { (byNote[l.note_id] = byNote[l.note_id] || []).push({ id: l.id, name: l.name, color: l.color }); });
  return rows.map(r => ({ ...r, labels: byNote[r.id] || [] }));
}

// GET /api/notes?project_id=X
router.get("/", async (req, res, next) => {
  try {
    const { project_id, label_id } = req.query;
    if (!project_id) return res.status(400).json({ error: "project_id is required" });

    let sql = \`SELECT id, title, tags, pinned, type, created_at, updated_at,
                 LEFT(content, 300) AS excerpt
               FROM notes WHERE project_id = $1\`;
    const params = [project_id];

    if (label_id) {
      params.push(label_id);
      sql += \` AND id IN (SELECT note_id FROM note_labels WHERE label_id = $\${params.length})\`;
    }
    sql += " ORDER BY pinned DESC, updated_at DESC";

    const rows = await db.q(sql, params);
    res.json(await attachLabels(rows));
  } catch (e) { next(e); }
});

// GET /api/notes/:id
router.get("/:id", async (req, res, next) => {
  try {
    const note = await db.one(\`
      SELECT n.*, p.name AS project_name, p.id AS project_id,
             o.name AS org_name, o.id AS org_id
      FROM notes n
      JOIN projects      p ON p.id = n.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE n.id = $1\`, [req.params.id]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    note.labels = await db.q(
      \`SELECT l.id, l.name, l.color
       FROM note_labels nl JOIN labels l ON l.id = nl.label_id
       WHERE nl.note_id = $1\`,
      [note.id],
    );
    res.json(note);
  } catch (e) { next(e); }
});

// POST /api/notes
router.post("/", async (req, res, next) => {
  try {
    const { project_id, title = "", content = "", tags = "[]", pinned = 0, type = "descriptive" } = req.body;
    if (!project_id) return res.status(400).json({ error: "project_id is required" });
    if (!await db.one("SELECT id FROM projects WHERE id = $1", [project_id]))
      return res.status(404).json({ error: "Project not found" });

    const noteType = ["quick", "descriptive"].includes(type) ? type : "descriptive";
    let resolvedTitle = title.trim();
    if (!resolvedTitle) {
      resolvedTitle = noteType === "quick" && content.trim()
        ? content.trim().split("\\n")[0].slice(0, 60).trim() || "Quick note"
        : "Untitled";
    }
    const tagsJson = typeof tags === "string" ? tags : JSON.stringify(tags);

    const created = await db.one(
      "INSERT INTO notes (project_id, title, content, tags, pinned, type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [project_id, resolvedTitle, content, tagsJson, pinned ? 1 : 0, noteType],
    );
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [project_id]);
    log({ entity_type: "note", entity_id: created.id, entity_name: created.title, project_id, org_id: proj?.org_id, action: "created", meta: { type: created.type } });
    res.status(201).json(created);
  } catch (e) { next(e); }
});

// PUT /api/notes/:id
router.put("/:id", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [req.params.id]);
    if (!note) return res.status(404).json({ error: "Note not found" });

    const title    = ((req.body.title !== undefined ? req.body.title : note.title).trim()) || "Untitled";
    const content  = req.body.content  !== undefined ? req.body.content  : note.content;
    const pinned   = req.body.pinned   !== undefined ? (req.body.pinned ? 1 : 0) : note.pinned;
    const rawTags  = req.body.tags     !== undefined ? req.body.tags     : note.tags;
    const tagsJson = typeof rawTags === "string" ? rawTags : JSON.stringify(rawTags);
    const rawType  = req.body.type     !== undefined ? req.body.type     : note.type;
    const noteType = ["quick", "descriptive"].includes(rawType) ? rawType : "descriptive";

    const updated = await db.one(
      \`UPDATE notes SET title=$1, content=$2, tags=$3, pinned=$4, type=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *\`,
      [title, content, tagsJson, pinned, noteType, req.params.id],
    );
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [note.project_id]);
    const changed = {};
    if (title !== note.title) changed.title = { from: note.title, to: title };
    if (noteType !== note.type) changed.type = { from: note.type, to: noteType };
    if (pinned !== note.pinned) changed.pinned = { from: !!note.pinned, to: !!pinned };
    log({ entity_type: "note", entity_id: note.id, entity_name: title, project_id: note.project_id, org_id: proj?.org_id, action: "updated", meta: changed });
    res.json(updated);
  } catch (e) { next(e); }
});

// DELETE /api/notes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [req.params.id]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    await db.run("DELETE FROM notes WHERE id = $1", [req.params.id]);
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [note.project_id]);
    log({ entity_type: "note", entity_id: note.id, entity_name: note.title, project_id: note.project_id, org_id: proj?.org_id, action: "deleted" });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// PATCH /api/notes/:id/pin
router.patch("/:id/pin", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [req.params.id]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    const pinned = note.pinned ? 0 : 1;
    const updated = await db.one(
      "UPDATE notes SET pinned=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [pinned, req.params.id],
    );
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/todos.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");
const { log } = require("../lib/logger");

router.get("/", async (req, res, next) => {
  try {
    const { project_id } = req.query;
    if (!project_id) return res.status(400).json({ error: "project_id is required" });
    const rows = await db.q(\`
      SELECT * FROM todos WHERE project_id = $1
      ORDER BY
        CASE status WHEN 'done' THEN 1 ELSE 0 END ASC,
        CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
        position ASC, created_at ASC\`, [project_id]);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const todo = await db.one("SELECT * FROM todos WHERE id = $1", [req.params.id]);
    if (!todo) return res.status(404).json({ error: "Todo not found" });
    res.json(todo);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { project_id, title, priority = "medium", due_date = null } = req.body;
    if (!project_id)   return res.status(400).json({ error: "project_id is required" });
    if (!title?.trim()) return res.status(400).json({ error: "title is required" });

    const proj = await db.one("SELECT id, org_id FROM projects WHERE id = $1", [project_id]);
    if (!proj) return res.status(404).json({ error: "Project not found" });

    const { maxpos } = await db.one(
      "SELECT COALESCE(MAX(position),0) AS maxpos FROM todos WHERE project_id = $1", [project_id]);

    const todo = await db.one(
      "INSERT INTO todos (project_id, title, priority, due_date, position) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [project_id, title.trim(), priority, due_date || null, Number(maxpos) + 1],
    );
    log({ entity_type: "todo", entity_id: todo.id, entity_name: todo.title, project_id, org_id: proj.org_id, action: "created" });
    res.status(201).json(todo);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const todo = await db.one("SELECT * FROM todos WHERE id = $1", [req.params.id]);
    if (!todo) return res.status(404).json({ error: "Todo not found" });
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [todo.project_id]);

    const title     = (req.body.title    ?? todo.title).trim()     || todo.title;
    const status    = req.body.status    ?? todo.status;
    const priority  = req.body.priority  ?? todo.priority;
    const due_date  = req.body.due_date  !== undefined ? req.body.due_date  : todo.due_date;
    const position  = req.body.position  ?? todo.position;

    const validStatus   = ["todo","in_progress","done"].includes(status)   ? status   : todo.status;
    const validPriority = ["low","medium","high"].includes(priority)        ? priority : todo.priority;

    const updated = await db.one(
      \`UPDATE todos SET title=$1, status=$2, priority=$3, due_date=$4, position=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *\`,
      [title, validStatus, validPriority, due_date || null, position, req.params.id],
    );
    const changed = {};
    if (status   !== todo.status)   changed.status   = { from: todo.status,   to: validStatus };
    if (priority !== todo.priority) changed.priority = { from: todo.priority, to: validPriority };
    if (title    !== todo.title)    changed.title    = { from: todo.title,    to: title };
    log({ entity_type: "todo", entity_id: todo.id, entity_name: title, project_id: todo.project_id, org_id: proj?.org_id, action: changed.status ? "status_changed" : "updated", meta: changed });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const todo = await db.one("SELECT * FROM todos WHERE id = $1", [req.params.id]);
    if (!todo) return res.status(404).json({ error: "Todo not found" });
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [todo.project_id]);
    await db.run("DELETE FROM todos WHERE id = $1", [req.params.id]);
    log({ entity_type: "todo", entity_id: todo.id, entity_name: todo.title, project_id: todo.project_id, org_id: proj?.org_id, action: "deleted" });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/ideas.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    if (!req.query.project_id) return res.status(400).json({ error: "project_id required" });
    res.json(await db.q("SELECT * FROM ideas WHERE project_id = $1 ORDER BY created_at DESC", [req.query.project_id]));
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { project_id, text, source = "manual" } = req.body;
    if (!project_id)   return res.status(400).json({ error: "project_id required" });
    if (!text?.trim()) return res.status(400).json({ error: "text required" });
    const idea = await db.one(
      "INSERT INTO ideas (project_id, text, source) VALUES ($1,$2,$3) RETURNING *",
      [project_id, text.trim(), source],
    );
    res.status(201).json(idea);
  } catch (e) { next(e); }
});

router.put("/:id", async (req, res, next) => {
  try {
    const idea = await db.one("SELECT * FROM ideas WHERE id = $1", [req.params.id]);
    if (!idea) return res.status(404).json({ error: "Not found" });
    const text = (req.body.text ?? idea.text).trim() || idea.text;
    const updated = await db.one("UPDATE ideas SET text=$1 WHERE id=$2 RETURNING *", [text, req.params.id]);
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const idea = await db.one("SELECT id FROM ideas WHERE id = $1", [req.params.id]);
    if (!idea) return res.status(404).json({ error: "Not found" });
    await db.run("DELETE FROM ideas WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// POST /api/ideas/:id/promote  → creates a todo, deletes idea
router.post("/:id/promote", async (req, res, next) => {
  try {
    const idea = await db.one("SELECT * FROM ideas WHERE id = $1", [req.params.id]);
    if (!idea) return res.status(404).json({ error: "Not found" });

    const { maxpos } = await db.one(
      "SELECT COALESCE(MAX(position),0) AS maxpos FROM todos WHERE project_id = $1", [idea.project_id]);

    const todo = await db.one(
      "INSERT INTO todos (project_id, title, position) VALUES ($1,$2,$3) RETURNING *",
      [idea.project_id, idea.text, Number(maxpos) + 1],
    );
    await db.run("DELETE FROM ideas WHERE id = $1", [idea.id]);
    res.status(201).json(todo);
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/labels.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const labels = await db.q(\`
      SELECT l.*, COUNT(nl.note_id) AS note_count
      FROM labels l
      LEFT JOIN note_labels nl ON nl.label_id = l.id
      GROUP BY l.id ORDER BY l.name ASC
    \`);
    res.json(labels);
  } catch (e) { next(e); }
});

router.post("/", async (req, res, next) => {
  try {
    const { name, color = "#3b82f6" } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: "name is required" });
    const label = await db.one(
      "INSERT INTO labels (name, color) VALUES ($1,$2) RETURNING *",
      [name.trim(), color],
    );
    res.status(201).json(label);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Label already exists" });
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const label = await db.one("SELECT * FROM labels WHERE id = $1", [req.params.id]);
    if (!label) return res.status(404).json({ error: "Not found" });
    const name  = req.body.name  !== undefined ? req.body.name.trim() : label.name;
    const color = req.body.color !== undefined ? req.body.color       : label.color;
    const updated = await db.one("UPDATE labels SET name=$1, color=$2 WHERE id=$3 RETURNING *", [name, color, req.params.id]);
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!await db.one("SELECT id FROM labels WHERE id = $1", [req.params.id]))
      return res.status(404).json({ error: "Not found" });
    await db.run("DELETE FROM labels WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

router.post("/attach", async (req, res, next) => {
  try {
    const { note_id, label_id } = req.body;
    if (!note_id || !label_id) return res.status(400).json({ error: "note_id and label_id required" });
    await db.run(
      "INSERT INTO note_labels (note_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [note_id, label_id],
    );
    res.json({ message: "Attached" });
  } catch (e) { next(e); }
});

router.post("/detach", async (req, res, next) => {
  try {
    const { note_id, label_id } = req.body;
    if (!note_id || !label_id) return res.status(400).json({ error: "note_id and label_id required" });
    await db.run("DELETE FROM note_labels WHERE note_id=$1 AND label_id=$2", [note_id, label_id]);
    res.json({ message: "Detached" });
  } catch (e) { next(e); }
});

router.post("/sync", async (req, res, next) => {
  try {
    const { note_id, label_ids } = req.body;
    if (!note_id) return res.status(400).json({ error: "note_id required" });
    const ids = Array.isArray(label_ids) ? label_ids.map(Number).filter(Boolean) : [];
    const client = await db.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM note_labels WHERE note_id=$1", [note_id]);
      for (const lid of ids) {
        await client.query("INSERT INTO note_labels (note_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [note_id, lid]);
      }
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    res.json({ message: "Synced", count: ids.length });
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/activity.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const { project_id, org_id, entity_type, entity_id, limit = 50 } = req.query;
    const cap = Math.min(parseInt(limit) || 50, 200);
    let sql = "SELECT * FROM activity_log";
    const params = [];

    if (project_id) {
      sql += " WHERE project_id = $1";
      params.push(project_id);
    } else if (org_id) {
      sql += " WHERE org_id = $1";
      params.push(org_id);
    } else if (entity_type && entity_id) {
      sql += " WHERE entity_type = $1 AND entity_id = $2";
      params.push(entity_type, entity_id);
    }
    params.push(cap);
    sql += \` ORDER BY created_at DESC LIMIT $\${params.length}\`;
    res.json(await db.q(sql, params));
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/search.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const { q, label_id } = req.query;
    const hasQuery = q && q.trim().length >= 1;
    const hasLabel = label_id && /^\\d+$/.test(label_id);
    if (!hasQuery && !hasLabel) return res.json([]);

    let where;
    const params = [];

    if (hasQuery) {
      const term = \`%\${q.trim()}%\`;
      where = "(n.title ILIKE $1 OR n.content ILIKE $1 OR n.tags ILIKE $1)";
      params.push(term);
    } else {
      where = "1=1";
    }

    if (hasLabel) {
      params.push(label_id);
      where += \` AND n.id IN (SELECT note_id FROM note_labels WHERE label_id = $\${params.length})\`;
    }

    const rows = await db.q(\`
      SELECT n.id, n.title, n.type, n.tags, n.updated_at,
        LEFT(n.content, 200) AS excerpt,
        p.id AS project_id, p.name AS project_name,
        o.id AS org_id,     o.name AS org_name, o.color AS org_color
      FROM notes n
      JOIN projects      p ON p.id = n.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE \${where}
      ORDER BY n.updated_at DESC
      LIMIT 30\`, params);

    if (rows.length) {
      const ids = rows.map(r => r.id);
      const lblRows = await db.q(
        \`SELECT nl.note_id, l.id, l.name, l.color
         FROM note_labels nl JOIN labels l ON l.id = nl.label_id
         WHERE nl.note_id = ANY($1::int[])\`,
        [ids],
      );
      const byNote = {};
      lblRows.forEach(l => { (byNote[l.note_id] = byNote[l.note_id] || []).push({ id: l.id, name: l.name, color: l.color }); });
      rows.forEach(r => { r.labels = byNote[r.id] || []; });
    }
    res.json(rows);
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/dashboard.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const stats = await db.one(\`
      SELECT
        (SELECT COUNT(*) FROM organizations)                                  AS org_count,
        (SELECT COUNT(*) FROM projects)                                       AS project_count,
        (SELECT COUNT(*) FROM notes)                                          AS note_count,
        (SELECT COUNT(*) FROM todos WHERE status != 'done')                   AS active_todos,
        (SELECT COUNT(*) FROM todos WHERE status  = 'done')                   AS done_todos,
        (SELECT COUNT(*) FROM todos WHERE status != 'done'
           AND due_date IS NOT NULL AND due_date < CURRENT_DATE)              AS overdue_todos,
        (SELECT COUNT(*) FROM todos WHERE status = 'in_progress')             AS in_progress_todos,
        (SELECT COUNT(*) FROM notes
           WHERE created_at >= NOW() - INTERVAL '7 days')                    AS notes_this_week,
        (SELECT COUNT(*) FROM todos WHERE status = 'done'
           AND updated_at >= NOW() - INTERVAL '7 days')                      AS todos_done_this_week,
        (SELECT COUNT(*) FROM ideas)                                          AS ideas_count
    \`);

    const projects = await db.q(\`
      SELECT
        p.id, p.name, p.status, p.updated_at, p.description,
        o.id AS org_id, o.name AS org_name, o.color AS org_color,
        COUNT(DISTINCT n.id)                                                  AS note_count,
        COUNT(DISTINCT t.id)                                                  AS todo_total,
        COUNT(DISTINCT CASE WHEN t.status = 'done'        THEN t.id END)     AS todo_done,
        COUNT(DISTINCT CASE WHEN t.status = 'in_progress' THEN t.id END)     AS todo_in_progress,
        COUNT(DISTINCT CASE WHEN t.status != 'done'
              AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
              THEN t.id END)                                                  AS todo_overdue,
        (SELECT n2.updated_at FROM notes n2
           WHERE n2.project_id = p.id ORDER BY n2.updated_at DESC LIMIT 1)  AS last_note_at,
        (SELECT n2.title FROM notes n2
           WHERE n2.project_id = p.id ORDER BY n2.updated_at DESC LIMIT 1)  AS last_note_title
      FROM projects p
      JOIN organizations o ON o.id = p.org_id
      LEFT JOIN notes n ON n.project_id = p.id
      LEFT JOIN todos t ON t.project_id = p.id
      GROUP BY p.id, o.id
      ORDER BY p.updated_at DESC
      LIMIT 12
    \`);

    const recentNotes = await db.q(\`
      SELECT n.id, n.title, n.tags, n.type, n.updated_at,
        LEFT(n.content, 120) AS excerpt,
        p.id AS project_id, p.name AS project_name,
        o.id AS org_id, o.name AS org_name, o.color AS org_color
      FROM notes n
      JOIN projects p ON p.id = n.project_id
      JOIN organizations o ON o.id = p.org_id
      ORDER BY n.updated_at DESC LIMIT 8
    \`);

    if (recentNotes.length) {
      const ids = recentNotes.map(r => r.id);
      const lblRows = await db.q(
        \`SELECT nl.note_id, l.id, l.name, l.color
         FROM note_labels nl JOIN labels l ON l.id = nl.label_id
         WHERE nl.note_id = ANY($1::int[])\`,
        [ids],
      );
      const byNote = {};
      lblRows.forEach(l => { (byNote[l.note_id] = byNote[l.note_id] || []).push(l); });
      recentNotes.forEach(n => { n.labels = byNote[n.id] || []; });
    }

    const recentActivity = await db.q(
      "SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 12");

    const topLabels = await db.q(\`
      SELECT l.id, l.name, l.color, COUNT(nl.note_id) AS usage
      FROM labels l
      JOIN note_labels nl ON nl.label_id = l.id
      GROUP BY l.id ORDER BY usage DESC LIMIT 8
    \`);

    const overdueTodos = await db.q(\`
      SELECT t.id, t.title, t.priority, t.due_date,
        p.id AS project_id, p.name AS project_name
      FROM todos t JOIN projects p ON p.id = t.project_id
      WHERE t.status != 'done'
        AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
      ORDER BY t.due_date ASC LIMIT 5
    \`);

    res.json({ stats, projects, recentNotes, recentActivity, topLabels, overdueTodos });
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["routes/ai.js"] = `
const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

async function getSettings() {
  const rows = await db.q("SELECT key, value FROM settings");
  const s = {};
  rows.forEach(r => { s[r.key] = r.value; });
  return s;
}

async function setSetting(key, value) {
  await db.run(
    \`INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value\`,
    [key, value],
  );
}

async function callOpenAI(messages, settings) {
  const model = settings.ai_model || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: \`Bearer \${settings.ai_api_key}\` },
    body: JSON.stringify({ model, messages, max_tokens: 1200, temperature: 0.3 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI error");
  return data.choices[0].message.content;
}

async function callOllama(messages, settings) {
  const base  = (settings.ollama_url || "http://localhost:11434").replace(/\\/$/, "");
  const model = settings.ai_model || "qwen2.5:0.5b";
  const res = await fetch(\`\${base}/api/chat\`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error || "Ollama error";
    if (msg.includes("not found")) throw new Error(\`Model '\${model}' not found. Run: ollama pull \${model}\`);
    throw new Error(msg);
  }
  return data.message?.content || data.response || "";
}

async function callLLM(messages, settings) {
  if (settings.ai_provider === "openai") return callOpenAI(messages, settings);
  if (settings.ai_provider === "ollama") return callOllama(messages, settings);
  throw new Error("no_ai_configured");
}

router.get("/settings", async (req, res, next) => {
  try {
    const s = await getSettings();
    if (s.ai_api_key && s.ai_api_key.length > 8)
      s.ai_api_key = s.ai_api_key.slice(0, 4) + "…" + s.ai_api_key.slice(-4);
    res.json(s);
  } catch (e) { next(e); }
});

router.put("/settings", async (req, res, next) => {
  try {
    const allowed = ["ai_provider","ai_model","ai_api_key","ollama_url"];
    for (const k of allowed) {
      if (req.body[k] !== undefined) await setSetting(k, req.body[k]);
    }
    res.json({ message: "Settings saved" });
  } catch (e) { next(e); }
});

router.post("/ask", async (req, res, next) => {
  try {
    const { question, project_id } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: "question is required" });

    const settings = await getSettings();
    const term = \`%\${question.trim()}%\`;

    const params = project_id ? [term, term, term, project_id] : [term, term, term];
    const where  = project_id ? "AND n.project_id = $4" : "";

    const sources = await db.q(\`
      SELECT n.id, n.title, n.type, n.updated_at,
        LEFT(n.content, 800) AS content,
        p.id AS project_id, p.name AS project_name, o.name AS org_name
      FROM notes n
      JOIN projects p ON p.id = n.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE (n.title ILIKE $1 OR n.content ILIKE $2 OR n.tags ILIKE $3) \${where}
      ORDER BY n.updated_at DESC LIMIT 6\`, params);

    if (!settings.ai_provider) {
      return res.json({ answer: null, sources, hint: "Configure AI in Settings to get smart answers." });
    }

    const context = sources
      .map((n, i) => \`[\${i+1}] "\${n.title}" (\${n.project_name} — \${n.org_name})\\n\${n.content}\`)
      .join("\\n\\n---\\n\\n");

    const messages = [
      { role: "system", content: \`You are a knowledgeable assistant for a software engineer's personal logbook.
Answer questions concisely based only on the provided notes.
Cite notes by their [number] when referencing them.
If the notes don't contain the answer, say so clearly.\` },
      { role: "user",   content: \`Notes:\\n\\n\${context}\\n\\n---\\nQuestion: \${question}\` },
    ];

    try {
      const answer = await callLLM(messages, settings);
      res.json({ answer, sources });
    } catch (e) {
      if (e.message === "no_ai_configured")
        return res.json({ answer: null, sources, hint: "Configure AI in Settings." });
      res.json({ answer: null, sources, error: e.message });
    }
  } catch (e) { next(e); }
});

router.post("/summarize/:noteId", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [req.params.noteId]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    const settings = await getSettings();
    if (!settings.ai_provider) return res.status(400).json({ error: "AI not configured" });
    const messages = [
      { role: "system", content: "You are a technical writing assistant. Summarize the given note in 2-4 concise bullet points. Focus on key information and action items." },
      { role: "user",   content: \`Title: \${note.title}\\n\\n\${note.content}\` },
    ];
    const summary = await callLLM(messages, settings);
    res.json({ summary });
  } catch (e) { next(e); }
});

router.post("/suggest-tags/:noteId", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [req.params.noteId]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    const settings = await getSettings();
    if (!settings.ai_provider) return res.status(400).json({ error: "AI not configured" });
    const messages = [
      { role: "system", content: "You are a tagging assistant. Return a JSON array of 3-5 short lowercase tags (max 2 words each) for the given note. Output only the JSON array, no other text." },
      { role: "user",   content: \`Title: \${note.title}\\n\\n\${note.content.slice(0, 1000)}\` },
    ];
    const raw  = await callLLM(messages, settings);
    const tags = JSON.parse(raw.match(/\\[.*\\]/s)?.[0] || "[]");
    res.json({ tags });
  } catch (e) { next(e); }
});

router.post("/suggest-ideas/:projectId", async (req, res, next) => {
  try {
    const proj = await db.one("SELECT * FROM projects WHERE id = $1", [req.params.projectId]);
    if (!proj) return res.status(404).json({ error: "Project not found" });
    const settings = await getSettings();
    if (!settings.ai_provider) return res.status(400).json({ error: "AI not configured" });

    const recentNotes = await db.q(
      "SELECT title, LEFT(content,400) AS content FROM notes WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 5",
      [proj.id],
    );
    const context = recentNotes.map(n => \`- \${n.title}: \${n.content}\`).join("\\n");
    const messages = [
      { role: "system", content: "You are a project planning assistant. Generate 5 actionable ideas or backlog items for the given software project. Output a JSON array of strings only." },
      { role: "user",   content: \`Project: \${proj.name}\\n\\nRecent notes:\\n\${context || "No notes yet."}\` },
    ];
    const raw   = await callLLM(messages, settings);
    const ideas = JSON.parse(raw.match(/\\[.*\\]/s)?.[0] || "[]");
    res.json({ ideas });
  } catch (e) { next(e); }
});

module.exports = router;
`.trimStart();

// ─────────────────────────────────────────────────────────────────────────────
files["server.js"] = `
const express = require("express");
const path    = require("path");
const fs      = require("fs");
const db      = require("./database/db");

const app       = express();
const PORT      = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\\/+$/, "");

app.use(express.json());

// ── API routes ────────────────────────────────────────────────────────────────
app.use(\`\${BASE_PATH}/api/organizations\`, require("./routes/organizations"));
app.use(\`\${BASE_PATH}/api/projects\`,      require("./routes/projects"));
app.use(\`\${BASE_PATH}/api/notes\`,         require("./routes/notes"));
app.use(\`\${BASE_PATH}/api/todos\`,         require("./routes/todos"));
app.use(\`\${BASE_PATH}/api/activity\`,      require("./routes/activity"));
app.use(\`\${BASE_PATH}/api/ai\`,            require("./routes/ai"));
app.use(\`\${BASE_PATH}/api/dashboard\`,     require("./routes/dashboard"));
app.use(\`\${BASE_PATH}/api/search\`,        require("./routes/search"));
app.use(\`\${BASE_PATH}/api/labels\`,        require("./routes/labels"));
app.use(\`\${BASE_PATH}/api/ideas\`,         require("./routes/ideas"));

app.use(\`\${BASE_PATH}/api\`, (req, res) => res.status(404).json({ error: "API endpoint not found" }));

// ── Static assets ─────────────────────────────────────────────────────────────
const PUBLIC = path.join(__dirname, "public");
app.use(BASE_PATH || "/", express.static(PUBLIC, { index: false }));

function serveApp(req, res) {
  let html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  html = html.replace("__BASE_PATH__", BASE_PATH);
  res.setHeader("Content-Type", "text/html");
  res.send(html);
}
app.get(BASE_PATH ? \`\${BASE_PATH}\` : "/",    serveApp);
app.get(BASE_PATH ? \`\${BASE_PATH}/*\` : "/*", serveApp);

// ── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start after schema init ───────────────────────────────────────────────────
db.init()
  .then(() => {
    app.listen(PORT, () =>
      console.log(\`✓  Logbook  →  http://localhost:\${PORT}\${BASE_PATH || "/"}\`),
    );
  })
  .catch((err) => {
    console.error("❌  Failed to initialise database:", err.message);
    process.exit(1);
  });
`.trimStart();

/* ── Write all files ── */

const ROOT = path.join(__dirname, "..");
let wrote = 0;
for (const [rel, content] of Object.entries(files)) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
  console.log(`  ✓  wrote  ${rel}`);
  wrote++;
}
console.log(`\nDone — ${wrote} files written.`);

/* ── Optional: migrate existing SQLite data ── */
if (process.argv.includes("--data")) {
  const { Pool } = require("pg");
  const Database = require("better-sqlite3");
  const dataDir = path.join(ROOT, "data");
  const dbPath = path.join(dataDir, "logbook.db");

  if (!fs.existsSync(dbPath)) {
    console.log("No SQLite DB found, skipping data migration.");
    process.exit(0);
  }

  const sqlite = new Database(dbPath);
  const pg = new Pool({
    host: process.env.PG_HOST || "localhost",
    database: process.env.PG_DB || "logbook",
    user: process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD || "postgres",
  });

  (async () => {
    console.log("\n── Migrating SQLite data to PostgreSQL ──");

    const tables = [
      "organizations",
      "projects",
      "notes",
      "todos",
      "activity_log",
      "settings",
      "labels",
      "note_labels",
      "ideas",
    ];

    for (const t of tables) {
      let rows;
      try {
        rows = sqlite.prepare(`SELECT * FROM ${t}`).all();
      } catch {
        console.log(`  skip ${t} (not found in SQLite)`);
        continue;
      }

      if (!rows.length) {
        console.log(`  skip ${t} (empty)`);
        continue;
      }

      // Build INSERT with ON CONFLICT DO NOTHING
      const cols = Object.keys(rows[0]);
      const colSql = cols.map((c) => `"${c}"`).join(", ");
      const vals = cols.map((_, i) => `$${i + 1}`).join(", ");
      const sql = `INSERT INTO ${t} (${colSql}) VALUES (${vals}) ON CONFLICT DO NOTHING`;

      let n = 0;
      for (const row of rows) {
        const params = cols.map((c) => row[c]);
        try {
          await pg.query(sql, params);
          n++;
        } catch (e) {
          /* skip dupes */
        }
      }
      console.log(`  ✓  ${t}: ${n}/${rows.length} rows`);
    }

    // Reset PG sequences to max(id)+1
    const seqTables = [
      "organizations",
      "projects",
      "notes",
      "todos",
      "activity_log",
      "labels",
      "ideas",
    ];
    for (const t of seqTables) {
      try {
        await pg.query(
          `SELECT setval(pg_get_serial_sequence('${t}','id'), COALESCE((SELECT MAX(id) FROM ${t}),0)+1, false)`,
        );
      } catch (_) {}
    }
    console.log("Sequences reset.\n✓  Data migration complete.");
    await pg.end();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
