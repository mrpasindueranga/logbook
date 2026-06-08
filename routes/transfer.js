const express = require("express");
const router = express.Router();
const db = require("../database/db");
const storage = require("../lib/storage");
const AdmZip = require("adm-zip");
const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

const EXPORT_VERSION = 1;

// ─── Shared data-fetch helper ─────────────────────────────────────────────────
async function _buildPayload(scope, id) {
  let orgWhere = "",
    projWhere = "";
  const orgParams = [],
    projParams = [];

  if (scope === "org" && id) {
    orgWhere = "WHERE id = $1";
    orgParams.push(id);
    projWhere = "WHERE org_id = $1";
    projParams.push(id);
  } else if (scope === "project" && id) {
    projWhere = "WHERE p.id = $1";
    projParams.push(id);
  }

  const orgs =
    scope === "project" && id
      ? await db.q(
          "SELECT o.id, o.name, o.description, o.color FROM organizations o JOIN projects p ON p.org_id = o.id WHERE p.id = $1",
          [id],
        )
      : await db.q(
          `SELECT id, name, description, color FROM organizations ${orgWhere} ORDER BY id`,
          orgParams,
        );

  const projects = projParams.length
    ? await db.q(
        `SELECT p.id, p.org_id, p.name, p.description, p.status, p.color FROM projects p ${projWhere} ORDER BY p.id`,
        projParams,
      )
    : await db.q(
        "SELECT id, org_id, name, description, status, color FROM projects ORDER BY id",
      );

  const pIds = projects.map((p) => p.id);

  const [notes, todos, ideas] = pIds.length
    ? await Promise.all([
        db.q(
          "SELECT id, project_id, title, content, tags, pinned, type, created_at FROM notes WHERE project_id = ANY($1::int[]) ORDER BY id",
          [pIds],
        ),
        db.q(
          "SELECT id, project_id, title, status, priority, due_date, position FROM todos WHERE project_id = ANY($1::int[]) ORDER BY position, id",
          [pIds],
        ),
        db.q(
          "SELECT id, project_id, text, source FROM ideas WHERE project_id = ANY($1::int[]) ORDER BY id",
          [pIds],
        ),
      ])
    : [[], [], []];

  const nIds = notes.map((n) => n.id);
  const noteLabelRows = nIds.length
    ? await db.q(
        "SELECT note_id, label_id FROM note_labels WHERE note_id = ANY($1::int[])",
        [nIds],
      )
    : [];

  const labelIds = [...new Set(noteLabelRows.map((r) => r.label_id))];
  const labels = labelIds.length
    ? await db.q(
        "SELECT id, name, color FROM labels WHERE id = ANY($1::int[])",
        [labelIds],
      )
    : scope === "all"
      ? await db.q("SELECT id, name, color FROM labels ORDER BY id")
      : [];

  const reminders = pIds.length
    ? await db.q(
        "SELECT id, title, note, remind_at, entity_type, project_id FROM reminders WHERE project_id = ANY($1::int[]) ORDER BY remind_at",
        [pIds],
      )
    : scope === "all"
      ? await db.q(
          "SELECT id, title, note, remind_at, entity_type, project_id FROM reminders ORDER BY remind_at",
        )
      : [];

  // Attachments (metadata only — files included separately in ZIP)
  const attachments = nIds.length
    ? await db.q(
        "SELECT id, note_id, filename, original_name, mime_type, size_bytes, object_key FROM note_attachments WHERE note_id = ANY($1::int[]) ORDER BY id",
        [nIds],
      )
    : [];

  return {
    orgs,
    projects,
    notes,
    todos,
    ideas,
    labels,
    noteLabelRows,
    reminders,
    attachments,
    pIds,
    nIds,
  };
}

// ── GET /api/transfer/export?scope=all|project|org&id=N&format=json|zip ──────
router.get("/export", async (req, res, next) => {
  try {
    const scope = req.query.scope || "all";
    const id = req.query.id ? parseInt(req.query.id, 10) : null;
    const format = req.query.format === "zip" ? "zip" : "json";

    const {
      orgs,
      projects,
      notes,
      todos,
      ideas,
      labels,
      noteLabelRows,
      reminders,
      attachments,
    } = await _buildPayload(scope, id);

    // Give each attachment a deterministic path inside the ZIP
    const attachMeta = attachments.map((a) => ({
      note_id: a.note_id,
      filename: a.filename,
      original_name: a.original_name,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      zip_path: `files/${a.id}_${a.original_name.replace(/[^\w.-]/g, "_")}`,
    }));

    const manifest = {
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      scope,
      organizations: orgs,
      projects,
      notes,
      todos,
      ideas,
      labels,
      note_labels: noteLabelRows,
      reminders,
      attachments: attachMeta,
    };

    const date = new Date().toISOString().slice(0, 10);
    const basename = id ? `logbook-${scope}-${id}-${date}` : `logbook-${date}`;

    if (format === "json") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${basename}.json"`,
      );
      return res.json(manifest);
    }

    // ZIP — include logbook.json + all attachment files fetched from MinIO
    const zip = new AdmZip();
    zip.addFile(
      "logbook.json",
      Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
    );

    if (storage.isStorageConfigured()) {
      await Promise.allSettled(
        attachments.map(async (a, i) => {
          try {
            const buf = await storage.getBuffer(a.object_key);
            zip.addFile(attachMeta[i].zip_path, buf);
          } catch (_) {
            /* skip missing objects */
          }
        }),
      );
    }

    const zipBuf = zip.toBuffer();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${basename}.zip"`,
    );
    res.setHeader("Content-Length", zipBuf.length);
    res.send(zipBuf);
  } catch (e) {
    next(e);
  }
});

