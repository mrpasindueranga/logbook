const express = require("express");
const router = express.Router();
const db = require("../database/db");

const VALID_ENTITY_TYPES = ["note", "story", "todo", "reminder"];

// GET /api/sketches?ids=1,2,3  — batch fetch for hydrating inline embeds
router.get("/", async (req, res, next) => {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ error: "ids is required" });
    const idList = ids
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n));
    if (!idList.length) return res.json([]);
    const rows = await db.q(
      "SELECT id, entity_type, entity_id, elements FROM content_sketches WHERE id = ANY($1::int[])",
      [idList],
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// GET /api/sketches/:id
router.get("/:id", async (req, res, next) => {
  try {
    const row = await db.one(
      "SELECT id, entity_type, entity_id, elements FROM content_sketches WHERE id = $1",
      [req.params.id],
    );
    if (!row) return res.status(404).json({ error: "Sketch not found" });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

// POST /api/sketches  { entity_type, entity_id, elements }
router.post("/", async (req, res, next) => {
  try {
    const { entity_type, entity_id, elements } = req.body;
    if (!VALID_ENTITY_TYPES.includes(entity_type))
      return res.status(400).json({ error: "Invalid entity_type" });
    if (!entity_id) return res.status(400).json({ error: "entity_id is required" });
    const elementsJson =
      typeof elements === "string" ? elements : JSON.stringify(elements || { elements: [] });
    const created = await db.one(
      "INSERT INTO content_sketches (entity_type, entity_id, elements) VALUES ($1,$2,$3) RETURNING id, entity_type, entity_id, elements",
      [entity_type, entity_id, elementsJson],
    );
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// PUT /api/sketches/:id  { elements }
router.put("/:id", async (req, res, next) => {
  try {
    const row = await db.one("SELECT id FROM content_sketches WHERE id = $1", [req.params.id]);
    if (!row) return res.status(404).json({ error: "Sketch not found" });
    const { elements } = req.body;
    const elementsJson =
      typeof elements === "string" ? elements : JSON.stringify(elements || { elements: [] });
    const updated = await db.one(
      "UPDATE content_sketches SET elements=$1, updated_at=NOW() WHERE id=$2 RETURNING id, entity_type, entity_id, elements",
      [elementsJson, req.params.id],
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
