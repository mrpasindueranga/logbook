const express = require("express");
const router = express.Router();
const db = require("../database/db");
const storage = require("../lib/storage");

async function getSettings() {
  const rows = await db.q("SELECT key, value FROM settings");
  const s = {};
  rows.forEach((r) => {
    s[r.key] = r.value;
  });
  return s;
}

// Apply MinIO config from DB on startup (non-blocking)
getSettings()
  .then((s) => {
    if (s.minio_endpoint) {
      storage.reconfigure({
        endpoint: s.minio_endpoint,
        accessKey: s.minio_access_key,
        secretKey: s.minio_secret_key,
        bucket: s.minio_bucket,
      });
    }
  })
  .catch(() => {});

async function setSetting(key, value) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

async function callOpenAI(messages, settings) {
  const model = settings.ai_model || "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.ai_api_key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 1200,
      temperature: 0.3,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI error");
  return data.choices[0].message.content;
}

async function callOllama(messages, settings) {
  const base = (settings.ollama_url || "http://localhost:11434").replace(
    /\/$/,
    "",
  );
  const model = settings.ai_model || "qwen2.5:0.5b";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error || "Ollama error";
    if (msg.includes("not found"))
      throw new Error(`Model '${model}' not found. Run: ollama pull ${model}`);
    throw new Error(msg);
  }
  return data.message?.content || data.response || "";
}

async function callLLM(messages, settings) {
  if (settings.ai_provider === "openai") return callOpenAI(messages, settings);
  if (settings.ai_provider === "ollama") return callOllama(messages, settings);
  throw new Error("no_ai_configured");
}

router.get("/settings", async (req, res, next) => {
  try {
    const s = await getSettings();
    if (s.ai_api_key && s.ai_api_key.length > 8)
      s.ai_api_key = s.ai_api_key.slice(0, 4) + "…" + s.ai_api_key.slice(-4);
    if (s.minio_secret_key) s.minio_secret_key = "***";
    s._storageConfigured = storage.isStorageConfigured();
    res.json(s);
  } catch (e) {
    next(e);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    const allowed = [
      "ai_provider",
      "ai_model",
      "ai_api_key",
      "ollama_url",
      "user_name",
      "minio_endpoint",
      "minio_bucket",
      "minio_access_key",
      "minio_secret_key",
      "theme",
      "accent_color",
    ];
    for (const k of allowed) {
      if (req.body[k] !== undefined) await setSetting(k, req.body[k]);
    }
    // Apply MinIO config immediately so uploads work without restart
    if (req.body.minio_endpoint !== undefined) {
      storage.reconfigure({
        endpoint: req.body.minio_endpoint || "",
        accessKey: req.body.minio_access_key,
        secretKey: req.body.minio_secret_key,
        bucket: req.body.minio_bucket,
      });
    }
    res.json({ message: "Settings saved" });
  } catch (e) {
    next(e);
  }
});

const DB_SCHEMA = `
Tables:
  organizations(id, name, description, color, created_at, updated_at)
  projects(id, org_id, name, description, status -- 'active'/'archived', color, created_at, updated_at)
  notes(id, project_id, title, content, tags -- JSON array string, pinned 0/1, type, created_at, updated_at)
  todos(id, project_id, title, status -- 'todo'/'in_progress'/'done', priority -- 'low'/'medium'/'high', due_date DATE, position, created_at, updated_at)
  ideas(id, project_id, text, source, created_at)
  reminders(id, title, note, remind_at TIMESTAMPTZ, entity_type, entity_id, project_id, is_done 0/1, created_at, updated_at)
  labels(id, name, color)
  note_labels(note_id, label_id)
  activity_log(id, entity_type, entity_id, entity_name, project_id, org_id, action, meta -- JSON string, created_at)

Foreign keys: projects.org_id → organizations.id, notes.project_id → projects.id,
  todos.project_id → projects.id, ideas.project_id → projects.id,
  reminders.project_id → projects.id, note_labels.note_id → notes.id,
  note_labels.label_id → labels.id

Use ILIKE for case-insensitive text search. Current timestamp: NOW().
`;

// Forbidden SQL keywords that must never appear (read-only guard)
const SQL_WRITE_RE =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXEC|EXECUTE|VACUUM|ANALYZE)\b/i;

