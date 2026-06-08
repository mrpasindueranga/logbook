const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { removeMany } = require("../lib/storage");

// GET /api/projects?org_id=X
router.get("/", async (req, res, next) => {
  try {
    const { org_id } = req.query;
    const rows = org_id
      ? await db.q(
          `SELECT p.*, COUNT(n.id) AS note_count, o.name AS org_name
                    FROM projects p
                    LEFT JOIN notes n ON n.project_id = p.id
                    JOIN organizations o ON o.id = p.org_id
                    WHERE p.org_id = $1
                    GROUP BY p.id, o.name ORDER BY p.name ASC`,
          [org_id],
        )
      : await db.q(`SELECT p.*, COUNT(n.id) AS note_count, o.name AS org_name
                    FROM projects p
                    LEFT JOIN notes n ON n.project_id = p.id
                    JOIN organizations o ON o.id = p.org_id
                    GROUP BY p.id, o.name ORDER BY p.name ASC`);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/projects/:id
router.get("/:id", async (req, res, next) => {
  try {
    const project = await db.one(
      `
      SELECT p.*, o.name AS org_name, o.id AS org_id, o.color AS org_color
      FROM projects p JOIN organizations o ON o.id = p.org_id
      WHERE p.id = $1`,
      [req.params.id],
    );
    if (!project) return res.status(404).json({ error: "Project not found" });

    project.notes = await db.q(
      `
      SELECT id, title, tags, pinned, type, created_at, updated_at,
        LEFT(content, 300) AS excerpt
      FROM notes WHERE project_id = $1 AND type != 'story'
      ORDER BY pinned DESC, updated_at DESC`,
      [req.params.id],
    );

    res.json(project);
  } catch (e) {
    next(e);
  }
});

// POST /api/projects
router.post("/", async (req, res, next) => {
  try {
    const {
      org_id,
      name,
      description = "",
      status = "active",
      color = "#818cf8",
      section_id = null,
    } = req.body;
    if (!org_id) return res.status(400).json({ error: "org_id is required" });
    if (!name?.trim())
      return res.status(400).json({ error: "Name is required" });
    if (!(await db.one("SELECT id FROM organizations WHERE id = $1", [org_id])))
      return res.status(404).json({ error: "Organization not found" });

    // Resolve section: use provided, or fall back to first section of org
    let resolvedSection = section_id ? Number(section_id) : null;
    if (!resolvedSection) {
      const first = await db.one(
        "SELECT id FROM sections WHERE org_id = $1 ORDER BY position ASC, id ASC LIMIT 1",
        [org_id],
      );
      resolvedSection = first?.id ?? null;
    }

    const p = await db.one(
      "INSERT INTO projects (org_id, name, description, status, color, section_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [org_id, name.trim(), description.trim(), status, color, resolvedSection],
    );
    res.status(201).json(p);
  } catch (e) {
    next(e);
  }
});

// PUT /api/projects/:id
router.put("/:id", async (req, res, next) => {
  try {
    const p = await db.one("SELECT * FROM projects WHERE id = $1", [
      req.params.id,
    ]);
    if (!p) return res.status(404).json({ error: "Project not found" });

    const name = (req.body.name ?? p.name).trim();
    const description = (req.body.description ?? p.description).trim();
    const status = req.body.status ?? p.status;
    const color = req.body.color ?? p.color;
    const section_id =
      req.body.section_id !== undefined ? req.body.section_id : p.section_id;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const updated = await db.one(
      `UPDATE projects SET name=$1, description=$2, status=$3, color=$4, section_id=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [name, description, status, color, section_id || null, req.params.id],
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/projects/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const p = await db.one("SELECT id FROM projects WHERE id = $1", [
      req.params.id,
    ]);
    if (!p) return res.status(404).json({ error: "Project not found" });
    // Purge all MinIO objects for every note in this project
    const attachments = await db.q(
      "SELECT na.object_key FROM note_attachments na JOIN notes n ON n.id = na.note_id WHERE n.project_id = $1",
      [p.id],
    );
    await removeMany(attachments.map((a) => a.object_key));
    await db.run("DELETE FROM projects WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});

// GET /api/projects/:id/story — list all story pages
router.get("/:id/story", async (req, res, next) => {
  try {
    const rows = await db.q(
      `SELECT id, title, updated_at FROM notes
       WHERE project_id = $1 AND type = 'story'
       ORDER BY created_at ASC`,
      [req.params.id],
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/projects/:id/story — create a new story page
router.post("/:id/story", async (req, res, next) => {
  try {
    const { title = "Untitled", content = "" } = req.body;
    const row = await db.one(
      `INSERT INTO notes (project_id, title, content, type)
       VALUES ($1, $2, $3, 'story') RETURNING id, title, updated_at`,
      [req.params.id, title.trim() || "Untitled", content],
    );
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

// GET /api/projects/:id/story/:pageId — get a story page
router.get("/:id/story/:pageId", async (req, res, next) => {
  try {
    const row = await db.one(
      `SELECT id, title, content, updated_at FROM notes
       WHERE id = $1 AND project_id = $2 AND type = 'story'`,
      [req.params.pageId, req.params.id],
    );
    if (!row) return res.status(404).json({ error: "Page not found" });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

// PUT /api/projects/:id/story/:pageId — update a story page
router.put("/:id/story/:pageId", async (req, res, next) => {
  try {
    const page = await db.one(
      `SELECT id FROM notes WHERE id = $1 AND project_id = $2 AND type = 'story'`,
      [req.params.pageId, req.params.id],
    );
    if (!page) return res.status(404).json({ error: "Page not found" });
    const { title, content } = req.body;
    const sets = [];
    const vals = [];
    let i = 1;
    if (title !== undefined) {
      sets.push(`title = $${i++}`);
      vals.push(title.trim() || "Untitled");
    }
    if (content !== undefined) {
      sets.push(`content = $${i++}`);
      vals.push(content);
    }
    if (sets.length) {
      sets.push("updated_at = NOW()");
      vals.push(req.params.pageId);
      await db.run(
        `UPDATE notes SET ${sets.join(", ")} WHERE id = $${i}`,
        vals,
      );
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// DELETE /api/projects/:id/story/:pageId — delete a story page
router.delete("/:id/story/:pageId", async (req, res, next) => {
  try {
    await db.run(
      `DELETE FROM notes WHERE id = $1 AND project_id = $2 AND type = 'story'`,
      [req.params.pageId, req.params.id],
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
