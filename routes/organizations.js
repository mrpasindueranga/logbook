const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { removeMany } = require("../lib/storage");
const cache = require("../lib/cache");

// GET /api/organizations
router.get("/", async (req, res, next) => {
  try {
    const rows = await cache.cached("orgs:list", 60, () =>
      db.q(`
      SELECT o.*,
        COUNT(DISTINCT p.id) AS project_count,
        COUNT(DISTINCT n.id) AS note_count
      FROM organizations o
      LEFT JOIN projects p ON p.org_id = o.id
      LEFT JOIN notes   n ON n.project_id = p.id
      GROUP BY o.id
      ORDER BY o.name ASC
    `),
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/organizations/:id
router.get("/:id", async (req, res, next) => {
  try {
    const org = await cache.cached(`org:${req.params.id}`, 60, async () => {
      const o = await db.one("SELECT * FROM organizations WHERE id = $1", [
        req.params.id,
      ]);
      if (!o) return null;
      o.projects = await db.q(
        `
        SELECT p.*, COUNT(n.id) AS note_count, s.name AS section_name
        FROM projects p
        LEFT JOIN notes n ON n.project_id = p.id
        LEFT JOIN sections s ON s.id = p.section_id
        WHERE p.org_id = $1
        GROUP BY p.id, s.id
        ORDER BY s.position ASC NULLS LAST, s.id ASC NULLS LAST, p.name ASC
      `,
        [req.params.id],
      );
      return o;
    });
    if (!org) return res.status(404).json({ error: "Organization not found" });
    res.json(org);
  } catch (e) {
    next(e);
  }
});

// POST /api/organizations
router.post("/", async (req, res, next) => {
  try {
    const { name, description = "", color = "#6366f1" } = req.body;
    if (!name?.trim())
      return res.status(400).json({ error: "Name is required" });
    const org = await db.one(
      "INSERT INTO organizations (name, description, color) VALUES ($1,$2,$3) RETURNING *",
      [name.trim(), description.trim(), color],
    );
    await cache.del("orgs:list", "dashboard");
    res.status(201).json(org);
  } catch (e) {
    if (e.code === "23505")
      return res
        .status(409)
        .json({ error: "Organization name already exists" });
    next(e);
  }
});

// PUT /api/organizations/:id
router.put("/:id", async (req, res, next) => {
  try {
    const org = await db.one("SELECT * FROM organizations WHERE id = $1", [
      req.params.id,
    ]);
    if (!org) return res.status(404).json({ error: "Organization not found" });

    const name = (req.body.name ?? org.name).trim();
    const description = (req.body.description ?? org.description).trim();
    const color = req.body.color ?? org.color;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const updated = await db.one(
      `UPDATE organizations SET name=$1, description=$2, color=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [name, description, color, req.params.id],
    );
    await cache.del("orgs:list", `org:${req.params.id}`, "dashboard");
    res.json(updated);
  } catch (e) {
    if (e.code === "23505")
      return res
        .status(409)
        .json({ error: "Organization name already exists" });
    next(e);
  }
});

// DELETE /api/organizations/:id
router.delete("/:id", async (req, res, next) => {
  try {
    const org = await db.one("SELECT id FROM organizations WHERE id = $1", [
      req.params.id,
    ]);
    if (!org) return res.status(404).json({ error: "Organization not found" });
    // Purge all MinIO objects for every note across all projects in this org
    const attachments = await db.q(
      `SELECT na.object_key FROM note_attachments na
       JOIN notes n ON n.id = na.note_id
       JOIN projects p ON p.id = n.project_id
       WHERE p.org_id = $1`,
      [org.id],
    );
    await removeMany(attachments.map((a) => a.object_key));
    await db.run("DELETE FROM organizations WHERE id = $1", [req.params.id]);
    await cache.del("orgs:list", `org:${req.params.id}`, "dashboard");
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
