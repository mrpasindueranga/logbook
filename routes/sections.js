const express = require("express");
const router = express.Router();
const db = require("../database/db");

// GET /api/sections?org_id=X  — list all sections for an org, with project count
router.get("/", async (req, res, next) => {
  try {
    const { org_id } = req.query;
    if (!org_id) return res.status(400).json({ error: "org_id is required" });
    const rows = await db.q(
      `SELECT s.*, COUNT(p.id)::int AS project_count
       FROM sections s
       LEFT JOIN projects p ON p.section_id = s.id
       WHERE s.org_id = $1
       GROUP BY s.id
       ORDER BY s.position ASC, s.id ASC`,
      [org_id],
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// POST /api/sections  — create a new section
router.post("/", async (req, res, next) => {
  try {
    const { org_id, name } = req.body;
    if (!org_id) return res.status(400).json({ error: "org_id is required" });
    if (!name?.trim())
      return res.status(400).json({ error: "Name is required" });
    if (!(await db.one("SELECT id FROM organizations WHERE id = $1", [org_id])))
      return res.status(404).json({ error: "Organization not found" });

    const maxPos = await db.one(
      "SELECT COALESCE(MAX(position),0) AS m FROM sections WHERE org_id = $1",
      [org_id],
    );
    const s = await db.one(
      "INSERT INTO sections (org_id, name, position) VALUES ($1,$2,$3) RETURNING *",
      [org_id, name.trim(), (maxPos?.m ?? 0) + 1],
    );
    s.project_count = 0;
    res.status(201).json(s);
  } catch (e) {
    next(e);
  }
});

// PUT /api/sections/:id  — rename / reorder
router.put("/:id", async (req, res, next) => {
  try {
    const s = await db.one("SELECT * FROM sections WHERE id = $1", [
      req.params.id,
    ]);
    if (!s) return res.status(404).json({ error: "Section not found" });

    const name = (req.body.name ?? s.name).trim();
    const position =
      req.body.position != null ? Number(req.body.position) : s.position;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const updated = await db.one(
      "UPDATE sections SET name=$1, position=$2, updated_at=NOW() WHERE id=$3 RETURNING *",
      [name, position, req.params.id],
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/sections/:id  — delete section; projects fall back to first remaining section
router.delete("/:id", async (req, res, next) => {
  try {
    const s = await db.one("SELECT * FROM sections WHERE id = $1", [
      req.params.id,
    ]);
    if (!s) return res.status(404).json({ error: "Section not found" });

    // Prevent deleting the last section for this org
    const count = await db.one(
      "SELECT COUNT(*) AS c FROM sections WHERE org_id = $1",
      [s.org_id],
    );
    if (parseInt(count.c) <= 1)
      return res.status(400).json({ error: "Cannot delete the last section" });

    // Reassign projects to the first remaining section
    const fallback = await db.one(
      "SELECT id FROM sections WHERE org_id = $1 AND id != $2 ORDER BY position ASC, id ASC LIMIT 1",
      [s.org_id, s.id],
    );
    await db.run("UPDATE projects SET section_id = $1 WHERE section_id = $2", [
      fallback.id,
      s.id,
    ]);
    await db.run("DELETE FROM sections WHERE id = $1", [s.id]);
    res.json({ ok: true, reassigned_to: fallback.id });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
