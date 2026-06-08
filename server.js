const express = require("express");
const path = require("path");
const fs = require("fs");
const db = require("./database/db");
const storage = require("./lib/storage");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || "").replace(/\/+$/, "");

app.use(express.json());

// ── API routes ────────────────────────────────────────────────────────────────
app.use(`${BASE_PATH}/api/organizations`, require("./routes/organizations"));
app.use(`${BASE_PATH}/api/sections`, require("./routes/sections"));
app.use(`${BASE_PATH}/api/projects`, require("./routes/projects"));
app.use(`${BASE_PATH}/api/notes`, require("./routes/notes"));
app.use(`${BASE_PATH}/api/todos`, require("./routes/todos"));
app.use(`${BASE_PATH}/api/activity`, require("./routes/activity"));
app.use(`${BASE_PATH}/api/ai`, require("./routes/ai"));
app.use(`${BASE_PATH}/api/dashboard`, require("./routes/dashboard"));
app.use(`${BASE_PATH}/api/search`, require("./routes/search"));
app.use(`${BASE_PATH}/api/labels`, require("./routes/labels"));
app.use(`${BASE_PATH}/api/ideas`, require("./routes/ideas"));
app.use(`${BASE_PATH}/api/attachments`, require("./routes/attachments"));
app.use(`${BASE_PATH}/api/reminders`, require("./routes/reminders"));
app.use(`${BASE_PATH}/api/calendar`, require("./routes/calendar"));
app.use(`${BASE_PATH}/api/transfer`, require("./routes/transfer"));

app.use(`${BASE_PATH}/api`, (req, res) =>
  res.status(404).json({ error: "API endpoint not found" }),
);

// ── Static assets ─────────────────────────────────────────────────────────────
const PUBLIC = path.join(__dirname, "public");
app.use(BASE_PATH || "/", express.static(PUBLIC, { index: false }));

let _cachedHtml = null;
function serveApp(req, res) {
  if (!_cachedHtml) {
    const raw = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
    _cachedHtml = raw
      .replace(/__BASE_PATH_JSON__/g, JSON.stringify(BASE_PATH))
      .replace(/__ASSET_BASE_PATH__/g, BASE_PATH);
  }
  res.setHeader("Content-Type", "text/html");
  res.send(_cachedHtml);
}
app.get(BASE_PATH ? `${BASE_PATH}` : "/", serveApp);
app.get(BASE_PATH ? `${BASE_PATH}/*` : "/*", serveApp);

// ── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start after schema init ───────────────────────────────────────────────────
Promise.all([
  db.init(),
  storage.ensureBucket().catch((e) => console.warn("⚠  MinIO:", e.message)),
])
  .then(() => {
    app.listen(PORT, () =>
      console.log(`✓  Logbook  →  http://localhost:${PORT}${BASE_PATH || "/"}`),
    );
  })
  .catch((err) => {
    console.error("❌  Failed to initialise database:", err.message);
    process.exit(1);
  });