router.post("/ask", async (req, res, next) => {
  try {
    const { question, project_id } = req.body;
    if (!question?.trim())
      return res.status(400).json({ error: "question is required" });

    const settings = await getSettings();

    if (!settings.ai_provider) {
      return res.json({
        answer: null,
        sources: [],
        hint: "Configure AI in Settings to get smart answers.",
      });
    }

    // ── Step 1: Ask the AI to generate a SELECT query ────────────────────────
    const projectScope = project_id
      ? `\nIMPORTANT: Scope all queries to project_id = ${parseInt(project_id, 10)} unless the question clearly asks across all projects.`
      : "";

    const sqlMessages = [
      {
        role: "system",
        content: `You are a PostgreSQL query generator for a personal logbook app.
Given a user question, output a single read-only SELECT query that fetches the data needed to answer it.
Rules:
- Output ONLY the raw SQL — no markdown fences, no explanation, no comments.
- Only SELECT statements are allowed (WITH ... SELECT is fine for CTEs).
- Always add LIMIT 30 unless the question asks for a count or aggregate.
- Use ILIKE for case-insensitive text searches.
- When querying notes, always include: id, title, LEFT(content,800) AS content, updated_at, and JOIN projects/organizations for project_name and org_name.
- If unsure, query notes and todos together with UNION or two columns.${projectScope}

Schema:
${DB_SCHEMA}`,
      },
      { role: "user", content: question },
    ];

    let sqlQuery;
    try {
      sqlQuery = (await callLLM(sqlMessages, settings)).trim();
    } catch (e) {
      if (e.message === "no_ai_configured")
        return res.json({
          answer: null,
          sources: [],
          hint: "Configure AI in Settings.",
        });
      throw e;
    }

    // Strip accidental markdown fences
    sqlQuery = sqlQuery
      .replace(/^```(?:sql)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    // ── Security: reject any write/DDL keywords ───────────────────────────────
    const firstWord = sqlQuery
      .replace(/\s+/g, " ")
      .trimStart()
      .split(" ")[0]
      .toUpperCase();
    if (
      !["SELECT", "WITH"].includes(firstWord) ||
      SQL_WRITE_RE.test(sqlQuery)
    ) {
      return res.json({
        answer: "I can only read data from your logbook, not modify it.",
        sources: [],
      });
    }

    // Ensure a LIMIT is present
    if (!/\bLIMIT\b/i.test(sqlQuery)) sqlQuery += " LIMIT 30";

    // ── Step 2: Execute the query ─────────────────────────────────────────────
    let rows;
    try {
      rows = await db.q(sqlQuery);
    } catch (_dbErr) {
      // AI generated invalid SQL — fall back to a simple recent-notes fetch
      const fallbackParams = project_id ? [project_id] : [];
      rows = await db.q(
        `SELECT n.id, n.title, LEFT(n.content, 800) AS content, n.updated_at,
            p.name AS project_name, o.name AS org_name
          FROM notes n
          JOIN projects p ON p.id = n.project_id
          JOIN organizations o ON o.id = p.org_id
          ${project_id ? "WHERE n.project_id = $1" : ""}
          ORDER BY n.updated_at DESC LIMIT 10`,
        fallbackParams,
      );
    }

    // ── Step 3: Ask the AI to answer from the query results ───────────────────
    const resultText = rows.length
      ? JSON.stringify(rows, null, 2)
      : "No rows returned.";

    const answerMessages = [
      {
        role: "system",
        content: `You are an assistant for a software engineer's personal logbook.
Answer the question concisely based ONLY on the database results provided below.
Do NOT use any outside knowledge, training data, or general information.
If the results are empty or unrelated to the question, respond with: "I don't have any data about that."
When referencing notes or todos, mention their title.`,
      },
      {
        role: "user",
        content: `Database results:\n${resultText}\n\n---\nQuestion: ${question}`,
      },
    ];

    const answer = await callLLM(answerMessages, settings);

    // Extract note-shaped rows as sources for the UI
    const sources = rows
      .filter((r) => r.id && r.title)
      .slice(0, 6)
      .map((r) => ({
        id: r.id,
        title: r.title,
        project_name: r.project_name || "",
        org_name: r.org_name || "",
        updated_at: r.updated_at || null,
      }));

    res.json({ answer, sources });
  } catch (e) {
    next(e);
  }
});

router.post("/summarize/:noteId", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [
      req.params.noteId,
    ]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    if (note.type === "sketch")
      return res
        .status(400)
        .json({ error: "AI features aren't available for sketch notes yet" });
    const settings = await getSettings();
    if (!settings.ai_provider)
      return res.status(400).json({ error: "AI not configured" });
    const messages = [
      {
        role: "system",
        content:
          "You are a technical writing assistant. Summarize the given note in 2-4 concise bullet points. Focus on key information and action items.",
      },
      { role: "user", content: `Title: ${note.title}\n\n${note.content}` },
    ];
    const summary = await callLLM(messages, settings);
    res.json({ summary });
  } catch (e) {
    next(e);
  }
});

router.post("/suggest-tags/:noteId", async (req, res, next) => {
  try {
    const note = await db.one("SELECT * FROM notes WHERE id = $1", [
      req.params.noteId,
    ]);
    if (!note) return res.status(404).json({ error: "Note not found" });
    if (note.type === "sketch")
      return res
        .status(400)
        .json({ error: "AI features aren't available for sketch notes yet" });
    const settings = await getSettings();
    if (!settings.ai_provider)
      return res.status(400).json({ error: "AI not configured" });
    const messages = [
      {
        role: "system",
        content:
          "You are a tagging assistant. Return a JSON array of 3-5 short lowercase tags (max 2 words each) for the given note. Output only the JSON array, no other text.",
      },
      {
        role: "user",
        content: `Title: ${note.title}\n\n${note.content.slice(0, 1000)}`,
      },
    ];
    const raw = await callLLM(messages, settings);
    const tags = JSON.parse(raw.match(/\[.*\]/s)?.[0] || "[]");
    res.json({ tags });
  } catch (e) {
    next(e);
  }
});

router.post("/suggest-ideas/:projectId", async (req, res, next) => {
  try {
    const proj = await db.one("SELECT * FROM projects WHERE id = $1", [
      req.params.projectId,
    ]);
    if (!proj) return res.status(404).json({ error: "Project not found" });
    const settings = await getSettings();
    if (!settings.ai_provider)
      return res.status(400).json({ error: "AI not configured" });

    const recentNotes = await db.q(
      "SELECT title, LEFT(content,400) AS content FROM notes WHERE project_id=$1 AND type != 'sketch' ORDER BY updated_at DESC LIMIT 5",
      [proj.id],
    );
    const context = recentNotes
      .map((n) => `- ${n.title}: ${n.content}`)
      .join("\n");
    const messages = [
      {
        role: "system",
        content:
          "You are a project planning assistant. Generate 5 actionable ideas or backlog items for the given software project. Output a JSON array of strings only.",
      },
      {
        role: "user",
        content: `Project: ${proj.name}\n\nRecent notes:\n${context || "No notes yet."}`,
      },
    ];
    const raw = await callLLM(messages, settings);
    const ideas = JSON.parse(raw.match(/\[.*\]/s)?.[0] || "[]");
    res.json({ ideas });
  } catch (e) {
    next(e);
  }
});

// POST /api/ai/grammar-check  — grammar & clarity check for note content
router.post("/grammar-check", async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim())
      return res.status(400).json({ error: "text is required" });

    const settings = await getSettings();
    if (!settings.ai_provider)
      return res.status(400).json({ error: "AI not configured" });

    const messages = [
      {
        role: "system",
        content: `You are a professional editor. Review the given text for grammar, spelling, punctuation, and clarity issues.
Return a JSON object with this exact shape:
{
  "issues": [
    { "original": "...", "suggestion": "...", "reason": "..." }
  ],
  "corrected": "...full corrected text...",
  "summary": "...one sentence summary of changes made..."
}
If there are no issues, return { "issues": [], "corrected": "...same text...", "summary": "No issues found." }
Output only the JSON, no other text.`,
      },
      { role: "user", content: text.slice(0, 4000) },
    ];

    const raw = await callLLM(messages, settings);
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || "{}");
    res.json({
      issues: parsed.issues || [],
      corrected: parsed.corrected || text,
      summary: parsed.summary || "No issues found.",
    });
  } catch (e) {
    if (e.message === "no_ai_configured")
      return res.status(400).json({ error: "AI not configured" });
    next(e);
  }
});

module.exports = router;
