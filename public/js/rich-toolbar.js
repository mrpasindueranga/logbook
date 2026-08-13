// ─── Rich text toolbar: text color, inline drawings, handwritten toggle ───────
// Shared across the Notes, Story, Todo, and Reminder text editors. Existing
// per-surface toolbar logic (ins() for notes, _storyTb* for story) is left
// untouched — this module only adds the three new capabilities, generically,
// so Todos/Reminders (which have no toolbar at all yet) can get a full one.

// ── Shared toolbar icon set ─────────────────────────────────────────────────────
// Small stroke-based SVGs (18x18, currentColor) used by every rich-text
// toolbar (Notes, Story, Todos, Reminders) so icon buttons look consistent.
const TB_ICON = {
  bold: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h7a4 4 0 0 1 0 8H6z"/><path d="M6 12h8a4 4 0 0 1 0 8H6z"/></svg>',
  italic:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>',
  strike:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/><path d="M16 6.5a4 4 0 0 0-4-2.5c-2.5 0-4 1.3-4 3s1.5 2.4 4 3"/><path d="M8 17.5a4 4 0 0 0 4 2.5c2.5 0 4-1.3 4-3.2"/></svg>',
  ul: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/></svg>',
  ol: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><path d="M4 5.5h1v3"/><path d="M4 15.2c0-.7.5-1.2 1.2-1.2s1.2.5 1.2 1.1c0 .5-.3.8-.7 1.1l-1.7 1.4h2.4"/></svg>',
  quote:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7.5 6C5 6 3 8.2 3 11c0 2.3 1.5 4 3.5 4 .3 1.7-.8 3.4-2.5 4l.6 1.4c3-1 4.9-3.6 4.9-6.9V11c0-2.8-.9-5-2-5zm10 0c-2.5 0-4.5 2.2-4.5 5 0 2.3 1.5 4 3.5 4 .3 1.7-.8 3.4-2.5 4l.6 1.4c3-1 4.9-3.6 4.9-6.9V11c0-2.8-.9-5-2-5z"/></svg>',
  codeInline:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 6 2 12 8 18"/><polyline points="16 6 22 12 16 18"/></svg>',
  codeBlock:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><polyline points="9 10 6.5 12.5 9 15"/><polyline points="15 10 17.5 12.5 15 15"/></svg>',
  link: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 6l1-1a4 4 0 0 1 5.7 5.7l-1.4 1.4"/><path d="M13 18l-1 1a4 4 0 0 1-5.7-5.7l1.4-1.4"/></svg>',
  hr: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="4" y1="12" x2="20" y2="12"/></svg>',
  table:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="4" x2="9" y2="20"/></svg>',
  image:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6" fill="currentColor" stroke="none"/><path d="M21 16l-5.5-5.5a1.5 1.5 0 0 0-2 0L4 20"/></svg>',
  draw: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3.5a2.1 2.1 0 0 1 3 3L7 18l-4 1 1-4z"/></svg>',
  handwritten:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17c1.5-4 3-9 4.5-9S9 13 10.5 13 13 7 14.5 7s2 6 3.5 6 2-2.5 3-2.5"/></svg>',
  write:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  split:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
  preview:
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  mic: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>',
};

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

function richToggleHandwritten(surfaceId) {
  _richHandwritten[surfaceId] = !_richHandwritten[surfaceId];
  document
    .querySelectorAll(`[data-hw-toggle="${surfaceId}"]`)
    .forEach((b) => b.classList.toggle("on", _richHandwritten[surfaceId]));
  _richChanged(surfaceId);
}

// ── Voice typing (Web Speech API) ────────────────────────────────────────────────
const _richRecognition = {}; // surfaceId -> SpeechRecognition instance
const _richListening = {}; // surfaceId -> boolean, the user's intended listening state

function _speechRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function _updateVoiceToggleBtn(surfaceId) {
  document
    .querySelectorAll(`[data-voice-toggle="${surfaceId}"]`)
    .forEach((b) => b.classList.toggle("on", !!_richListening[surfaceId]));
}

