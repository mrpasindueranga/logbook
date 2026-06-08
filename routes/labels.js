const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const labels = await db.q(`
      SELECT l.*, COUNT(nl.note_id) AS note_count
      FROM labels l
      LEFT JOIN note_labels nl ON nl.label_id = l.id
      GROUP BY l.id ORDER BY l.name ASC
    `);
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
