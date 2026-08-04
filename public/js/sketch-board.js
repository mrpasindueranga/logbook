// ─── Sketch board: Excalidraw-style hand-drawn drawing canvas ─────────────────
// Self-contained drawing engine for the "sketch" note type. Renders sketchy
// shapes via rough.js and handwritten text via the Caveat web font. Exposes a
// single factory, createSketchBoard(container, { data, readOnly }), returning
// { serialize(), destroy() }.

const SKETCH_PALETTE = [
  "#1e1e1e",
  "#e03131",
  "#1971c2",
  "#2f9e44",
  "#f08c00",
  "#9c36b5",
];
const SKETCH_STROKE_WIDTHS = [1.5, 3, 5];
const SKETCH_TOOLS = [
  { name: "select", icon: "↖", label: "Select / move" },
  { name: "pencil", icon: "✏️", label: "Pencil" },
  { name: "rectangle", icon: "▭", label: "Rectangle" },
  { name: "ellipse", icon: "◯", label: "Ellipse" },
  { name: "line", icon: "╱", label: "Line" },
  { name: "arrow", icon: "➜", label: "Arrow" },
  { name: "text", icon: "T", label: "Text" },
  { name: "eraser", icon: "🧹", label: "Eraser" },
];

let _sketchIdCounter = 0;
function sketchGenId() {
  return "el_" + Date.now().toString(36) + "_" + _sketchIdCounter++;
}
function sketchGenSeed() {
  return Math.floor(Math.random() * 1000000);
}

function sketchGetBBox(el, ctx) {
  if (el.type === "rectangle" || el.type === "ellipse") {
    return {
      x: Math.min(el.x, el.x + el.width),
      y: Math.min(el.y, el.y + el.height),
      w: Math.abs(el.width),
      h: Math.abs(el.height),
    };
  }
  if (el.type === "text") {
    let w = el._measuredWidth;
    if (w == null && ctx) {
      ctx.save();
      ctx.font = `${el.fontSize}px 'Caveat', cursive`;
      w = ctx.measureText(el.text).width;
      ctx.restore();
    }
    w = w || el.fontSize * el.text.length * 0.55;
    return { x: el.x, y: el.y - el.fontSize, w, h: el.fontSize * 1.3 };
  }
  const xs = el.points.map((p) => p[0]);
  const ys = el.points.map((p) => p[1]);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs);
  const minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const pad = (el.strokeWidth || 1.5) + 6;
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

function sketchHitTest(pos, el, ctx) {
  const b = sketchGetBBox(el, ctx);
  const pad = 6;
  return (
    pos.x >= b.x - pad &&
    pos.x <= b.x + b.w + pad &&
    pos.y >= b.y - pad &&
    pos.y <= b.y + b.h + pad
  );
}

function sketchDrawArrowhead(rc, x1, y1, x2, y2, options) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const headLen = Math.max(12, (options.strokeWidth || 1.5) * 6);
  const a1 = angle + Math.PI - Math.PI / 7;
  const a2 = angle + Math.PI + Math.PI / 7;
  rc.line(x2, y2, x2 + headLen * Math.cos(a1), y2 + headLen * Math.sin(a1), options);
  rc.line(x2, y2, x2 + headLen * Math.cos(a2), y2 + headLen * Math.sin(a2), options);
}

