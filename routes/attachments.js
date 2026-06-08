const express = require("express");
const multer = require("multer");
const router = express.Router();
const db = require("../database/db");
const storage = require("../lib/storage");

// 20 MB limit, memory storage (then we push to MinIO)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    // Block obviously dangerous executables
    const blocked = /\.(exe|sh|bat|cmd|ps1|vbs|jar|msi|dmg|app)$/i;
    if (blocked.test(file.originalname)) {
      return cb(new Error("File type not allowed"));
    }
    cb(null, true);
  },
});

// GET /api/attachments/:noteId  — list attachments for a note
router.get("/:noteId", async (req, res, next) => {
  try {
    const rows = await db.q(
      "SELECT id, filename, original_name, mime_type, size_bytes, object_key, created_at FROM note_attachments WHERE note_id = $1 ORDER BY created_at",
      [req.params.noteId],
    );
    // Attach presigned URLs so the client can download directly
    const items = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        url: await storage.presignedUrl(r.object_key),
      })),
    );
    res.json(items);
  } catch (e) {
    next(e);
  }
});

// POST /api/attachments/:noteId  — upload a file
router.post("/:noteId", upload.single("file"), async (req, res, next) => {
  try {
    if (!storage.isStorageConfigured()) {
      return res
        .status(503)
        .json({
          error:
            "File storage not configured. Set up MinIO in Settings → Storage.",
        });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Verify the note exists
    const note = await db.one("SELECT id FROM notes WHERE id = $1", [
      req.params.noteId,
    ]);
    if (!note) return res.status(404).json({ error: "Note not found" });

    const key = await storage.upload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });

    const row = await db.one(
      `INSERT INTO note_attachments (note_id, filename, original_name, mime_type, size_bytes, object_key)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        req.params.noteId,
        req.file.filename || req.file.originalname,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        key,
      ],
    );
    row.url = await storage.presignedUrl(key);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/attachments/file/:id  — delete a single attachment
router.delete("/file/:id", async (req, res, next) => {
  try {
    const row = await db.one("SELECT * FROM note_attachments WHERE id = $1", [
      req.params.id,
    ]);
    if (!row) return res.status(404).json({ error: "Attachment not found" });

    await storage.remove(row.object_key);
    await db.run("DELETE FROM note_attachments WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
