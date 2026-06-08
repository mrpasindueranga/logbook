const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { log } = require("../lib/logger");
const { removeMany } = require("../lib/storage");

async function attachLabels(rows) {
  if (!rows.length) return rows.map((r) => ({ ...r, labels: [] }));
  const ids = rows.map((r) => r.id);
  const lblRows = await db.q(
    `SELECT nl.note_id, l.id, l.name, l.color
     FROM note_labels nl JOIN labels l ON l.id = nl.label_id
     WHERE nl.note_id = ANY($1::int[])`,
    [ids],
  );
  const byNote = {};
  lblRows.forEach((l) => {
    (byNote[l.note_id] = byNote[l.note_id] || []).push({
      id: l.id,
      name: l.name,
      color: l.color,
    });
  });
  return rows.map((r) => ({ ...r, labels: byNote[r.id] || [] }));
}

// GET /api/notes?project_id=X
router.get("/", async (req, res, next) => {
  try {
    const { project_id, label_id } = req.query;
    if (!project_id)
      return res.status(400).json({ error: "project_id is required" });

    let sql = `SELECT id, title, tags, pinned, type, created_at, updated_at,
                 LEFT(content, 300) AS excerpt
               FROM notes WHERE project_id = $1`;
    const params = [project_id];

    if (label_id) {
      params.push(label_id);
      sql += ` AND id IN (SELECT note_id FROM note_labels WHERE label_id = $${params.length})`;
    }
    sql += " ORDER BY pinned DESC, updated_at DESC";

    const rows = await db.q(sql, params);
    res.json(await attachLabels(rows));
  } catch (e) {
    next(e);
  }
});

// GET /api/notes/:id
router.get("/:id", async (req, res, next) => {
  try {
    const note = await db.one(
      `
      SELECT n.*, p.name AS project_name, p.id AS project_id,
             o.name AS org_name, o.id AS org_id
      FROM notes n
      JOIN projects      p ON p.id = n.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE n.id = $1`,
      [req.params.id],
    );
    if (!note) return res.status(404).json({ error: "Note not found" });
    note.labels = await db.q(
      `SELECT l.id, l.name, l.color
       FROM note_labels nl JOIN labels l ON l.id = nl.label_id
       WHERE nl.note_id = $1`,
      [note.id],
    );
    res.json(note);
  } catch (e) {
    next(e);
  }
});

// POST /api/notes
router.post("/", async (req, res, next) => {
  try {
    const {
      project_id,
      title = "",
      content = "",
      tags = "[]",
      pinned = 0,
      type = "descriptive",
    } = req.body;
    if (!project_id)
      return res.status(400).json({ error: "project_id is required" });
    if (!(await db.one("SELECT id FROM projects WHERE id = $1", [project_id])))
      return res.status(404).json({ error: "Project not found" });

    const noteType = ["quick", "descriptive"].includes(type)
      ? type
      : "descriptive";
    let resolvedTitle = title.trim();
    if (!resolvedTitle) {
      resolvedTitle =
        noteType === "quick" && content.trim()
          ? content.trim().split("\n")[0].slice(0, 60).trim() || "Quick note"
          : "Untitled";
    }
    const tagsJson = typeof tags === "string" ? tags : JSON.stringify(tags);

    const created = await db.one(
      "INSERT INTO notes (project_id, title, content, tags, pinned, type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [project_id, resolvedTitle, content, tagsJson, pinned ? 1 : 0, noteType],
    );
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [
      project_id,
    ]);
    log({
      entity_type: "note",
      entity_id: created.id,
      entity_name: created.title,
      project_id,
      org_id: proj?.org_id,
      action: "created",
      meta: { type: created.type },
    });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// PUT /api/notes/:id
router.put("/:id", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [
      req.params.id,
    ]);
    if (!note) return res.status(404).json({ error: "Note not found" });

    const title =
      (req.body.title !== undefined ? req.body.title : note.title).trim() ||
      "Untitled";
    const content =
      req.body.content !== undefined ? req.body.content : note.content;
    const pinned =
      req.body.pinned !== undefined ? (req.body.pinned ? 1 : 0) : note.pinned;
    const rawTags = req.body.tags !== undefined ? req.body.tags : note.tags;
    const tagsJson =
      typeof rawTags === "string" ? rawTags : JSON.stringify(rawTags);
    const rawType = req.body.type !== undefined ? req.body.type : note.type;
    const noteType = ["quick", "descriptive"].includes(rawType)
      ? rawType
      : "descriptive";

    const updated = await db.one(
      `UPDATE notes SET title=$1, content=$2, tags=$3, pinned=$4, type=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [title, content, tagsJson, pinned, noteType, req.params.id],
    );
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [
      note.project_id,
    ]);
    const changed = {};
    if (title !== note.title) changed.title = { from: note.title, to: title };
    if (noteType !== note.type)
      changed.type = { from: note.type, to: noteType };
    if (pinned !== note.pinned)
      changed.pinned = { from: !!note.pinned, to: !!pinned };
    log({
      entity_type: "note",
      entity_id: note.id,
      entity_name: title,
      project_id: note.project_id,
      org_id: proj?.org_id,
      action: "updated",
      meta: changed,
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/notes/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [
      req.params.id,
    ]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    // Purge MinIO objects before DB delete (cascade removes the rows)
    const attachments = await db.q(
      "SELECT object_key FROM note_attachments WHERE note_id = $1",
      [note.id],
    );
    await removeMany(attachments.map((a) => a.object_key));
    await db.run("DELETE FROM notes WHERE id = $1", [req.params.id]);
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [
      note.project_id,
    ]);
    log({
      entity_type: "note",
      entity_id: note.id,
      entity_name: note.title,
      project_id: note.project_id,
      org_id: proj?.org_id,
      action: "deleted",
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/notes/:id/pin
router.patch("/:id/pin", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [
      req.params.id,
    ]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    const pinned = note.pinned ? 0 : 1;
    const updated = await db.one(
      "UPDATE notes SET pinned=$1, updated_at=NOW() WHERE id=$2 RETURNING *",
      [pinned, req.params.id],
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
