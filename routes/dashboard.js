const express = require("express");
const router = express.Router();
const db = require("../database/db");
const cache = require("../lib/cache");

router.get("/", async (req, res, next) => {
  try {
    const payload = await cache.cached("dashboard", 30, () => buildDashboard());
    res.json(payload);
  } catch (e) {
    next(e);
  }
});

async function buildDashboard() {
  // Run all independent queries in parallel
  const [
    stats,
    projects,
    recentNotes,
    topLabels,
    overdueTodos,
    notesPerDay,
    topProjectsByNotes,
  ] = await Promise.all([
    db.one(`
          SELECT
            (SELECT COUNT(*) FROM organizations)                                  AS org_count,
            (SELECT COUNT(*) FROM projects)                                       AS project_count,
            (SELECT COUNT(*) FROM notes)                                          AS note_count,
            (SELECT COUNT(*) FROM todos WHERE status != 'done')                   AS active_todos,
            (SELECT COUNT(*) FROM todos WHERE status  = 'done')                   AS done_todos,
            (SELECT COUNT(*) FROM todos WHERE status != 'done'
               AND due_date IS NOT NULL AND due_date < CURRENT_DATE)              AS overdue_todos,
            (SELECT COUNT(*) FROM todos WHERE status = 'in_progress')             AS in_progress_todos,
            (SELECT COUNT(*) FROM notes
               WHERE created_at >= NOW() - INTERVAL '7 days')                    AS notes_this_week,
            (SELECT COUNT(*) FROM todos WHERE status = 'done'
               AND updated_at >= NOW() - INTERVAL '7 days')                      AS todos_done_this_week,
            (SELECT COUNT(*) FROM ideas)                                          AS ideas_count
        `),
    db.q(`
          SELECT
            p.id, p.name, p.status, p.updated_at, p.description,
            o.id AS org_id, o.name AS org_name, o.color AS org_color,
            COUNT(DISTINCT n.id)                                                  AS note_count,
            COUNT(DISTINCT t.id)                                                  AS todo_total,
            COUNT(DISTINCT CASE WHEN t.status = 'done'        THEN t.id END)     AS todo_done,
            COUNT(DISTINCT CASE WHEN t.status = 'in_progress' THEN t.id END)     AS todo_in_progress,
            COUNT(DISTINCT CASE WHEN t.status != 'done'
                  AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
                  THEN t.id END)                                                  AS todo_overdue,
            (SELECT n2.updated_at FROM notes n2
               WHERE n2.project_id = p.id ORDER BY n2.updated_at DESC LIMIT 1)  AS last_note_at,
            (SELECT n2.title FROM notes n2
               WHERE n2.project_id = p.id ORDER BY n2.updated_at DESC LIMIT 1)  AS last_note_title
          FROM projects p
          JOIN organizations o ON o.id = p.org_id
          LEFT JOIN notes n ON n.project_id = p.id
          LEFT JOIN todos t ON t.project_id = p.id
          GROUP BY p.id, o.id
          ORDER BY p.updated_at DESC
          LIMIT 12
        `),
    db.q(`
          SELECT n.id, n.title, n.tags, n.type, n.updated_at,
            LEFT(n.content, 120) AS excerpt,
            p.id AS project_id, p.name AS project_name,
            o.id AS org_id, o.name AS org_name, o.color AS org_color
          FROM notes n
          JOIN projects p ON p.id = n.project_id
          JOIN organizations o ON o.id = p.org_id
          ORDER BY n.updated_at DESC LIMIT 8
        `),
    db.q(`
          SELECT l.id, l.name, l.color, COUNT(nl.note_id) AS usage
          FROM labels l
          JOIN note_labels nl ON nl.label_id = l.id
          GROUP BY l.id ORDER BY usage DESC LIMIT 8
        `),
    db.q(`
          SELECT t.id, t.title, t.priority, t.due_date,
            p.id AS project_id, p.name AS project_name
          FROM todos t JOIN projects p ON p.id = t.project_id
          WHERE t.status != 'done'
            AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
          ORDER BY t.due_date ASC LIMIT 5
        `),
    db.q(`
          SELECT DATE(created_at)::text AS day, COUNT(*)::int AS count
          FROM notes
          WHERE created_at >= NOW() - INTERVAL '7 days'
          GROUP BY day ORDER BY day
        `),
    db.q(`
          SELECT p.name, COUNT(n.id)::int AS note_count, o.color AS org_color
          FROM projects p
          JOIN organizations o ON o.id = p.org_id
          LEFT JOIN notes n ON n.project_id = p.id
          GROUP BY p.id, p.name, o.color
          ORDER BY note_count DESC LIMIT 6
        `),
  ]);

  // Attach labels to recent notes (depends on recentNotes result)
  if (recentNotes.length) {
    const ids = recentNotes.map((r) => r.id);
    const lblRows = await db.q(
      `SELECT nl.note_id, l.id, l.name, l.color
         FROM note_labels nl JOIN labels l ON l.id = nl.label_id
         WHERE nl.note_id = ANY($1::int[])`,
      [ids],
    );
    const byNote = {};
    lblRows.forEach((l) => {
      (byNote[l.note_id] = byNote[l.note_id] || []).push(l);
    });
    recentNotes.forEach((n) => {
      n.labels = byNote[n.id] || [];
    });
  }

  return {
    stats,
    projects,
    recentNotes,
    topLabels,
    overdueTodos,
    notesPerDay,
    topProjectsByNotes,
  };
}

module.exports = router;