function createSketchBoard(container, opts) {
  opts = opts || {};
  const readOnly = !!opts.readOnly;

  container.innerHTML = "";
  container.classList.add("sketch-board");

  if (typeof rough === "undefined") {
    container.innerHTML =
      '<div class="sketch-load-error">Drawing library failed to load — check your connection and reload.</div>';
    return { serialize: () => opts.data || { elements: [] }, destroy() {} };
  }

  let elements =
    opts.data && Array.isArray(opts.data.elements)
      ? JSON.parse(JSON.stringify(opts.data.elements))
      : [];

  let history = [JSON.parse(JSON.stringify(elements))];
  let hIndex = 0;

  let tool = "pencil";
  let currentColor = document.body.classList.contains("light")
    ? SKETCH_PALETTE[0]
    : "#e9e9e9";
  let currentWidth = SKETCH_STROKE_WIDTHS[1];
  let selectedId = null;
  let dragging = false;
  let draft = null;
  let dragOffset = null;
  let erasedAny = false;
  let toolbarEl = null;
  let cssW = 0;
  let cssH = 0;

  // ── Toolbar ──────────────────────────────────────────────────────────────
  function buildToolbar() {
    const bar = document.createElement("div");
    bar.className = "sketch-toolbar";

    const toolsWrap = document.createElement("div");
    toolsWrap.className = "sketch-tb-group";
    SKETCH_TOOLS.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sketch-tb-btn" + (t.name === tool ? " on" : "");
      btn.title = t.label;
      btn.dataset.tool = t.name;
      btn.textContent = t.icon;
      btn.onclick = () => setTool(t.name);
      toolsWrap.appendChild(btn);
    });
    bar.appendChild(toolsWrap);

    const colorWrap = document.createElement("div");
    colorWrap.className = "sketch-tb-group";
    SKETCH_PALETTE.forEach((c) => {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "sketch-color-btn" + (c === currentColor ? " on" : "");
      sw.style.background = c;
      sw.title = c;
      sw.dataset.color = c;
      sw.onclick = () => setColor(c);
      colorWrap.appendChild(sw);
    });
    bar.appendChild(colorWrap);

    const widthWrap = document.createElement("div");
    widthWrap.className = "sketch-tb-group";
    SKETCH_STROKE_WIDTHS.forEach((w, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className =
        "sketch-tb-btn sketch-width-btn" + (w === currentWidth ? " on" : "");
      b.title = ["Thin", "Medium", "Thick"][i];
      b.dataset.width = String(w);
      b.innerHTML = `<span class="sketch-width-dot" style="width:${4 + i * 3}px;height:${4 + i * 3}px"></span>`;
      b.onclick = () => setWidth(w);
      widthWrap.appendChild(b);
    });
    bar.appendChild(widthWrap);

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "sketch-tb-group";
    const mkAction = (label, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sketch-tb-btn";
      b.title = title;
      b.textContent = label;
      b.onclick = fn;
      return b;
    };
    actionsWrap.appendChild(mkAction("↶", "Undo (Ctrl+Z)", undo));
    actionsWrap.appendChild(mkAction("↷", "Redo (Ctrl+Shift+Z)", redo));
    actionsWrap.appendChild(mkAction("🗑", "Clear canvas", clearAll));
    bar.appendChild(actionsWrap);

    toolbarEl = bar;
    return bar;
  }

  function setTool(name) {
    tool = name;
    selectedId = null;
    if (toolbarEl) {
      toolbarEl
        .querySelectorAll(".sketch-tb-btn[data-tool]")
        .forEach((b) => b.classList.toggle("on", b.dataset.tool === name));
    }
    canvas.style.cursor =
      name === "select" ? "default" : name === "text" ? "text" : "crosshair";
    render();
  }

  function setColor(c) {
    currentColor = c;
    if (toolbarEl) {
      toolbarEl
        .querySelectorAll(".sketch-color-btn")
        .forEach((b) => b.classList.toggle("on", b.dataset.color === c));
    }
  }

  function setWidth(w) {
    currentWidth = w;
    if (toolbarEl) {
      toolbarEl
        .querySelectorAll(".sketch-width-btn")
        .forEach((b) => b.classList.toggle("on", Number(b.dataset.width) === w));
    }
  }

  function clearAll() {
    if (!elements.length) return;
    elements = [];
    selectedId = null;
    commit();
    render();
  }

  // ── History ──────────────────────────────────────────────────────────────
  function commit() {
    history = history.slice(0, hIndex + 1);
    history.push(JSON.parse(JSON.stringify(elements)));
    hIndex = history.length - 1;
    if (typeof opts.onChange === "function") opts.onChange();
  }
  function undo() {
    if (hIndex > 0) {
      hIndex--;
      elements = JSON.parse(JSON.stringify(history[hIndex]));
      selectedId = null;
      render();
    }
  }
  function redo() {
    if (hIndex < history.length - 1) {
      hIndex++;
      elements = JSON.parse(JSON.stringify(history[hIndex]));
      selectedId = null;
      render();
    }
  }

  // ── DOM setup ────────────────────────────────────────────────────────────
  if (!readOnly) container.appendChild(buildToolbar());

  const wrapEl = document.createElement("div");
  wrapEl.className = "sketch-canvas-wrap";
  container.appendChild(wrapEl);

  const canvas = document.createElement("canvas");
  canvas.className = "sketch-canvas";
  if (!readOnly) {
    canvas.tabIndex = 0;
    canvas.style.cursor = "crosshair";
  }
  wrapEl.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  const rc = rough.canvas(canvas);

  // ── Rendering ────────────────────────────────────────────────────────────
  function drawElement(el, selected) {
    const options = {
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      roughness: el.type === "freedraw" ? 0.6 : 1.4,
      seed: el.seed,
      bowing: 1,
    };
    switch (el.type) {
      case "rectangle":
        rc.rectangle(el.x, el.y, el.width, el.height, options);
        break;
      case "ellipse":
        rc.ellipse(
          el.x + el.width / 2,
          el.y + el.height / 2,
          Math.abs(el.width),
          Math.abs(el.height),
          options,
        );
        break;
      case "line":
        rc.line(el.points[0][0], el.points[0][1], el.points[1][0], el.points[1][1], options);
        break;
      case "arrow": {
        const [[x1, y1], [x2, y2]] = el.points;
        rc.line(x1, y1, x2, y2, options);
        sketchDrawArrowhead(rc, x1, y1, x2, y2, options);
        break;
      }
      case "freedraw":
        if (el.points.length > 1) rc.linearPath(el.points, options);
        break;
      case "text":
        ctx.save();
        ctx.font = `${el.fontSize}px 'Caveat', cursive`;
        ctx.fillStyle = el.stroke;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(el.text, el.x, el.y);
        el._measuredWidth = ctx.measureText(el.text).width;
        ctx.restore();
        break;
    }
    if (selected) {
      const b = sketchGetBBox(el, ctx);
      ctx.save();
      ctx.strokeStyle = "#4dabf7";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
    }
  }

  function render() {
    ctx.clearRect(0, 0, cssW, cssH);
    for (const el of elements) drawElement(el, el.id === selectedId);
    if (draft) drawElement(draft, false);
  }

  function resizeCanvas() {
    cssW = wrapEl.clientWidth;
    cssH = wrapEl.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, cssW * dpr);
    canvas.height = Math.max(1, cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(wrapEl);
  resizeCanvas();

  // ── Text input overlay ───────────────────────────────────────────────────
  function startTextInput(cx, cy) {
    const ta = document.createElement("textarea");
    ta.className = "sketch-text-input";
    ta.style.left = cx + "px";
    ta.style.top = cy - 22 + "px";
    ta.style.font = "22px 'Caveat', cursive";
    ta.style.color = currentColor;
    wrapEl.appendChild(ta);
    // Defer focus so it wins over the browser's default mousedown-focus,
    // which would otherwise refocus the canvas and instantly blur this away.
    setTimeout(() => ta.focus(), 0);

    function finish() {
      const val = ta.value.trim();
      if (ta.parentNode) wrapEl.removeChild(ta);
      if (val) {
        elements.push({
          id: sketchGenId(),
          type: "text",
          x: cx,
          y: cy + 7,
          text: val,
          fontSize: 22,
          stroke: currentColor,
          seed: sketchGenSeed(),
        });
        commit();
        render();
      }
    }
    ta.addEventListener("blur", finish);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        ta.blur();
      } else if (e.key === "Escape") {
        ta.value = "";
        ta.blur();
      }
    });
  }

  // ── Pointer handling ─────────────────────────────────────────────────────
  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hitTestTopmost(pos) {
    for (let i = elements.length - 1; i >= 0; i--) {
      if (sketchHitTest(pos, elements[i], ctx)) return elements[i];
    }
    return null;
  }

  function applyTranslate(el, orig, dx, dy) {
    if (orig.points) el.points = orig.points.map(([x, y]) => [x + dx, y + dy]);
    else {
      el.x = orig.x + dx;
      el.y = orig.y + dy;
    }
  }

  function eraseAt(pos) {
    const hit = hitTestTopmost(pos);
    if (hit) {
      elements = elements.filter((e) => e.id !== hit.id);
      if (selectedId === hit.id) selectedId = null;
      erasedAny = true;
      render();
    }
  }

  function onPointerDown(e) {
    e.preventDefault();
    canvas.focus();
    canvas.setPointerCapture(e.pointerId);
    const pos = getPos(e);

    if (tool === "text") {
      startTextInput(pos.x, pos.y);
      return;
    }
    if (tool === "select") {
      const hit = hitTestTopmost(pos);
      selectedId = hit ? hit.id : null;
      if (hit) {
        dragging = true;
        dragOffset = { x: pos.x, y: pos.y, orig: JSON.parse(JSON.stringify(hit)) };
      }
      render();
      return;
    }
    if (tool === "eraser") {
      dragging = true;
      erasedAny = false;
      eraseAt(pos);
      return;
    }

    dragging = true;
    const base = {
      id: sketchGenId(),
      stroke: currentColor,
      strokeWidth: currentWidth,
      seed: sketchGenSeed(),
    };
    if (tool === "pencil") draft = { ...base, type: "freedraw", points: [[pos.x, pos.y]] };
    else if (tool === "rectangle") draft = { ...base, type: "rectangle", x: pos.x, y: pos.y, width: 0, height: 0 };
    else if (tool === "ellipse") draft = { ...base, type: "ellipse", x: pos.x, y: pos.y, width: 0, height: 0 };
    else if (tool === "line") draft = { ...base, type: "line", points: [[pos.x, pos.y], [pos.x, pos.y]] };
    else if (tool === "arrow") draft = { ...base, type: "arrow", points: [[pos.x, pos.y], [pos.x, pos.y]] };
    render();
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const pos = getPos(e);

    if (tool === "select" && selectedId) {
      const el = elements.find((x) => x.id === selectedId);
      if (el) {
        const dx = pos.x - dragOffset.x;
        const dy = pos.y - dragOffset.y;
        applyTranslate(el, dragOffset.orig, dx, dy);
        render();
      }
      return;
    }
    if (tool === "eraser") {
      eraseAt(pos);
      return;
    }
    if (!draft) return;
    if (draft.type === "freedraw") draft.points.push([pos.x, pos.y]);
    else if (draft.type === "rectangle" || draft.type === "ellipse") {
      draft.width = pos.x - draft.x;
      draft.height = pos.y - draft.y;
    } else if (draft.type === "line" || draft.type === "arrow") {
      draft.points[1] = [pos.x, pos.y];
    }
    render();
  }

  function onPointerUp() {
    dragging = false;
    if (tool === "select") {
      if (selectedId) commit();
      return;
    }
    if (tool === "eraser") {
      if (erasedAny) commit();
      erasedAny = false;
      return;
    }
    if (draft) {
      const valid =
        draft.type === "freedraw"
          ? draft.points.length > 1
          : draft.type === "line" || draft.type === "arrow"
            ? draft.points[0][0] !== draft.points[1][0] || draft.points[0][1] !== draft.points[1][1]
            : Math.abs(draft.width) > 2 && Math.abs(draft.height) > 2;
      if (valid) {
        elements.push(draft);
        commit();
      }
      draft = null;
      render();
    }
  }

  function onKeyDown(e) {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      elements = elements.filter((el) => el.id !== selectedId);
      selectedId = null;
      commit();
      render();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  }

  if (!readOnly) {
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("keydown", onKeyDown);
  }

  return {
    serialize() {
      return { elements: JSON.parse(JSON.stringify(elements)) };
    },
    destroy() {
      ro.disconnect();
    },
  };
}
