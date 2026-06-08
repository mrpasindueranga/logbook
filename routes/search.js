const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const { q, label_id } = req.query;
    const hasQuery = q && q.trim().length >= 1;
    const hasLabel = label_id && /^\d+$/.test(label_id);
    if (!hasQuery && !hasLabel) return res.json([]);

    let where;
    const params = [];

    if (hasQuery) {
      const term = `%${q.trim()}%`;
      where = "(n.title ILIKE $1 OR n.content ILIKE $1 OR n.tags ILIKE $1)";
      params.push(term);
    } else {
      where = "1=1";
    }

    if (hasLabel) {
      params.push(label_id);
      where += ` AND n.id IN (SELECT note_id FROM note_labels WHERE label_id = $${params.length})`;
    }

    const rows = await db.q(`
      SELECT n.id, n.title, n.type, n.tags, n.updated_at,
        LEFT(n.content, 200) AS excerpt,
        p.id AS project_id, p.name AS project_name,
        o.id AS org_id,     o.name AS org_name, o.color AS org_color
      FROM notes n
      JOIN projects      p ON p.id = n.project_id
      JOIN organizations o ON o.id = p.org_id
      WHERE ${where}
      ORDER BY n.updated_at DESC
      LIMIT 30`, params);

    if (rows.length) {
      const ids = rows.map(r => r.id);
      const lblRows = await db.q(
        `SELECT nl.note_id, l.id, l.name, l.color
         FROM note_labels nl JOIN labels l ON l.id = nl.label_id
         WHERE nl.note_id = ANY($1::int[])`,
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
