// ─── Rich text toolbar: text color, inline drawings, handwritten toggle ───────
// Shared across the Notes, Story, Todo, and Reminder text editors. Existing
// per-surface toolbar logic (ins() for notes, _storyTb* for story) is left
// untouched — this module only adds the three new capabilities, generically,
// so Todos/Reminders (which have no toolbar at all yet) can get a full one.

const RICH_COLORS = [
  "#1e1e1e",
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#f08c00",
  "#9c36b5",
];

const _richSurfaces = {}; // surfaceId -> { textareaId, entityType, getEntityId, onChange }
const _richHandwritten = {}; // surfaceId -> boolean (local UI state until saved)
const _sketchCache = new Map(); // sketch id (string) -> {id, entity_type, entity_id, elements}

function registerRichSurface(surfaceId, cfg) {
  _richSurfaces[surfaceId] = cfg;
  _richHandwritten[surfaceId] = !!cfg.handwritten;
}

function isRichHandwritten(surfaceId) {
  return !!_richHandwritten[surfaceId];
}

function _richTa(surfaceId) {
  const cfg = _richSurfaces[surfaceId];
  return cfg ? document.getElementById(cfg.textareaId) : null;
}

function _richChanged(surfaceId) {
  const cfg = _richSurfaces[surfaceId];
  if (cfg && typeof cfg.onChange === "function") cfg.onChange();
}