// ── GET /api/transfer/note/:id/markdown ───────────────────────────────────────
router.get("/note/:id/markdown", async (req, res, next) => {
  try {
    const note = await db.one(
      `SELECT n.*, p.name AS project_name, o.name AS org_name
       FROM notes n
       JOIN projects p ON p.id = n.project_id
       JOIN organizations o ON o.id = p.org_id
       WHERE n.id = $1`,
      [req.params.id],
    );
    if (!note) return res.status(404).json({ error: "Note not found" });

    const labelRows = await db.q(
      "SELECT l.name FROM labels l JOIN note_labels nl ON nl.label_id = l.id WHERE nl.note_id = $1",
      [note.id],
    );

    let tags = [];
    try {
      tags = JSON.parse(note.tags || "[]");
    } catch (_) {}

    const frontLines = [
      "---",
      `title: "${note.title.replace(/"/g, '\\"')}"`,
      `project: "${note.project_name}"`,
      `organization: "${note.org_name}"`,
      `type: ${note.type}`,
    ];
    if (tags.length)
      frontLines.push(`tags: [${tags.map((t) => `"${t}"`).join(", ")}]`);
    if (labelRows.length)
      frontLines.push(
        `labels: [${labelRows.map((l) => `"${l.name}"`).join(", ")}]`,
      );
    frontLines.push(
      `created: ${note.created_at.toISOString()}`,
      `updated: ${note.updated_at.toISOString()}`,
      "---",
      "",
      `# ${note.title}`,
      "",
    );

    const md = frontLines.join("\n") + note.content;
    const slug = note.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 60)
      .replace(/-+$/, "");

    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${slug}.md"`);
    res.send(md);
  } catch (e) {
    next(e);
  }
});

