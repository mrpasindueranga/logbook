const express = require("express");
const router = express.Router();
const db = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    if (!req.query.project_id)
      return res.status(400).json({ error: "project_id required" });
    res.json(
      await db.q(
        "SELECT * FROM ideas WHERE project_id = $1 ORDER BY created_at DESC",
        [req.query.project_id],
      ),
    );
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { project_id, text, source = "manual", description = "" } = req.body;
    if (!project_id)
      return res.status(400).json({ error: "project_id required" });
    if (!text?.trim()) return res.status(400).json({ error: "text required" });
    const idea = await db.one(
      "INSERT INTO ideas (project_id, text, source, description) VALUES ($1,$2,$3,$4) RETURNING *",
      [project_id, text.trim(), source, description],
    );
    res.status(201).json(idea);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const idea = await db.one("SELECT * FROM ideas WHERE id = $1", [
      req.params.id,
    ]);
    if (!idea) return res.status(404).json({ error: "Not found" });
    const text = (req.body.text ?? idea.text).trim() || idea.text;
    const description =
      req.body.description !== undefined
        ? req.body.description
        : idea.description || "";
    const updated = await db.one(
      "UPDATE ideas SET text=$1, description=$2 WHERE id=$3 RETURNING *",
      [text, description, req.params.id],
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const idea = await db.one("SELECT id FROM ideas WHERE id = $1", [
      req.params.id,
    ]);
    if (!idea) return res.status(404).json({ error: "Not found" });
    await db.run("DELETE FROM ideas WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});

// POST /api/ideas/:id/promote  → creates a todo, deletes idea
router.post("/:id/promote", async (req, res, next) => {
  try {
    const idea = await db.one("SELECT * FROM ideas WHERE id = $1", [
      req.params.id,
    ]);
    if (!idea) return res.status(404).json({ error: "Not found" });

    const { maxpos } = await db.one(
      "SELECT COALESCE(MAX(position),0) AS maxpos FROM todos WHERE project_id = $1",
      [idea.project_id],
    );

    const todo = await db.one(
      "INSERT INTO todos (project_id, title, position) VALUES ($1,$2,$3) RETURNING *",
      [idea.project_id, idea.text, Number(maxpos) + 1],
    );
    await db.run("DELETE FROM ideas WHERE id = $1", [idea.id]);
    res.status(201).json(todo);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
