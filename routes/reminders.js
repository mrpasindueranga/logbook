const express = require("express");
const router = express.Router();
const db = require("../database/db");

// GET /api/reminders?project_id=&upcoming=1&done=0
router.get("/", async (req, res, next) => {
  try {
    const { project_id, upcoming, done } = req.query;
    const params = [];
    const clauses = [];

    if (project_id) {
      params.push(project_id);
      clauses.push(`r.project_id = $${params.length}`);
    }
    if (upcoming === "1") {
      params.push(new Date().toISOString());
      clauses.push(`r.remind_at >= $${params.length}`);
    }
    if (done !== undefined) {
      params.push(done === "1" ? 1 : 0);
      clauses.push(`r.is_done = $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

    const rows = await db.q(
      `SELECT r.*,
              p.name     AS project_name,
              p.org_id,
              o.name     AS org_name,
              o.color    AS org_color
       FROM reminders r
       LEFT JOIN projects     p ON p.id = r.project_id
       LEFT JOIN organizations o ON o.id = p.org_id
       ${where}
       ORDER BY r.remind_at ASC`,
      params,
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const r = await db.one("SELECT * FROM reminders WHERE id = $1", [
      req.params.id,
    ]);
    if (!r) return res.status(404).json({ error: "Reminder not found" });
    res.json(r);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      title,
      note = "",
      remind_at,
      project_id = null,
      entity_type = "standalone",
      entity_id = null,
      handwritten = false,
    } = req.body;

    if (!title?.trim())
      return res.status(400).json({ error: "title is required" });
    if (!remind_at)
      return res.status(400).json({ error: "remind_at is required" });

    const r = await db.one(
      `INSERT INTO reminders (title, note, remind_at, project_id, entity_type, entity_id, handwritten)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        title.trim(),
        note,
        remind_at,
        project_id || null,
        entity_type,
        entity_id || null,
        !!handwritten,
      ],
    );
    res.status(201).json(r);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const existing = await db.one("SELECT * FROM reminders WHERE id = $1", [
      req.params.id,
    ]);
    if (!existing) return res.status(404).json({ error: "Reminder not found" });

    const title =
      (req.body.title !== undefined
        ? req.body.title
        : existing.title
      )?.trim() || existing.title;
    const note = req.body.note !== undefined ? req.body.note : existing.note;
    const remind_at =
      req.body.remind_at !== undefined
        ? req.body.remind_at
        : existing.remind_at;
    const project_id =
      req.body.project_id !== undefined
        ? req.body.project_id
        : existing.project_id;
    const is_done =
      req.body.is_done !== undefined
        ? req.body.is_done
          ? 1
          : 0
        : existing.is_done;
    const handwritten =
      req.body.handwritten !== undefined
        ? !!req.body.handwritten
        : existing.handwritten;

    const updated = await db.one(
      `UPDATE reminders
       SET title=$1, note=$2, remind_at=$3, is_done=$4, project_id=$5, handwritten=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [
        title,
        note,
        remind_at,
        is_done,
        project_id || null,
        handwritten,
        req.params.id,
      ],
    );
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const r = await db.one("SELECT id FROM reminders WHERE id = $1", [
      req.params.id,
    ]);
    if (!r) return res.status(404).json({ error: "Reminder not found" });
    await db.run("DELETE FROM reminders WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