// ── POST /api/transfer/import  (accepts .json OR .zip) ───────────────────────
router.post("/import", upload.single("file"), async (req, res, next) => {
  const client = await db.pool.connect();
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const isZip = req.file.originalname.toLowerCase().endsWith(".zip");
    let payload,
      zipEntries = {};

    if (isZip) {
      let zip;
      try {
        zip = new AdmZip(req.file.buffer);
      } catch (_) {
        return res.status(400).json({ error: "Could not open ZIP file" });
      }
      const jsonEntry = zip.getEntry("logbook.json");
      if (!jsonEntry)
        return res
          .status(400)
          .json({ error: "ZIP does not contain logbook.json" });
      try {
        payload = JSON.parse(jsonEntry.getData().toString("utf8"));
      } catch (_) {
        return res
          .status(400)
          .json({ error: "logbook.json in ZIP is not valid JSON" });
      }
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory) zipEntries[entry.entryName] = entry.getData();
      }
    } else {
      try {
        payload = JSON.parse(req.file.buffer.toString("utf8"));
      } catch (_) {
        return res
          .status(400)
          .json({ error: "Invalid JSON — file could not be parsed" });
      }
    }

    if (payload.version !== EXPORT_VERSION) {
      return res
        .status(400)
        .json({ error: `Unsupported export version: ${payload.version}` });
    }

    const {
      organizations = [],
      projects = [],
      notes = [],
      todos = [],
      ideas = [],
      labels = [],
      note_labels = [],
      reminders = [],
      attachments = [],
    } = payload;

    await client.query("BEGIN");

    const orgMap = {},
      projMap = {},
      noteMap = {},
      labelMap = {};

    // Labels — merge by name
    for (const l of labels) {
      const ex = await client.query("SELECT id FROM labels WHERE name = $1", [
        l.name,
      ]);
      if (ex.rows.length) {
        labelMap[l.id] = ex.rows[0].id;
      } else {
        const r = await client.query(
          "INSERT INTO labels(name, color) VALUES($1,$2) RETURNING id",
          [l.name, l.color || "#3b82f6"],
        );
        labelMap[l.id] = r.rows[0].id;
      }
    }

    // Organizations — merge by name
    for (const o of organizations) {
      const ex = await client.query(
        "SELECT id FROM organizations WHERE name = $1",
        [o.name],
      );
      if (ex.rows.length) {
        orgMap[o.id] = ex.rows[0].id;
      } else {
        const r = await client.query(
          "INSERT INTO organizations(name, description, color) VALUES($1,$2,$3) RETURNING id",
          [o.name, o.description || "", o.color || "#6366f1"],
        );
        orgMap[o.id] = r.rows[0].id;
      }
    }

    // Projects — merge by (name, org_id)
    for (const p of projects) {
      const newOrgId = orgMap[p.org_id];
      if (!newOrgId) continue;
      const ex = await client.query(
        "SELECT id FROM projects WHERE name = $1 AND org_id = $2",
        [p.name, newOrgId],
      );
      if (ex.rows.length) {
        projMap[p.id] = ex.rows[0].id;
      } else {
        const r = await client.query(
          "INSERT INTO projects(org_id, name, description, status, color) VALUES($1,$2,$3,$4,$5) RETURNING id",
          [
            newOrgId,
            p.name,
            p.description || "",
            p.status || "active",
            p.color || "#818cf8",
          ],
        );
        projMap[p.id] = r.rows[0].id;
      }
    }

    // Notes — always create new
    for (const n of notes) {
      const newProjId = projMap[n.project_id];
      if (!newProjId) continue;
      const r = await client.query(
        "INSERT INTO notes(project_id, title, content, tags, pinned, type) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [
          newProjId,
          n.title,
          n.content || "",
          n.tags || "[]",
          n.pinned || 0,
          n.type || "descriptive",
        ],
      );
      noteMap[n.id] = r.rows[0].id;
    }

    // Todos — always create new
    for (const t of todos) {
      const newProjId = projMap[t.project_id];
      if (!newProjId) continue;
      await client.query(
        "INSERT INTO todos(project_id, title, status, priority, due_date, position) VALUES($1,$2,$3,$4,$5,$6)",
        [
          newProjId,
          t.title,
          t.status || "todo",
          t.priority || "medium",
          t.due_date || null,
          t.position || 0,
        ],
      );
    }

    // Ideas — always create new
    for (const i of ideas) {
      const newProjId = projMap[i.project_id];
      if (!newProjId) continue;
      await client.query(
        "INSERT INTO ideas(project_id, text, source) VALUES($1,$2,$3)",
        [newProjId, i.text, i.source || "manual"],
      );
    }

    // Note labels
    for (const nl of note_labels) {
      const newNoteId = noteMap[nl.note_id];
      const newLabelId = labelMap[nl.label_id];
      if (!newNoteId || !newLabelId) continue;
      await client.query(
        "INSERT INTO note_labels(note_id, label_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [newNoteId, newLabelId],
      );
    }

    // Reminders
    for (const r of reminders) {
      const newProjId = r.project_id ? projMap[r.project_id] : null;
      if (r.project_id && !newProjId) continue;
      await client.query(
        "INSERT INTO reminders(title, note, remind_at, entity_type, project_id) VALUES($1,$2,$3,$4,$5)",
        [
          r.title,
          r.note || "",
          r.remind_at,
          r.entity_type || "standalone",
          newProjId || null,
        ],
      );
    }

    // Attachments from ZIP — upload to MinIO then record in DB
    let attachImported = 0;
    if (isZip && attachments.length && storage.isStorageConfigured()) {
      for (const a of attachments) {
        const newNoteId = noteMap[a.note_id];
        if (!newNoteId || !a.zip_path) continue;
        const fileBuf = zipEntries[a.zip_path];
        if (!fileBuf) continue;
        try {
          const key = await storage.upload({
            buffer: fileBuf,
            originalName: a.original_name,
            mimeType: a.mime_type || "application/octet-stream",
          });
          await client.query(
            "INSERT INTO note_attachments(note_id,filename,original_name,mime_type,size_bytes,object_key) VALUES($1,$2,$3,$4,$5,$6)",
            [
              newNoteId,
              a.filename,
              a.original_name,
              a.mime_type,
              a.size_bytes || fileBuf.length,
              key,
            ],
          );
          attachImported++;
        } catch (_) {
          /* skip individual failures */
        }
      }
    }

    await client.query("COMMIT");

    res.json({
      message: "Import successful",
      counts: {
        organizations: Object.keys(orgMap).length,
        projects: Object.keys(projMap).length,
        notes: Object.keys(noteMap).length,
        todos: todos.filter((t) => projMap[t.project_id]).length,
        ideas: ideas.filter((i) => projMap[i.project_id]).length,
        labels: Object.keys(labelMap).length,
        reminders: reminders.filter(
          (r) => !r.project_id || projMap[r.project_id],
        ).length,
        attachments: attachImported,
      },
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    next(e);
  } finally {
    client.release();
  }
});

module.exports = router;