// ── Cursor-aware insertion primitives ─────────────────────────────────────────
function richInsertAtCursor(surfaceId, text) {
  const ta = _richTa(surfaceId);
  if (!ta) return;
  const pos = ta.selectionStart;
  ta.value = ta.value.slice(0, pos) + text + ta.value.slice(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = pos + text.length;
  ta.focus();
  _richChanged(surfaceId);
}

function richWrapSelection(surfaceId, before, after, placeholder) {
  const ta = _richTa(surfaceId);
  if (!ta) return;
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.substring(s, e) || placeholder;
  ta.value = ta.value.slice(0, s) + before + sel + after + ta.value.slice(e);
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  ta.focus();
  _richChanged(surfaceId);
}

function richLinePrefix(surfaceId, prefix) {
  const ta = _richTa(surfaceId);
  if (!ta) return;
  const pos = ta.selectionStart;
  const lStart = ta.value.lastIndexOf("\n", pos - 1) + 1;
  ta.value = ta.value.slice(0, lStart) + prefix + ta.value.slice(lStart);
  ta.selectionStart = ta.selectionEnd = pos + prefix.length;
  ta.focus();
  _richChanged(surfaceId);
}

// Full formatting dispatch — used by the "full" toolbar (Todos/Reminders today)
function richIns(surfaceId, type) {
  switch (type) {
    case "bold":
      return richWrapSelection(surfaceId, "**", "**", "bold text");
    case "italic":
      return richWrapSelection(surfaceId, "*", "*", "italic text");
    case "strike":
      return richWrapSelection(surfaceId, "~~", "~~", "text");
    case "code":
      return richWrapSelection(surfaceId, "`", "`", "code");
    case "codeblock":
      return richWrapSelection(surfaceId, "\n```\n", "\n```\n", "code");
    case "link":
      return richWrapSelection(surfaceId, "[", "](url)", "link text");
    case "hr":
      return richInsertAtCursor(surfaceId, "\n---\n");
    case "h1":
      return richLinePrefix(surfaceId, "# ");
    case "h2":
      return richLinePrefix(surfaceId, "## ");
    case "h3":
      return richLinePrefix(surfaceId, "### ");
    case "ul":
      return richLinePrefix(surfaceId, "- ");
    case "ol":
      return richLinePrefix(surfaceId, "1. ");
    case "quote":
      return richLinePrefix(surfaceId, "> ");
  }
}

function richColor(surfaceId, hex) {
  richWrapSelection(surfaceId, `<span style="color:${hex}">`, "</span>", "colored text");
}

function richToggleHandwritten(surfaceId) {
  _richHandwritten[surfaceId] = !_richHandwritten[surfaceId];
  document
    .querySelectorAll(`[data-hw-toggle="${surfaceId}"]`)
    .forEach((b) => b.classList.toggle("on", _richHandwritten[surfaceId]));
  _richChanged(surfaceId);
}

// ── Toolbar HTML ───────────────────────────────────────────────────────────────
function richToolbarHtml(surfaceId, opts) {
  opts = opts || {};
  const full = !!opts.full;
  const formatButtons = full
    ? `
    <button type="button" class="tb-btn" title="Bold" onclick="richIns('${surfaceId}','bold')"><b>B</b></button>
    <button type="button" class="tb-btn" title="Italic" onclick="richIns('${surfaceId}','italic')"><i>I</i></button>
    <button type="button" class="tb-btn" title="Strikethrough" onclick="richIns('${surfaceId}','strike')"><s>S</s></button>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn" title="Heading 1" onclick="richIns('${surfaceId}','h1')">H1</button>
    <button type="button" class="tb-btn" title="Heading 2" onclick="richIns('${surfaceId}','h2')">H2</button>
    <button type="button" class="tb-btn" title="Heading 3" onclick="richIns('${surfaceId}','h3')">H3</button>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn" title="Bullet list" onclick="richIns('${surfaceId}','ul')">• List</button>
    <button type="button" class="tb-btn" title="Ordered list" onclick="richIns('${surfaceId}','ol')">1. List</button>
    <button type="button" class="tb-btn" title="Blockquote" onclick="richIns('${surfaceId}','quote')">❝</button>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn" title="Inline code" onclick="richIns('${surfaceId}','code')">\`code\`</button>
    <button type="button" class="tb-btn" title="Link" onclick="richIns('${surfaceId}','link')">🔗</button>
    <button type="button" class="tb-btn" title="Horizontal rule" onclick="richIns('${surfaceId}','hr')">—</button>
    <div class="tb-sep"></div>`
    : "";

  return `
    ${formatButtons}
    <div class="tb-color-group">
      ${RICH_COLORS.map(
        (c) =>
          `<button type="button" class="rich-color-swatch" style="background:${c}" title="Color text ${c}" onclick="richColor('${surfaceId}','${c}')"></button>`,
      ).join("")}
    </div>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn" title="Insert drawing" onclick="richInsertDrawing('${surfaceId}')">🖼 Draw</button>
    <button type="button" class="tb-btn handwritten-toggle-btn ${isRichHandwritten(surfaceId) ? "on" : ""}"
      data-hw-toggle="${surfaceId}" title="Handwritten style" onclick="richToggleHandwritten('${surfaceId}')">✍️ Handwritten</button>
  `;
}

// ── Rendering + hydration of embedded drawings ──────────────────────────────────
function renderRichContent(content) {
  const raw = md(content);
  return raw.replace(
    /\{\{sketch:(\d+)\}\}/g,
    (_, id) => `<div class="inline-sketch-embed" data-sketch-id="${id}"></div>`,
  );
}

let _mermaidInitialized = false;
function _ensureMermaidInit() {
  if (_mermaidInitialized || typeof mermaid === "undefined") return;
  mermaid.initialize({
    startOnLoad: false,
    theme: document.body.classList.contains("light") ? "default" : "dark",
  });
  _mermaidInitialized = true;
}

// Converts already-rendered ```mermaid code fences (marked emits them as
// <pre><code class="language-mermaid">) into live diagrams in place.
async function hydrateMermaidDiagrams(containerEl) {
  if (!containerEl || typeof mermaid === "undefined") return;
  const blocks = Array.from(
    containerEl.querySelectorAll("pre > code.language-mermaid"),
  );
  if (!blocks.length) return;
  _ensureMermaidInit();

  const nodes = blocks.map((code) => {
    const div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = code.textContent;
    code.parentElement.replaceWith(div);
    return div;
  });

  try {
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    // individual diagram errors are rendered inline by suppressErrors
  }
}

// Syntax-highlights fenced code blocks. Must run after hydrateMermaidDiagrams
// synchronously removes ```mermaid blocks from the DOM, so only "real" code
// blocks remain by the time this queries for them.
function hydrateCodeHighlighting(containerEl) {
  if (!containerEl || typeof hljs === "undefined") return;
  containerEl.querySelectorAll("pre code").forEach((block) => {
    if (block.dataset.highlighted) return;
    hljs.highlightElement(block);
  });
}

function hydrateRichEmbeds(containerEl) {
  hydrateSketchEmbeds(containerEl);
  hydrateMermaidDiagrams(containerEl);
  hydrateCodeHighlighting(containerEl);
}

async function hydrateSketchEmbeds(containerEl) {
  if (!containerEl) return;
  const embeds = Array.from(containerEl.querySelectorAll(".inline-sketch-embed"));
  if (!embeds.length) return;
  const idsNeeded = [
    ...new Set(embeds.map((el) => el.dataset.sketchId).filter((id) => !_sketchCache.has(id))),
  ];
  if (idsNeeded.length) {
    try {
      const rows = await get(`/sketches?ids=${idsNeeded.join(",")}`);
      rows.forEach((r) => _sketchCache.set(String(r.id), r));
    } catch {
      // leave uncached ids to render as "unavailable" below
    }
  }
  embeds.forEach((el) => _mountSketchEmbed(el));
}

function _mountSketchEmbed(el) {
  if (el._sketchBoard) {
    el._sketchBoard.destroy();
    el._sketchBoard = null;
  }
  const id = el.dataset.sketchId;
  const row = _sketchCache.get(id);
  if (!row) {
    el.innerHTML = '<div class="inline-sketch-missing">Drawing unavailable</div>';
    return;
  }
  let data = null;
  try {
    data = JSON.parse(row.elements);
  } catch {
    data = null;
  }
  el.innerHTML = "";
  el._sketchBoard = createSketchBoard(el, { data, readOnly: true });

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "inline-sketch-edit-btn";
  editBtn.title = "Edit drawing";
  editBtn.textContent = "✎ Edit";
  editBtn.onclick = () =>
    openSketchModal({
      existingId: id,
      onSaved: (updatedRow) => {
        _sketchCache.set(String(updatedRow.id), updatedRow);
        _mountSketchEmbed(el);
      },
    });
  el.appendChild(editBtn);
}

// ── Insert / edit drawing modal ─────────────────────────────────────────────────
function richInsertDrawing(surfaceId) {
  const cfg = _richSurfaces[surfaceId];
  if (!cfg) return;
  const entityId = cfg.getEntityId ? cfg.getEntityId() : null;
  if (!entityId) {
    toast("Save first, then you can add drawings", "error");
    return;
  }
  openSketchModal({
    entityType: cfg.entityType,
    entityId,
    onSaved: (row) => {
      _sketchCache.set(String(row.id), row);
      richInsertAtCursor(surfaceId, `\n{{sketch:${row.id}}}\n`);
    },
  });
}

let _sketchModalBoard = null;
let _sketchModalCtx = null;

// The sketch insert/edit modal gets its OWN overlay, independent of the
// shared #modal-overlay/#modal-content — richInsertDrawing() can be invoked
// from inside an already-open Todo/Reminder modal, and reusing the shared
// singleton modal container would wipe out that parent form (including
// whatever the user had already typed) when this one opens on top of it.
function _buildSketchOverlay() {
  let overlay = document.getElementById("sketch-modal-overlay");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "sketch-modal-overlay";
  overlay.className = "modal-overlay sketch-modal-overlay hidden";
  overlay.innerHTML = `
    <div class="modal modal-wide">
      <div class="modal-header">
        <h3 id="sketch-modal-title">Insert Drawing</h3>
        <button class="modal-close" onclick="closeSketchModal()">✕</button>
      </div>
      <div class="modal-body sketch-modal-body">
        <div id="sketch-modal-board"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeSketchModal()">Cancel</button>
        <button class="btn btn-primary" id="sketch-modal-save-btn" onclick="_saveSketchModal()">Insert</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeSketchModal();
  });
  return overlay;
}

function closeSketchModal() {
  const overlay = document.getElementById("sketch-modal-overlay");
  if (overlay) overlay.classList.add("hidden");
  if (_sketchModalBoard) {
    _sketchModalBoard.destroy();
    _sketchModalBoard = null;
  }
  _sketchModalCtx = null;
}

async function openSketchModal(opts) {
  opts = opts || {};
  let initialData = null;
  if (opts.existingId) {
    let row = _sketchCache.get(String(opts.existingId));
    if (!row) {
      try {
        row = await get(`/sketches/${opts.existingId}`);
        _sketchCache.set(String(row.id), row);
      } catch (e) {
        toast(e.message, "error");
        return;
      }
    }
    try {
      initialData = JSON.parse(row.elements);
    } catch {
      initialData = null;
    }
  }

  const overlay = _buildSketchOverlay();
  document.getElementById("sketch-modal-title").textContent = opts.existingId
    ? "Edit Drawing"
    : "Insert Drawing";
  document.getElementById("sketch-modal-save-btn").textContent = opts.existingId
    ? "Save"
    : "Insert";
  overlay.classList.remove("hidden");

  _sketchModalCtx = opts;
  _sketchModalBoard = createSketchBoard(document.getElementById("sketch-modal-board"), {
    data: initialData,
  });
}

async function _saveSketchModal() {
  if (!_sketchModalBoard || !_sketchModalCtx) return;
  const elements = _sketchModalBoard.serialize();
  const ctx = _sketchModalCtx;
  try {
    let row;
    if (ctx.existingId) {
      row = await put(`/sketches/${ctx.existingId}`, { elements });
    } else {
      row = await post("/sketches", {
        entity_type: ctx.entityType,
        entity_id: ctx.entityId,
        elements,
      });
    }
    closeSketchModal();
    if (typeof ctx.onSaved === "function") ctx.onSaved(row);
  } catch (e) {
    toast(e.message, "error");
  }
}
