const express = require("express");
const router = express.Router();
const db = require("../database/db");

/** Format a JS Date to iCal DATETIME string (UTC). */
function icsDatetime(date) {
  return new Date(date)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/** Format a JS Date to iCal DATE string (YYYYMMDD). */
function icsDateOnly(dateStr) {
  return String(dateStr).replace(/-/g, "").slice(0, 8);
}

/** Escape special iCal characters in text values. */
function icsEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold iCal lines to a maximum of 75 octets per RFC 5545. */
function foldLine(line) {
  const out = [];
  while (line.length > 75) {
    out.push(line.slice(0, 75));
    line = " " + line.slice(75);
  }
  out.push(line);
  return out.join("\r\n");
}

/**
 * GET /api/calendar/feed.ics
 * Returns an iCal feed containing all todos with due dates and all reminders.
 */
router.get("/feed.ics", async (req, res, next) => {
  try {
    const [todos, reminders] = await Promise.all([
      db.q(`
        SELECT t.*, p.name AS project_name, o.name AS org_name
        FROM todos t
        JOIN projects      p ON p.id = t.project_id
        JOIN organizations o ON o.id = p.org_id
        WHERE t.due_date IS NOT NULL
        ORDER BY t.due_date ASC
      `),
      db.q(`
        SELECT r.*, p.name AS project_name, o.name AS org_name
        FROM reminders r
        LEFT JOIN projects      p ON p.id = r.project_id
        LEFT JOIN organizations o ON o.id = p.org_id
        ORDER BY r.remind_at ASC
      `),
    ]);

    const dtstamp = icsDatetime(new Date());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Logbook//Logbook Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Logbook",
      "X-WR-TIMEZONE:UTC",
    ];

    // ── Todos → VTODO ────────────────────────────────────────────────────────
    const statusMap = {
      todo: "NEEDS-ACTION",
      in_progress: "IN-PROCESS",
      done: "COMPLETED",
    };
    const prioMap = { high: 1, medium: 5, low: 9 };

    for (const t of todos) {
      const summary = icsEscape(`[${t.project_name}] ${t.title}`);
      const desc = icsEscape(
        `Project: ${t.project_name} | Org: ${t.org_name} | Priority: ${t.priority} | Status: ${t.status}`,
      );
      lines.push(
        "BEGIN:VTODO",
        `UID:todo-${t.id}@logbook`,
        `DTSTAMP:${dtstamp}`,
        `CREATED:${icsDatetime(t.created_at)}`,
        `LAST-MODIFIED:${icsDatetime(t.updated_at)}`,
        foldLine(`SUMMARY:${summary}`),
        `DUE;VALUE=DATE:${icsDateOnly(t.due_date)}`,
        `STATUS:${statusMap[t.status] || "NEEDS-ACTION"}`,
        `PRIORITY:${prioMap[t.priority] || 5}`,
        foldLine(`DESCRIPTION:${desc}`),
        "END:VTODO",
      );
    }

    // ── Reminders → VEVENT with VALARM ───────────────────────────────────────
    for (const r of reminders) {
      const dtstart = icsDatetime(r.remind_at);
      // 30-minute default duration
      const dtend = icsDatetime(
        new Date(new Date(r.remind_at).getTime() + 30 * 60 * 1000),
      );
      const summary = icsEscape(`🔔 ${r.title}`);
      const desc = icsEscape(
        [r.note, r.project_name ? `Project: ${r.project_name}` : ""]
          .filter(Boolean)
          .join(" | "),
      );

      lines.push(
        "BEGIN:VEVENT",
        `UID:reminder-${r.id}@logbook`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${dtstart}`,
        `DTEND:${dtend}`,
        `CREATED:${icsDatetime(r.created_at)}`,
        `LAST-MODIFIED:${icsDatetime(r.updated_at)}`,
        foldLine(`SUMMARY:${summary}`),
      );
      if (desc) lines.push(foldLine(`DESCRIPTION:${desc}`));
      if (r.project_name)
        lines.push(foldLine(`LOCATION:${icsEscape(r.project_name)}`));
      if (r.is_done) lines.push("STATUS:CONFIRMED\r\nTRANSP:TRANSPARENT");
      // Pop-up alert at the event time
      lines.push(
        "BEGIN:VALARM",
        "TRIGGER:-PT0M",
        "ACTION:DISPLAY",
        foldLine(`DESCRIPTION:${icsEscape(r.title)}`),
        "END:VALARM",
        "END:VEVENT",
      );
    }

    lines.push("END:VCALENDAR");

    const body = lines.join("\r\n");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="logbook.ics"');
    res.setHeader("Cache-Control", "no-cache");
    res.send(body);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
