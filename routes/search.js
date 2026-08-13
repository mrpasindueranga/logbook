const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

// Notes and Story pages both live in the `notes` table, split by n.type.
async function searchNotes(term, hasLabel, labelId, wantStory) {
  const params = [];
  let where;
  if (term) {
    params.push(term);
    where = "(n.title ILIKE $1 OR n.content ILIKE $1 OR n.tags ILIKE $1)";
  } else {
    where = "1=1";
  }
  where += wantStory ? ` AND n.type = 'story'` : ` AND n.type != 'story'`;
  if (hasLabel) {
    params.push(labelId);
    where += ` AND n.id IN (SELECT note_id FROM note_labels WHERE label_id = $${params.length})`;
  }

  const rows = await db.q(`
    SELECT n.id, n.title, n.type, n.tags, n.updated_at,
      CASE WHEN n.type = 'sketch' THEN NULL ELSE LEFT(n.content, 200) END AS excerpt,
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
  rows.forEach(r => { r.entity_type = wantStory ? "story" : "note"; });
  return rows;
}

async function searchTodos(term) {
  const params = [];
  const where = term ? "(t.title ILIKE $1 OR t.description ILIKE $1)" : "1=1";
  if (term) params.push(term);

  const rows = await db.q(`
    SELECT t.id, t.title, t.status, t.priority, t.due_date, t.updated_at,
      LEFT(t.description, 200) AS excerpt,
      p.id AS project_id, p.name AS project_name,
      o.id AS org_id,     o.name AS org_name, o.color AS org_color
    FROM todos t
    JOIN projects      p ON p.id = t.project_id
    JOIN organizations o ON o.id = p.org_id
    WHERE ${where}
    ORDER BY t.updated_at DESC
    LIMIT 30`, params);

  rows.forEach(r => { r.entity_type = "todo"; r.labels = []; });
  return rows;
}

async function searchReminders(term) {
  const params = [];
  const where = term ? "(r.title ILIKE $1 OR r.note ILIKE $1)" : "1=1";
  if (term) params.push(term);

  const rows = await db.q(`
    SELECT r.id, r.title, r.remind_at, r.is_done, r.updated_at,
      LEFT(r.note, 200) AS excerpt,
      p.id AS project_id, p.name AS project_name,
      o.id AS org_id,     o.name AS org_name, o.color AS org_color
    FROM reminders r
    LEFT JOIN projects      p ON p.id = r.project_id
    LEFT JOIN organizations o ON o.id = p.org_id
    WHERE ${where}
    ORDER BY r.updated_at DESC
    LIMIT 30`, params);

  rows.forEach(r => { r.entity_type = "reminder"; r.labels = []; });
  return rows;
}

router.get("/", async (req, res, next) => {
  try {
    const { q, label_id, type } = req.query;
    const hasQuery = q && q.trim().length >= 1;
    const hasLabel = label_id && /^\d+$/.test(label_id);
    const wantType = ["notes", "story", "todos", "reminders"].includes(type) ? type : null;
    if (!hasQuery && !hasLabel && !wantType) return res.json([]);

    const term = hasQuery ? `%${q.trim()}%` : null;

    // Label filters only apply to notes/story (note_labels is note-specific) —
    // skip todos/reminders entirely rather than silently ignoring the filter.
    const includeTodosReminders = !hasLabel;

    const queries = [];
    if (!wantType || wantType === "notes") queries.push(searchNotes(term, hasLabel, label_id, false));
    if (!wantType || wantType === "story") queries.push(searchNotes(term, hasLabel, label_id, true));
    if (includeTodosReminders && (!wantType || wantType === "todos")) queries.push(searchTodos(term));
    if (includeTodosReminders && (!wantType || wantType === "reminders")) queries.push(searchReminders(term));

    const grouped = await Promise.all(queries);
    const results = grouped.flat().sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

    res.json(results.slice(0, 30));
  } catch (e) { next(e); }
});

module.exports = router;