function richToggleVoiceTyping(surfaceId) {
  if (_richListening[surfaceId]) {
    _richListening[surfaceId] = false;
    _richRecognition[surfaceId]?.stop();
    _updateVoiceToggleBtn(surfaceId);
    return;
  }

  const Ctor = _speechRecognitionCtor();
  if (!Ctor) {
    toast("Voice typing isn't supported in this browser", "error");
    return;
  }
  // Microphone access (and the Web Speech API) is blocked outright on
  // insecure origins — only https:// or http://localhost are allowed. Catch
  // this up front instead of letting it surface as a confusing browser error.
  if (!window.isSecureContext) {
    toast(
      "Voice typing needs a secure connection — this page is served over " +
        "an insecure origin. Use https:// (or http://localhost) instead.",
      "error",
    );
    return;
  }
  if (!_richTa(surfaceId)) return;

  const recognition = new Ctor();
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (e) => {
    let text = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) text += e.results[i][0].transcript;
    }
    text = text.trim();
    if (!text) return;
    const ta = _richTa(surfaceId);
    const needsLeadingSpace =
      ta && ta.value.slice(0, ta.selectionStart) && !/\s$/.test(ta.value.slice(0, ta.selectionStart));
    richInsertAtCursor(surfaceId, `${needsLeadingSpace ? " " : ""}${text} `);
  };
  recognition.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    const messages = {
      "not-allowed": "Microphone access was blocked — check your browser's site permissions.",
      "service-not-allowed": "Microphone access was blocked — check your browser's site permissions.",
      network: "Voice typing lost its connection to the speech service.",
    };
    toast(messages[e.error] || `Voice typing error: ${e.error}`, "error");
    _richListening[surfaceId] = false;
    _updateVoiceToggleBtn(surfaceId);
  };
  recognition.onend = () => {
    // Browsers end continuous recognition after a pause in speech; restart
    // transparently while the user still intends to be listening.
    if (_richListening[surfaceId]) {
      try {
        recognition.start();
      } catch {
        // already starting/started — ignore
      }
    } else {
      _updateVoiceToggleBtn(surfaceId);
    }
  };

  _richRecognition[surfaceId] = recognition;
  _richListening[surfaceId] = true;
  recognition.start();
  _updateVoiceToggleBtn(surfaceId);
}

/** Stop any in-progress voice typing sessions — called on navigation so the
 * mic never keeps listening after the user has left the editor. */
function stopAllVoiceTyping() {
  for (const surfaceId of Object.keys(_richListening)) {
    if (_richListening[surfaceId]) {
      _richListening[surfaceId] = false;
      _richRecognition[surfaceId]?.stop();
    }
  }
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
    <button type="button" class="tb-btn tb-btn-text" title="Heading 1" onclick="richIns('${surfaceId}','h1')">H1</button>
    <button type="button" class="tb-btn tb-btn-text" title="Heading 2" onclick="richIns('${surfaceId}','h2')">H2</button>
    <button type="button" class="tb-btn tb-btn-text" title="Heading 3" onclick="richIns('${surfaceId}','h3')">H3</button>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn" title="Bullet list" onclick="richIns('${surfaceId}','ul')">${TB_ICON.ul}</button>
    <button type="button" class="tb-btn" title="Ordered list" onclick="richIns('${surfaceId}','ol')">${TB_ICON.ol}</button>
    <button type="button" class="tb-btn" title="Blockquote" onclick="richIns('${surfaceId}','quote')">${TB_ICON.quote}</button>
    <div class="tb-sep"></div>
    <button type="button" class="tb-btn" title="Inline code" onclick="richIns('${surfaceId}','code')">${TB_ICON.codeInline}</button>
    <button type="button" class="tb-btn" title="Link" onclick="richIns('${surfaceId}','link')">${TB_ICON.link}</button>
    <button type="button" class="tb-btn" title="Horizontal rule" onclick="richIns('${surfaceId}','hr')">${TB_ICON.hr}</button>
    <div class="tb-sep"></div>`
    : "";

  return `
    ${formatButtons}
    <button type="button" class="tb-btn" title="Insert drawing" onclick="richInsertDrawing('${surfaceId}')">${TB_ICON.draw}</button>
    <button type="button" class="tb-btn handwritten-toggle-btn ${isRichHandwritten(surfaceId) ? "on" : ""}"
      data-hw-toggle="${surfaceId}" title="Handwritten style" onclick="richToggleHandwritten('${surfaceId}')">${TB_ICON.handwritten}</button>
    <button type="button" class="tb-btn voice-toggle-btn ${_richListening[surfaceId] ? "on" : ""}"
      data-voice-toggle="${surfaceId}" title="Voice typing" onclick="richToggleVoiceTyping('${surfaceId}')">${TB_ICON.mic}</button>
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
