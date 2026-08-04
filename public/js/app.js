/* global marked, DOMPurify */
"use strict";

const BASE = (window.__BASE_PATH__ || "").replace(/\/+$/, "");
const API = `${BASE}/api`;

// ─── Colour palette ───────────────────────────────────────────────────────────
const COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#64748b",
];

// ─── Accent palette (theme customisation) ────────────────────────────────────
const ACCENT_PALETTE = [
  {
    id: "blue",
    light: "#60a5fa",
    dark: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
    ring: "rgba(59,130,246,0.28)",
  },
  {
    id: "purple",
    light: "#a78bfa",
    dark: "#8b5cf6",
    bg: "rgba(139,92,246,0.12)",
    ring: "rgba(139,92,246,0.28)",
  },
  {
    id: "pink",
    light: "#f472b6",
    dark: "#ec4899",
    bg: "rgba(236,72,153,0.12)",
    ring: "rgba(236,72,153,0.28)",
  },
  {
    id: "red",
    light: "#fca5a5",
    dark: "#ef4444",
    bg: "rgba(239,68,68,0.12)",
    ring: "rgba(239,68,68,0.28)",
  },
  {
    id: "orange",
    light: "#fb923c",
    dark: "#f97316",
    bg: "rgba(249,115,22,0.12)",
    ring: "rgba(249,115,22,0.28)",
  },
  {
    id: "yellow",
    light: "#fcd34d",
    dark: "#eab308",
    bg: "rgba(234,179,8,0.12)",
    ring: "rgba(234,179,8,0.28)",
  },
  {
    id: "green",
    light: "#4ade80",
    dark: "#22c55e",
    bg: "rgba(34,197,94,0.12)",
    ring: "rgba(34,197,94,0.28)",
  },
  {
    id: "teal",
    light: "#22d3ee",
    dark: "#06b6d4",
    bg: "rgba(6,182,212,0.12)",
    ring: "rgba(6,182,212,0.28)",
  },
  {
    id: "slate",
    light: "#94a3b8",
    dark: "#64748b",
    bg: "rgba(100,116,139,0.12)",
    ring: "rgba(100,116,139,0.28)",
  },
];

// ─── User state ───────────────────────────────────────────────────────────────
let _userName = ""; // populated at boot from settings; used for greetings

// ─── State ────────────────────────────────────────────────────────────────────
const S = {
  orgs: [], // all orgs (with .projects arrays populated lazily)
  sections: [], // DB sections for the active org
  activeSidebarOrg: null, // currently selected org in sidebar
  editTags: [],
  editLabels: [], // label objects {id,name,color} attached to current note
  labelSuggestions: [], // all labels loaded for autocomplete
  editType: "descriptive",
  editorView: "split",
  autosaveTimer: null,
  isDirty: false,
  sketchBoard: null, // active createSketchBoard() instance, if any
  sketchDraftContent: null, // serialized sketch JSON kept in memory while toggling note type
  sketchViewBoard: null, // read-only createSketchBoard() instance on the note view page
};

let dashProjects = []; // cached for dashboard org-switcher filtering

// ─── Section UI collapse state (localStorage, keyed by DB section id) ──────────
function _getSectionCollapseMap() {
  try {
    return JSON.parse(localStorage.getItem("logbook_sb_collapse") || "{}");
  } catch (_) {
    return {};
  }
}
function isSidebarSectionCollapsed(sectionId) {
  return !!_getSectionCollapseMap()[String(sectionId)];
}
function toggleSidebarSectionCollapse(sectionId) {
  const map = _getSectionCollapseMap();
  const isCollapsed = !!map[String(sectionId)];
  // Accordion: collapse all, then toggle the clicked one
  (S.sections || []).forEach((s) => {
    map[String(s.id)] = true;
  });
  map[String(sectionId)] = !isCollapsed;
  localStorage.setItem("logbook_sb_collapse", JSON.stringify(map));
  renderSidebar();
}

function collapseAllSidebarSections() {
  const map = _getSectionCollapseMap();
  (S.sections || []).forEach((s) => {
    map[String(s.id)] = true;
  });
  localStorage.setItem("logbook_sb_collapse", JSON.stringify(map));
  renderSidebar();
}

function bindSidebarGlobalNavCollapse() {
  ["nav-dashboard", "nav-reminders", "nav-settings"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.collapseBound === "1") return;
    el.addEventListener("click", collapseAllSidebarSections);
    el.dataset.collapseBound = "1";
  });
}

function buildSidebarSectionSelect(selectedId, inputId) {
  const sections = S.sections || [];
  const options = sections
    .map(
      (s) =>
        `<option value="${esc(s.id)}" ${String(selectedId) === String(s.id) ? "selected" : ""}>${esc(s.name)}</option>`,
    )
    .join("");
  return `<select id="${inputId}" class="form-select">${options}</select>`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(str) {
  const d = new Date(str + (str.endsWith("Z") ? "" : "Z"));
  const now = new Date();
  const ms = now - d;
  if (ms < 60000) return "just now";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  if (ms < 604800000) return `${Math.floor(ms / 86400000)}d ago`;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function parseTags(raw) {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

function tagsHtml(tags) {
  return tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");
}

function md(content) {
  if (!content)
    return '<p style="color:var(--text-dim);font-style:italic">No content</p>';

  const markdownEngine =
    typeof marked !== "undefined" && typeof marked.parse === "function"
      ? marked
      : null;
  if (!markdownEngine) {
    return `<pre class="md-fallback">${esc(content)}</pre>`;
  }

  const raw = markdownEngine.parse(content);
  if (
    typeof DOMPurify !== "undefined" &&
    typeof DOMPurify.sanitize === "function"
  ) {
    return DOMPurify.sanitize(raw, { ADD_ATTR: ["target", "style"] });
  }
  return raw;
}

function loading() {
  return `<div class="loading"><div class="spinner"></div> Loading…</div>`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg, type = "info", ms = 3200) {
  const c = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.animation = "toast-out .2s ease forwards";
    setTimeout(() => el.remove(), 200);
  }, ms);
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function modal(html) {
  document.getElementById("modal-content").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
  setTimeout(
    () => document.querySelector("#modal input, #modal select")?.focus(),
    60,
  );
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
}
document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
});

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiFetch(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const get = (p) => apiFetch("GET", p);
const post = (p, b) => apiFetch("POST", p, b);
const put = (p, b) => apiFetch("PUT", p, b);
const del = (p) => apiFetch("DELETE", p);

// ─── Colour picker helper ─────────────────────────────────────────────────────
function colorPicker(selected, field) {
  return `
    <div class="color-row" id="cp-${field}">
      ${COLORS.map(
        (c) =>
          `<div class="color-swatch ${c === selected ? "on" : ""}" style="background:${c}" data-c="${c}" onclick="pickColor('${field}','${c}')"></div>`,
      ).join("")}
    </div>
    <input type="hidden" id="cp-val-${field}" value="${esc(selected)}">`;
}
function pickColor(field, c) {
  document
    .querySelectorAll(`#cp-${field} .color-swatch`)
    .forEach((s) => s.classList.toggle("on", s.dataset.c === c));
  document.getElementById(`cp-val-${field}`).value = c;
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
async function loadSidebar() {
  S.orgs = await get("/organizations");
  if (!S.orgs.length) {
    renderSidebar();
    return;
  }

  // Determine which org to pre-load from the current URL hash
  const hash = window.location.hash;
  const orgM = hash.match(/^#\/org\/(\d+)/);
  const prjM = hash.match(/^#\/project\/(\d+)/);
  let targetOrgId = S.orgs[0].id;

  if (orgM) {
    const id = +orgM[1];
    if (S.orgs.find((o) => o.id === id)) targetOrgId = id;
  } else if (prjM) {
    // We don't know which org owns this project yet — load all orgs lightly,
    // then use the first one; switchSidebarOrg will correct after viewProject loads.
    targetOrgId = S.orgs[0].id;
  }

  S.activeSidebarOrg = targetOrgId;
  const [full, sections] = await Promise.all([
    get(`/organizations/${targetOrgId}`),
    get(`/sections?org_id=${targetOrgId}`),
  ]);
  const org = S.orgs.find((o) => o.id === targetOrgId);
  if (org) org.projects = full.projects;
  S.sections = sections;
  renderSidebar();
}

function renderSidebar() {
  const hash = window.location.hash;
  const orgM = hash.match(/^#\/org\/(\d+)/);
  const prjM = hash.match(/^#\/project\/(\d+)/);
  const isDash = !hash || hash === "#/" || hash === "#";
  const isSettings = hash.startsWith("#/settings");
  const isReminders = hash.startsWith("#/reminders");

  document.getElementById("nav-dashboard").className =
    `nav-item${isDash ? " active" : ""}`;
  const navReminders = document.getElementById("nav-reminders");
  if (navReminders)
    navReminders.className = `nav-item${isReminders ? " active" : ""}`;
  const navSettings = document.getElementById("nav-settings");
  if (navSettings)
    navSettings.className = `sidebar-bottom-link${isSettings ? " active" : ""}`;

  // Auto-detect active org from URL
  if (orgM) {
    S.activeSidebarOrg = +orgM[1];
  } else if (prjM) {
    const pid = +prjM[1];
    for (const org of S.orgs) {
      if (org.projects?.find((p) => p.id === pid)) {
        S.activeSidebarOrg = org.id;
        break;
      }
    }
  }
  if (!S.activeSidebarOrg && S.orgs.length) S.activeSidebarOrg = S.orgs[0].id;

  const activeOrg = S.orgs.find((o) => o.id === S.activeSidebarOrg);

  // ── Workspace switcher ────────────────────────────────────────────────────
  const workspaceEl = document.getElementById("sb-workspace-area");
  if (workspaceEl) {
    if (S.orgs.length > 1) {
      workspaceEl.innerHTML = `
        <div class="sb-workspace" onclick="toggleOrgPicker(event)">
          <span class="sb-dot" style="background:${esc(activeOrg?.color || "#60a5fa")}"></span>
          <span class="sb-workspace-name">${esc(activeOrg?.name || "Select org")}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="color:var(--text-dim);flex-shrink:0;margin-left:auto"><path d="M5 7L0 2h10z"/></svg>
        </div>
        <div class="sb-org-picker hidden" id="sb-org-picker">
          ${S.orgs
            .map(
              (o) => `
          <button class="sb-org-pick-item${o.id === S.activeSidebarOrg ? " active" : ""}" onclick="switchSidebarOrg(${o.id})">
            <span class="sb-dot" style="background:${esc(o.color)}"></span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;text-align:left">${esc(o.name)}</span>
            ${o.id === S.activeSidebarOrg ? '<span class="sb-pick-check">✓</span>' : ""}
          </button>`,
            )
            .join("")}
          <div class="sb-org-pick-sep"></div>
          <button class="sb-org-pick-item" onclick="openNewOrgModal();document.getElementById('sb-org-picker')?.classList.add('hidden')">
            <span style="color:var(--accent)">+</span>
            <span>New organization</span>
          </button>
        </div>`;
    } else if (activeOrg) {
      workspaceEl.innerHTML = `
        <div class="sb-workspace sb-workspace-solo">
          <span class="sb-dot" style="background:${esc(activeOrg.color)}"></span>
          <span class="sb-workspace-name">${esc(activeOrg.name)}</span>
        </div>`;
    } else {
      workspaceEl.innerHTML = "";
    }
  }

  // ── Projects list ─────────────────────────────────────────────────────────
  const list = document.getElementById("sidebar-org-list");

  if (!S.orgs.length) {
    list.innerHTML = `<div class="sb-empty-msg">No organizations yet.<br><button class="sb-inline-btn" onclick="openNewOrgModal()">Create one</button></div>`;
    return;
  }

  const projects = activeOrg?.projects || [];
  const sections = S.sections || [];

  // Ensure at least the first section is open on load
  const collapseMap = _getSectionCollapseMap();
  const allCollapsed =
    sections.length > 0 && sections.every((s) => !!collapseMap[String(s.id)]);
  if (allCollapsed) collapseMap[String(sections[0].id)] = false;

  const sectionBlocks = sections
    .map((section) => {
      const rows = projects.filter(
        (p) => String(p.section_id) === String(section.id),
      );
      const collapsed = !!collapseMap[String(section.id)];
      const count = rows.length;
      const hasActive = rows.some((p) => prjM && parseInt(prjM[1]) === p.id);

      const rowsHtml = rows.length
        ? rows
            .map((p) => {
              const active = prjM && parseInt(prjM[1]) === p.id;
              return `<a class="sb-project-row${active ? " active" : ""}" href="#/project/${p.id}">
        <span class="sb-project-dot" style="background:${esc(activeOrg?.color || "#60a5fa")}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.name)}">${esc(p.name)}</span>
      </a>`;
            })
            .join("")
        : `<div class="sb-group-empty">No projects yet</div>`;

      return `
      <div class="sb-group${hasActive ? " has-active" : ""}${!collapsed ? " is-open" : ""}">
        <div class="sb-group-head">
          <button class="sb-group-trigger" onclick="toggleSidebarSectionCollapse(${section.id});event.stopPropagation()">
            <svg class="sb-group-caret${collapsed ? "" : " open"}" width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M3 2l4 3-4 3V2z"/></svg>
            <span class="sb-group-title" title="${esc(section.name)}">${esc(section.name)}</span>
            <span class="sb-group-count">${count}</span>
          </button>
          <div class="sb-group-actions">
            ${
              activeOrg
                ? `<button class="sb-icon-btn" title="New project in ${esc(section.name)}" onclick="openNewProjectModal(${activeOrg.id}, ${section.id});event.stopPropagation()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>`
                : ""
            }
            <button class="sb-icon-btn" title="Section options" onclick="toggleSectionMenu(${section.id}, ${S.activeSidebarOrg}, event)">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </button>
            <div class="sb-section-menu hidden" id="sb-smenu-${section.id}">
              <button onclick="renameSidebarSection(${section.id}, '${esc(section.name)}');closeSectionMenus()">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Rename
              </button>
              <button class="danger" onclick="deleteSidebarSection(${section.id}, ${S.activeSidebarOrg});closeSectionMenus()">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                Delete
              </button>
            </div>
          </div>
        </div>
        <div class="sb-group-body${collapsed ? " collapsed" : ""}">
          ${rowsHtml}
        </div>
      </div>`;
    })
    .join("");

  const footerBtns = activeOrg
    ? `
    <div class="sb-footer-actions">
      <button class="sb-footer-btn" onclick="openNewSidebarSectionModal()">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New section
      </button>
    </div>`
    : "";

  list.innerHTML =
    (sectionBlocks ||
      `<div class="sb-empty-msg">No sections yet.<br><button class="sb-inline-btn" onclick="openNewSidebarSectionModal()">Create one</button></div>`) +
    footerBtns;
}

function toggleOrgPicker(e) {
  e.stopPropagation();
  const picker = document.getElementById("sb-org-picker");
  if (!picker) return;
  picker.classList.toggle("hidden");
  if (!picker.classList.contains("hidden")) {
    document.addEventListener(
      "click",
      function closePicker() {
        picker.classList.add("hidden");
        document.removeEventListener("click", closePicker);
      },
      { once: true },
    );
  }
}

async function switchSidebarOrg(orgId) {
  document.getElementById("sb-org-picker")?.classList.add("hidden");
  S.activeSidebarOrg = orgId;
  const org = S.orgs.find((o) => o.id === orgId);
  const [full, sections] = await Promise.all([
    get(`/organizations/${orgId}`),
    get(`/sections?org_id=${orgId}`),
  ]);
  if (org) org.projects = full.projects;
  S.sections = sections;
  renderSidebar();
  location.hash = `#/org/${orgId}`;
}

// ─── Router ───────────────────────────────────────────────────────────────────
function parseRoute() {
  const h = window.location.hash.slice(1) || "/";
  const p = h.split("/").filter(Boolean);
  if (!p.length) return { v: "dashboard" };
  if (p[0] === "org" && p[1]) return { v: "org", id: +p[1] };
  if (p[0] === "project" && p[1] && p[2] === "story")
    return { v: "project", id: +p[1], tab: "story" };
  if (p[0] === "project" && p[1] && p[2] === "notes")
    return { v: "project", id: +p[1], tab: "notes" };
  if (p[0] === "project" && p[1] && p[2] === "todos")
    return { v: "project", id: +p[1], tab: "todos" };
  if (p[0] === "project" && p[1] && p[2] === "ideas")
    return { v: "project", id: +p[1], tab: "ideas" };
  if (p[0] === "project" && p[1] && p[2] === "reminders")
    return { v: "project", id: +p[1], tab: "reminders" };
  if (p[0] === "project" && p[1])
    return { v: "project", id: +p[1], tab: "story" };
  if (p[0] === "note" && p[1] === "new" && p[2])
    return { v: "note-edit", id: null, pid: +p[2] };
  if (p[0] === "note" && p[1] && p[2] === "edit")
    return { v: "note-edit", id: +p[1] };
  if (p[0] === "note" && p[1]) return { v: "note", id: +p[1] };
  if (p[0] === "settings") return { v: "settings" };
  if (p[0] === "reminders") return { v: "reminders" };
  return { v: "dashboard" };
}

async function route() {
  if (S.autosaveTimer) {
    clearTimeout(S.autosaveTimer);
    S.autosaveTimer = null;
  }
  const r = parseRoute();
  renderSidebar();
  try {
    switch (r.v) {
      case "dashboard":
        return await viewDashboard();
      case "org":
        return await viewOrg(r.id);
      case "project":
        return await viewProject(r.id, r.tab || "story");
      case "note":
        return await viewNote(r.id);
      case "note-edit":
        return await viewNoteEditor(r.id, r.pid);
      case "settings":
        return await viewSettings();
      case "reminders":
        return await viewReminders();
      default:
        return await viewDashboard();
    }
  } catch (err) {
    document.getElementById("content").innerHTML =
      `<div class="empty"><h3>Something went wrong</h3><p>${esc(err.message)}</p></div>`;
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function viewDashboard() {
  const el = document.getElementById("content");
  el.innerHTML = loading();
  const {
    stats,
    projects,
    recentNotes,
    topLabels = [],
    overdueTodos = [],
    notesPerDay = [],
    topProjectsByNotes = [],
  } = await get("/dashboard");

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  dashProjects = projects;

  const orgMap = {};
  projects.forEach((p) => {
    if (!orgMap[p.org_id])
      orgMap[p.org_id] = { id: p.org_id, name: p.org_name, color: p.org_color };
  });
  const distinctOrgs = Object.values(orgMap);

  // Stat cards definition
  const statCards = [
    { label: "Notes", value: stats.note_count, icon: "📝", accent: false },
    {
      label: "Projects",
      value: stats.project_count,
      icon: "📁",
      accent: false,
    },
    {
      label: "Active Todos",
      value: stats.active_todos || 0,
      icon: "⬡",
      accent: stats.active_todos > 0,
    },
    {
      label: "In Progress",
      value: stats.in_progress_todos || 0,
      icon: "⟳",
      accent: false,
    },
    {
      label: "Overdue",
      value: stats.overdue_todos || 0,
      icon: "⚠",
      danger: stats.overdue_todos > 0,
    },
    {
      label: "This Week",
      value: stats.notes_this_week || 0,
      icon: "✦",
      success: true,
    },
  ];

  const statCardsHtml = statCards
    .map(
      (s) => `
    <div class="dash-stat-card ${s.danger ? "danger" : s.success ? "success" : s.accent ? "accent" : ""}">
      <div class="dash-stat-card-top">
        <span class="dash-stat-icon">${s.icon}</span>
        <span class="dash-stat-num">${s.value}</span>
      </div>
      <div class="dash-stat-label">${s.label}</div>
    </div>`,
    )
    .join("");

  // Overdue todos section
  const overdueHtml = overdueTodos.length
    ? `
    <div class="dash-overdue-section">
      <div class="dash-overdue-header">
        <span class="dash-overdue-icon">⚠</span>
        <strong>${overdueTodos.length} overdue todo${overdueTodos.length !== 1 ? "s" : ""}</strong>
      </div>
      ${overdueTodos
        .map(
          (t) => `
        <a class="dash-overdue-item" href="#/project/${t.project_id}?tab=todos">
          <span class="dash-overdue-title" title="${esc(t.title)}">${esc(t.title)}</span>
          <span class="dash-overdue-meta">${esc(t.project_name)} · due ${esc(t.due_date)}</span>
          <span class="priority-badge priority-${esc(t.priority)}">${t.priority}</span>
        </a>`,
        )
        .join("")}
    </div>`
    : "";

  // Labels cloud
  const labelsHtml = topLabels.length
    ? `
    <div class="dash-section-row" style="margin-top:24px">
      <div class="dash-section-label">Top Labels</div>
    </div>
    <div class="dash-labels-cloud">
      ${topLabels
        .map(
          (l) => `
        <button class="dash-label-chip" style="background:${esc(l.color)}22;color:${esc(l.color)};border-color:${esc(l.color)}55"
          onclick="openTelescope();setTimeout(()=>{ const btn=document.querySelector('.tele-filter-btn[data-filter=\\'${l.id}\\']'); if(btn)btn.click(); },300)">
          ${esc(l.name)}<span class="dash-label-count">${l.usage}</span>
        </button>`,
        )
        .join("")}
    </div>`
    : "";

  el.innerHTML = `
    <div class="page-in">
      <div class="dash-hero">
        <div>
          <div class="dash-greeting">🛠️ ${greeting}${_userName ? ", " + esc(_userName) : ""}</div>
          <div class="dash-date">${dateStr}</div>
        </div>
        <div class="dash-quick-actions">
          <button class="dash-action-btn" onclick="openTelescope()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Search <kbd class="dash-kbd">⌘K</kbd>
          </button>
          <button class="dash-action-btn primary" onclick="openNewOrgModal()">+ New Organization</button>
        </div>
      </div>

      <div class="dash-stat-cards">${statCardsHtml}</div>

      <!-- Charts row -->
      <div class="dash-charts-row">
        <div class="dash-chart-card">
          <div class="dash-chart-title">📈 Notes — Last 7 Days</div>
          <div class="dash-chart-canvas-wrap"><canvas id="chart-notes-trend"></canvas></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">⬡ Todo Breakdown</div>
          <div class="dash-chart-val">${+stats.active_todos + +stats.done_todos}</div>
          <div class="dash-chart-sub">total todos</div>
          <div class="dash-chart-canvas-wrap" style="height:110px"><canvas id="chart-todo-status"></canvas></div>
        </div>
        <div class="dash-chart-card">
          <div class="dash-chart-title">📁 Top Projects by Notes</div>
          <div class="dash-chart-canvas-wrap"><canvas id="chart-top-projects"></canvas></div>
        </div>
      </div>

      ${overdueHtml}

      ${
        projects.length
          ? `
      <div class="dash-section-row">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="dash-section-label">Projects</div>
          ${
            distinctOrgs.length > 1
              ? `
          <div class="dash-org-switcher">
            <button class="dash-org-tab active" data-org="all" onclick="filterDashboardOrg('all',this)">All</button>
            ${distinctOrgs
              .map(
                (o) => `
            <button class="dash-org-tab" data-org="${o.id}" onclick="filterDashboardOrg(${o.id},this)">
              <span class="dash-org-tab-dot" style="background:${esc(o.color)}"></span>${esc(o.name)}
            </button>`,
              )
              .join("")}
          </div>`
              : ""
          }
        </div>
        <button class="btn btn-ghost btn-sm" onclick="openNewProjectModal(${distinctOrgs.length === 1 ? distinctOrgs[0].id : 0})">+ New Project</button>
      </div>
      <div class="dash-projects-grid" id="dash-projects-grid">
        ${projects.map((p) => dashProjectCardHTML(p)).join("")}
      </div>`
          : `
      <div class="empty">
        <svg class="empty-icon" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
        <h3>Welcome to Logbook</h3>
        <p>Create your first organization to get started.</p>
        <button class="btn btn-primary" onclick="openNewOrgModal()">+ New Organization</button>
      </div>`
      }

      ${labelsHtml}

      ${
        recentNotes.length
          ? `
      <div class="dash-bottom">
        <div class="dash-card">
          <div class="dash-card-header">Latest Notes
            <span class="dash-card-count">${recentNotes.length}</span>
          </div>
          ${
            recentNotes.length
              ? recentNotes
                  .map(
                    (n) => `
            <a class="dash-note-row" href="#/note/${n.id}">
              <div class="dash-note-org-dot" style="background:${esc(n.org_color)}"></div>
              <div class="dash-note-body">
                <div class="dash-note-title" title="${esc(n.title)}">${esc(n.title)}</div>
                <div class="dash-note-proj" title="${esc(n.project_name)}">${esc(n.project_name)} · ${fmtDate(n.updated_at)}</div>
                ${
                  (n.labels || []).length
                    ? `<div class="dash-note-labels">${(n.labels || [])
                        .map(
                          (l) =>
                            `<span class="label-pill" style="background:${esc(l.color)}18;color:${esc(l.color)};border-color:${esc(l.color)}40">${esc(l.name)}</span>`,
                        )
                        .join("")}</div>`
                    : ""
                }
              </div>
            </a>`,
                  )
                  .join("")
              : '<div class="dash-empty-msg">No notes yet</div>'
          }
        </div>
      </div>`
          : ""
      }
    </div>
  `;
  _initDashCharts({ notesPerDay, stats, topProjectsByNotes });
}

// ─── Dashboard charts ─────────────────────────────────────────────────────────
let _dashCharts = {};
function _initDashCharts({ notesPerDay, stats, topProjectsByNotes }) {
  Object.values(_dashCharts).forEach((c) => {
    try {
      c.destroy();
    } catch (_) {}
  });
  _dashCharts = {};
  if (typeof Chart === "undefined") return;

  const isLight = document.body.classList.contains("light");
  const gridColor = isLight ? "rgba(0,0,0,0.07)" : "rgba(255,255,255,0.07)";
  const tickColor = isLight ? "#64748b" : "#94a3b8";
  const borderBg = isLight ? "#ffffff" : "#1e293b";

  // 1 — Notes trend line chart (last 7 days)
  const trendEl = document.getElementById("chart-notes-trend");
  if (trendEl) {
    const days = [],
      counts = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      days.push(d.toLocaleDateString("en-US", { weekday: "short" }));
      const row = notesPerDay.find(
        (r) => (r.day || "").slice(0, 10) === dayStr,
      );
      counts.push(row ? +row.count : 0);
    }
    _dashCharts.trend = new Chart(trendEl, {
      type: "line",
      data: {
        labels: days,
        datasets: [
          {
            data: counts,
            borderColor: "#3b82f6",
            backgroundColor: "rgba(59,130,246,0.12)",
            fill: true,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: "#3b82f6",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { size: 11 } },
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { size: 11 }, precision: 0 },
            beginAtZero: true,
          },
        },
      },
    });
  }

  // 2 — Todo status doughnut
  const todoEl = document.getElementById("chart-todo-status");
  if (todoEl) {
    const done = +stats.done_todos || 0;
    const inProgress = +stats.in_progress_todos || 0;
    const active = +stats.active_todos || 0;
    const toDo = Math.max(0, active - inProgress);
    _dashCharts.todo = new Chart(todoEl, {
      type: "doughnut",
      data: {
        labels: ["To Do", "In Progress", "Done"],
        datasets: [
          {
            data: [toDo, inProgress, done],
            backgroundColor: [
              "rgba(100,116,139,0.75)",
              "rgba(251,191,36,0.85)",
              "rgba(34,197,94,0.85)",
            ],
            borderColor: borderBg,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "62%",
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: tickColor,
              font: { size: 10 },
              padding: 6,
              boxWidth: 10,
            },
          },
        },
      },
    });
  }

  // 3 — Top projects horizontal bar chart
  const projEl = document.getElementById("chart-top-projects");
  if (projEl && topProjectsByNotes.length) {
    const names = topProjectsByNotes.map((p) =>
      p.name.length > 14 ? p.name.slice(0, 14) + "…" : p.name,
    );
    const vals = topProjectsByNotes.map((p) => +p.note_count);
    const colors = topProjectsByNotes.map(
      (p) => (p.org_color || "#6366f1") + "cc",
    );
    _dashCharts.proj = new Chart(projEl, {
      type: "bar",
      data: {
        labels: names,
        datasets: [{ data: vals, backgroundColor: colors, borderRadius: 4 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: tickColor, font: { size: 10 } },
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { size: 10 }, precision: 0 },
            beginAtZero: true,
          },
        },
      },
    });
  }
}

// ─── Dashboard helpers ────────────────────────────────────────────────────────
function dashProjectCardHTML(p) {
  const pct =
    p.todo_total > 0 ? Math.round((p.todo_done / p.todo_total) * 100) : 0;
  const allDone = p.todo_total > 0 && p.todo_done === p.todo_total;
  const hasOverdue = p.todo_overdue > 0;
  const fillColor = allDone
    ? "#22c55e"
    : hasOverdue
      ? "#ef4444"
      : "var(--accent-dark)";
  const lastNote = p.last_note_title
    ? `<div class="dash-project-lastnote" title="${esc(p.last_note_title)}">↳ ${esc(p.last_note_title)}</div>`
    : "";
  return `
  <a class="dash-project-card" href="#/project/${p.id}" style="border-left-color:${esc(p.org_color)}">
    <div class="dash-project-top">
      <div class="dash-project-name" title="${esc(p.name)}">${esc(p.name)}</div>
      ${hasOverdue ? `<span class="dash-overdue-badge">⚠ ${p.todo_overdue}</span>` : ""}
    </div>
    <div class="dash-project-org">
      <span style="width:6px;height:6px;border-radius:50%;background:${esc(p.org_color)};flex-shrink:0;display:inline-block"></span>
      ${esc(p.org_name)}
    </div>
    <div class="dash-project-meta">
      <span>📝 ${p.note_count}</span>
      ${p.todo_total ? `<span>✓ ${p.todo_done}/${p.todo_total}</span>` : ""}
      ${p.todo_in_progress ? `<span style="color:var(--warning)">⟳ ${p.todo_in_progress}</span>` : ""}
      <span class="badge badge-${esc(p.status)}" style="margin-left:auto">${esc(p.status)}</span>
    </div>
    ${
      p.todo_total > 0
        ? `
    <div class="dash-todo-row">
      <div class="dash-todo-bar"><div class="dash-todo-fill" style="width:${pct}%;background:${fillColor}"></div></div>
      <div class="dash-todo-label">${allDone ? "✓ done" : pct + "%"}</div>
    </div>`
        : ""
    }
    ${lastNote}
  </a>`;
}

function filterDashboardOrg(orgId, btn) {
  document
    .querySelectorAll(".dash-org-tab")
    .forEach((t) => t.classList.remove("active"));
  btn?.classList.add("active");
  const filtered =
    orgId === "all"
      ? dashProjects
      : dashProjects.filter((p) => p.org_id == orgId);
  const grid = document.getElementById("dash-projects-grid");
  if (!grid) return;
  grid.innerHTML = filtered.length
    ? filtered.map((p) => dashProjectCardHTML(p)).join("")
    : `<div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--text-dim);font-size:13px">No projects in this organization yet.</div>`;
}

// ─── Org view ─────────────────────────────────────────────────────────────────
async function viewOrg(id) {
  const el = document.getElementById("content");
  el.innerHTML = loading();
  const org = await get(`/organizations/${id}`);

  // Update sidebar
  S.activeSidebarOrg = id;
  const cached = S.orgs.find((o) => o.id === id);
  if (cached) cached.projects = org.projects;
  renderSidebar();

  const totalNotes = org.projects.reduce((s, p) => s + (+p.note_count || 0), 0);

  el.innerHTML = `
    <div class="page-in">
    <div class="page-header">
      <div class="page-header-left">
        <div class="breadcrumb">
          <a href="#/">Dashboard</a><span class="sep">›</span>
          <span>${esc(org.name)}</span>
        </div>
        <div class="page-title">
          <span class="sb-dot" style="background:${esc(org.color)};width:12px;height:12px"></span>
          ${esc(org.name)}
        </div>
        ${org.description ? `<div class="page-subtitle">${esc(org.description)}</div>` : ""}
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary btn-sm" onclick="openEditOrgModal(${id})">Edit</button>
        <button class="btn btn-danger btn-sm"    onclick="confirmDeleteOrg(${id})">Delete</button>
        <button class="btn btn-primary btn-sm"   onclick="openNewProjectModal(${id})">+ New Project</button>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);max-width:340px;margin-bottom:28px">
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-number">${org.projects.length}</div>
          <div class="stat-label">Projects</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-info">
          <div class="stat-number">${totalNotes}</div>
          <div class="stat-label">Notes</div>
        </div>
      </div>
    </div>

    ${
      org.projects.length
        ? `
    <div class="section-title">Projects</div>
    <div class="projects-grid">
      ${org.projects
        .map(
          (p) => `
        <a class="project-card" href="#/project/${p.id}">
          <div class="project-card-top">
            <span class="project-name">${esc(p.name)}</span>
            <span class="badge badge-${esc(p.status)}">${esc(p.status)}</span>
          </div>
          ${
            p.description
              ? `<div class="project-desc">${esc(p.description)}</div>`
              : `<div class="project-desc" style="font-style:italic;opacity:.5">No description</div>`
          }
          <div class="project-meta">
            <span>📝 ${+p.note_count} note${+p.note_count !== 1 ? "s" : ""}</span>
            <span>${fmtDate(p.updated_at)}</span>
          </div>
        </a>
      `,
        )
        .join("")}
    </div>`
        : `
    <div class="empty">
      <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <h3>No projects yet</h3>
      <p>Create a project to start adding notes.</p>
      <button class="btn btn-primary" onclick="openNewProjectModal(${id})">+ New Project</button>
    </div>`
    }
    </div>
  `;
}

// ─── Project view ─────────────────────────────────────────────────────────────
async function viewProject(id, tab = "story") {
  const el = document.getElementById("content");
  // Switching tabs within the project we're already viewing shouldn't blank
  // the page to a spinner — keep the current content up while the fresh
  // data loads, then fade the new content in once it's ready.
  const isTabSwitch = el.dataset.projectId === String(id);
  if (!isTabSwitch) el.innerHTML = loading();
  const proj = await get(`/projects/${id}`);

  S.activeSidebarOrg = proj.org_id;

  // Fetch org projects, sections, and todo count in parallel
  const needsOrg = !S.orgs.find((o) => o.id === proj.org_id)?.projects;
  const needsSections =
    !S.sections.length || S.sections[0]?.org_id !== proj.org_id;

  const [orgFull, sectionsResult, todosResult] = await Promise.all([
    needsOrg ? get(`/organizations/${proj.org_id}`) : Promise.resolve(null),
    needsSections
      ? get(`/sections?org_id=${proj.org_id}`)
      : Promise.resolve(null),
    get(`/todos?project_id=${id}`).catch(() => []),
  ]);

  if (orgFull) {
    const cached = S.orgs.find((o) => o.id === proj.org_id);
    if (cached) cached.projects = orgFull.projects;
  }
  if (sectionsResult) S.sections = sectionsResult;
  renderSidebar();

  // Fetch todo count for badge
  let todoCount = 0;
  try {
    todoCount = todosResult.filter((t) => t.status !== "done").length;
  } catch (_) {}

  el.dataset.projectId = String(proj.id);
  el.innerHTML = `
    <div class="page-in">
    <div class="page-header">
      <div class="page-header-left">
        <div class="breadcrumb">
          <a href="#/">Dashboard</a><span class="sep">›</span>
          <a href="#/org/${proj.org_id}">${esc(proj.org_name)}</a><span class="sep">›</span>
          <span>${esc(proj.name)}</span>
        </div>
        <div class="page-title">${esc(proj.name)}</div>
        ${proj.description ? `<div class="page-subtitle">${esc(proj.description)}</div>` : ""}
      </div>
      <div class="page-actions">
        <span class="badge badge-${esc(proj.status)}" style="margin-right:4px">${esc(proj.status)}</span>
        <button class="btn btn-secondary btn-sm" onclick="openEditProjectModal(${proj.id})">Edit</button>
        <button class="btn btn-danger btn-sm"    onclick="confirmDeleteProject(${proj.id}, ${proj.org_id})">Delete</button>
        ${tab === "notes" ? `<button class="btn btn-primary btn-sm" onclick="location.hash='#/note/new/${proj.id}'">+ New Note</button>` : ""}
        ${tab === "todos" ? `<button class="btn btn-primary btn-sm" onclick="openNewTodoModal(${proj.id})">+ Add Todo</button>` : ""}
        ${tab === "reminders" ? `<button class="btn btn-primary btn-sm" onclick="openNewReminderModal(${proj.id})">+ Add Reminder</button>` : ""}
      </div>
    </div>

    <div class="project-tabs">
      <a href="#/project/${proj.id}/story" class="project-tab ${tab === "story" ? "active" : ""}">
        Story
      </a>
      <a href="#/project/${proj.id}/notes" class="project-tab ${tab === "notes" ? "active" : ""}">
        Notes
        <span class="tab-count">${proj.notes.length}</span>
      </a>
      <a href="#/project/${proj.id}/todos" class="project-tab ${tab === "todos" ? "active" : ""}">
        Todos
        ${todoCount ? `<span class="tab-count">${todoCount}</span>` : ""}
      </a>
      <a href="#/project/${proj.id}/ideas" class="project-tab ${tab === "ideas" ? "active" : ""}">
        Ideas
      </a>
      <a href="#/project/${proj.id}/reminders" class="project-tab ${tab === "reminders" ? "active" : ""}">
        Reminders
      </a>
    </div>

    <div id="tab-content"></div>
    </div>
  `;

  if (tab === "story") await renderStoryTab(id, proj);
  else if (tab === "notes") renderNotesTab(proj);
  else if (tab === "todos") await renderTodosTab(id, proj, todosResult);
  else if (tab === "ideas") await renderIdeasTab(id);
  else if (tab === "reminders") await renderRemindersTab(id, proj);
}

// ─── Story tab (multi-page, Notion-like) ─────────────────────────────────────
let _storyProjId = null;
let _storyPages = [];
let _storyPageId = null;
let _storyCurrentPage = null;

// ─── Tab filter / sort state ──────────────────────────────────────────────────────────────────────────────
let _tabNotes = [],
  _tabNotesProjId = null,
  _tabNotesFilter = "all",
  _tabNotesSort = "updated";
let _tabTodosFilter = "all";
let _tabIdeasFilter = "all";

function _storySlug(text) {
  return (
    "sh-" +
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
  );
}

function _buildStoryTOC(content) {
  const headings = [];
  for (const line of (content || "").split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim() });
  }
  return headings;
}

async function renderStoryTab(projectId) {
  _storyProjId = projectId;
  _storyPageId = null;
  _storyCurrentPage = null;
  const el = document.getElementById("tab-content");
  el.innerHTML = loading();
  _storyPages = await get(`/projects/${projectId}/story`);

  el.innerHTML = `
    <div class="story-layout">
      <aside class="story-nav" id="story-nav">
        <div class="story-nav-header">
          <span>Pages</span>
          <button class="story-nav-add-btn" onclick="storyAddPage()" title="New page">+</button>
        </div>
        <div class="story-nav-list" id="story-nav-list"></div>
      </aside>
      <div class="story-content" id="story-content">
        <div id="story-page-area"></div>
      </div>
    </div>`;

  _renderStoryNav();
  if (_storyPages.length) {
    await _loadStoryPage(_storyPages[0].id);
  } else {
    _showStoryEmpty();
  }
}

function _renderStoryNav() {
  const list = document.getElementById("story-nav-list");
  if (!list) return;
  list.innerHTML = _storyPages
    .map(
      (p) => `
    <div class="story-nav-item${p.id === _storyPageId ? " active" : ""}"
         onclick="_loadStoryPage(${p.id})" title="${esc(p.title || "Untitled")}">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="story-nav-item-label">${esc(p.title || "Untitled")}</span>
    </div>`,
    )
    .join("");
}

function _showStoryEmpty() {
  const area = document.getElementById("story-page-area");
  if (!area) return;
  area.innerHTML = `
    <div class="story-empty">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <h3>Start your story</h3>
      <p>Document what this project is, its architecture, and key decisions — like a book.</p>
      <button class="btn btn-primary" onclick="storyAddPage()">Create First Page</button>
    </div>`;
}

async function _loadStoryPage(pageId) {
  _storyPageId = pageId;
  _renderStoryNav();
  _storyCurrentPage = await get(`/projects/${_storyProjId}/story/${pageId}`);
  _renderStoryPageView();
}

function _renderStoryPageView() {
  const area = document.getElementById("story-page-area");
  if (!area || !_storyCurrentPage) return;
  const page = _storyCurrentPage;

  const headings = _buildStoryTOC(page.content || "");
  const showTocToggle = headings.length
    ? `<button class="story-toc-toggle" onclick="toggleStoryTOC(true)">On this page</button>`
    : "";
  const tocHtml = headings.length
    ? `<div class="story-toc-overlay" onclick="toggleStoryTOC(false)"></div>
      <aside class="story-page-toc">
        <div class="story-toc-head">
          <div class="story-toc-label">On this page</div>
          <button class="story-toc-close" onclick="toggleStoryTOC(false)" title="Close">✕</button>
        </div>
        ${headings
          .map(
            (h) =>
              `<a class="story-toc-link level-${h.level}" href="#"
                title="${esc(h.text)}"
                onclick="document.getElementById('${_storySlug(h.text)}')?.scrollIntoView({behavior:'smooth'});toggleStoryTOC(false);return false;"
              >${esc(h.text)}</a>`,
          )
          .join("")}
      </aside>`
    : "";

  area.innerHTML = `
    <div class="story-page-view${headings.length ? " has-toc" : ""}">
      <div class="story-page-body">
        <div class="story-page-meta">
          <span class="story-updated">Updated ${fmtDate(page.updated_at)}</span>
          <div style="display:flex;gap:6px">
            ${showTocToggle}
            <button class="btn btn-secondary btn-sm" onclick="storyStartEdit()">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="storyDeletePage(${page.id})">Delete</button>
          </div>
        </div>
        <h1 class="story-title-display">${esc(page.title || "Untitled")}</h1>
        <div class="story-rendered" id="story-rendered"></div>
      </div>
      ${tocHtml}
    </div>`;

  const el = document.getElementById("story-rendered");
  el.classList.toggle("handwritten-text", !!page.handwritten);
  if (page.content?.trim()) {
    const raw = renderRichContent(page.content);
    const withIds = raw.replace(
      /<h([1-3])>(.*?)<\/h\1>/g,
      (_, l, inner) =>
        `<h${l} id="${_storySlug(inner.replace(/<[^>]+>/g, ""))}">${inner}</h${l}>`,
    );
    el.innerHTML = withIds;
    hydrateRichEmbeds(el);
  } else {
    el.innerHTML = `<p class="story-placeholder">Click <strong>Edit</strong> to start writing this page…</p>`;
  }
}

function toggleStoryTOC(open) {
  const view = document.querySelector(".story-page-view");
  if (!view) return;
  view.classList.toggle("story-toc-open", !!open);
}

function storyStartEdit() {
  const area = document.getElementById("story-page-area");
  if (!area || !_storyCurrentPage) return;
  const page = _storyCurrentPage;

  registerRichSurface("story-editor", {
    textareaId: "story-editor",
    entityType: "story",
    getEntityId: () => _storyCurrentPage?.id ?? null,
    handwritten: page.handwritten,
    onChange: () => {
      storyUpdatePreview();
      autoGrow(document.getElementById("story-editor"));
    },
  });

  area.innerHTML = `
    <div class="story-editor-wrap">
      <input id="story-title-input" class="story-title-input"
             value="${esc(page.title || "")}" placeholder="Page title…">
      <div class="story-toolbar">
        <button class="story-tb-btn" title="Bold"          onclick="_storyTbBold()"><b>B</b></button>
        <button class="story-tb-btn" title="Italic"        onclick="_storyTbItalic()"><i>I</i></button>
        <button class="story-tb-btn" title="Strikethrough" onclick="_storyTbStrike()"><s>S</s></button>
        <div class="story-tb-sep"></div>
        <button class="story-tb-btn" title="Heading 1" onclick="_storyTbH('# ')">H1</button>
        <button class="story-tb-btn" title="Heading 2" onclick="_storyTbH('## ')">H2</button>
        <button class="story-tb-btn" title="Heading 3" onclick="_storyTbH('### ')">H3</button>
        <div class="story-tb-sep"></div>
        <button class="story-tb-btn" title="Bullet list"   onclick="_storyTbLine('- ')">•</button>
        <button class="story-tb-btn" title="Numbered list" onclick="_storyTbLine('1. ')">1.</button>
        <button class="story-tb-btn" title="Blockquote"    onclick="_storyTbLine('> ')">❝</button>
        <div class="story-tb-sep"></div>
        <button class="story-tb-btn" title="Inline code"   onclick="_storyTbCode()"><code style="font-size:11px">code</code></button>
        <button class="story-tb-btn" title="Code block"    onclick="_storyTbCodeBlock()">{ }</button>
        <button class="story-tb-btn" title="Link"          onclick="_storyTbLink()">🔗</button>
        <button class="story-tb-btn" title="Divider"       onclick="_storyTbDivider()">—</button>
        <div class="story-tb-sep"></div>
        <button class="story-tb-btn story-tb-img-btn" title="Insert image"
                onclick="document.getElementById('story-img-input').click()">📷 Image</button>
        <input type="file" id="story-img-input" accept="image/*" style="display:none"
               onchange="storyUploadImage(this)">
        <div class="story-tb-sep"></div>
        ${richToolbarHtml("story-editor", { full: false })}
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="story-tb-btn story-view-toggle active" id="story-write-btn"
            onclick="storySetEditorView('write')" title="Write Markdown">Write</button>
          <button class="story-tb-btn story-view-toggle" id="story-preview-btn"
            onclick="storySetEditorView('preview')" title="Preview rendered">Preview</button>
        </div>
      </div>
      <textarea id="story-editor" class="story-editor"
        placeholder="Write in Markdown… paste or drop images to embed them."
        oninput="autoGrow(this);storyUpdatePreview()"
        onpaste="storyHandlePaste(event)"
        ondragover="event.preventDefault()"
        ondrop="storyHandleDrop(event)"></textarea>
      <div id="story-editor-preview" class="story-editor-preview hidden"></div>
      <div class="story-editor-actions">
        <button class="btn btn-primary btn-sm"   onclick="storySavePage()">Save</button>
        <button class="btn btn-secondary btn-sm" onclick="_renderStoryPageView()">Cancel</button>
      </div>
    </div>`;

  document.getElementById("story-editor").value = page.content || "";
  // Auto-size the textarea to its content on load
  setTimeout(() => {
    const ta = document.getElementById("story-editor");
    if (ta) autoGrow(ta);
  }, 0);
  document.getElementById("story-title-input").focus();
}

function storySetEditorView(view) {
  const ta = document.getElementById("story-editor");
  const preview = document.getElementById("story-editor-preview");
  const writBtn = document.getElementById("story-write-btn");
  const prevBtn = document.getElementById("story-preview-btn");
  if (!ta || !preview) return;
  if (view === "preview") {
    preview.innerHTML = renderRichContent(ta.value);
    preview.classList.toggle("handwritten-text", isRichHandwritten("story-editor"));
    hydrateRichEmbeds(preview);
    ta.classList.add("hidden");
    preview.classList.remove("hidden");
    writBtn?.classList.remove("active");
    prevBtn?.classList.add("active");
  } else {
    ta.classList.remove("hidden");
    preview.classList.add("hidden");
    writBtn?.classList.add("active");
    prevBtn?.classList.remove("active");
    ta.focus();
  }
}

function storyUpdatePreview() {
  const preview = document.getElementById("story-editor-preview");
  if (!preview || preview.classList.contains("hidden")) return;
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  preview.innerHTML = renderRichContent(ta.value);
  preview.classList.toggle("handwritten-text", isRichHandwritten("story-editor"));
  hydrateRichEmbeds(preview);
}

// ── Toolbar actions ───────────────────────────────────────────────────────────
function _storyWrap(before, after, placeholder) {
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  const s = ta.selectionStart,
    e = ta.selectionEnd;
  const sel = ta.value.substring(s, e) || placeholder;
  ta.value =
    ta.value.substring(0, s) + before + sel + after + ta.value.substring(e);
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
  ta.focus();
}
function _storyTbBold() {
  _storyWrap("**", "**", "bold text");
}
function _storyTbItalic() {
  _storyWrap("*", "*", "italic text");
}
function _storyTbStrike() {
  _storyWrap("~~", "~~", "strikethrough");
}
function _storyTbCode() {
  _storyWrap("`", "`", "code");
}
function _storyTbCodeBlock() {
  _storyWrap("```\n", "\n```", "code");
}
function _storyTbDivider() {
  _storyTbRaw("\n---\n");
}
function _storyTbH(prefix) {
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  const pos = ta.selectionStart;
  const ls = ta.value.lastIndexOf("\n", pos - 1) + 1;
  const le = ta.value.indexOf("\n", pos);
  const end = le === -1 ? ta.value.length : le;
  const line = ta.value.substring(ls, end).replace(/^#{1,6}\s/, "");
  ta.value =
    ta.value.substring(0, ls) + prefix + line + ta.value.substring(end);
  ta.selectionStart = ta.selectionEnd = ls + prefix.length + line.length;
  ta.focus();
}
function _storyTbLine(prefix) {
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  const pos = ta.selectionStart;
  const ls = ta.value.lastIndexOf("\n", pos - 1) + 1;
  ta.value = ta.value.substring(0, ls) + prefix + ta.value.substring(ls);
  ta.selectionStart = ta.selectionEnd = pos + prefix.length;
  ta.focus();
}
function _storyTbLink() {
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  const s = ta.selectionStart,
    e = ta.selectionEnd;
  const text = ta.value.substring(s, e) || "link text";
  const rep = `[${text}](url)`;
  ta.value = ta.value.substring(0, s) + rep + ta.value.substring(e);
  ta.selectionStart = s + text.length + 3;
  ta.selectionEnd = s + text.length + 6;
  ta.focus();
}
function _storyTbRaw(text) {
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  const pos = ta.selectionStart;
  ta.value =
    ta.value.substring(0, pos) + text + ta.value.substring(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = pos + text.length;
  ta.focus();
}
function _storyInsertAtCursor(text) {
  const ta = document.getElementById("story-editor");
  if (!ta) return;
  const pos = ta.selectionStart;
  ta.value =
    ta.value.substring(0, pos) + text + ta.value.substring(ta.selectionEnd);
  ta.selectionStart = ta.selectionEnd = pos + text.length;
  ta.focus();
}

// ── Image upload ──────────────────────────────────────────────────────────────
async function _storyUploadFile(file) {
  if (!_storyCurrentPage?.id)
    throw new Error("Save the page before uploading images.");
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API}/attachments/${_storyCurrentPage.id}`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
}
async function storyUploadImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = "";
  try {
    const att = await _storyUploadFile(file);
    _storyInsertAtCursor(`![${att.original_name}](${att.url})`);
  } catch (e) {
    alert("Image upload failed: " + e.message);
  }
}
async function storyHandlePaste(event) {
  for (const item of event.clipboardData?.items || []) {
    if (item.type.startsWith("image/")) {
      event.preventDefault();
      try {
        const att = await _storyUploadFile(item.getAsFile());
        _storyInsertAtCursor(`![image](${att.url})`);
      } catch (e) {
        alert("Image upload failed: " + e.message);
      }
      return;
    }
  }
}
async function storyHandleDrop(event) {
  const files = [...(event.dataTransfer?.files || [])].filter((f) =>
    f.type.startsWith("image/"),
  );
  if (!files.length) return;
  event.preventDefault();
  for (const file of files) {
    try {
      const att = await _storyUploadFile(file);
      _storyInsertAtCursor(`![${file.name}](${att.url})\n`);
    } catch (e) {
      alert("Image upload failed: " + e.message);
    }
  }
}

// ── Page CRUD ─────────────────────────────────────────────────────────────────
async function storySavePage() {
  const titleEl = document.getElementById("story-title-input");
  const editorEl = document.getElementById("story-editor");
  if (!titleEl || !editorEl || !_storyCurrentPage) return;
  const title = titleEl.value.trim() || "Untitled";
  const content = editorEl.value;
  const handwritten = isRichHandwritten("story-editor");
  await put(`/projects/${_storyProjId}/story/${_storyCurrentPage.id}`, {
    title,
    content,
    handwritten,
  });
  _storyCurrentPage = {
    ..._storyCurrentPage,
    title,
    content,
    handwritten,
    updated_at: new Date().toISOString(),
  };
  const pg = _storyPages.find((p) => p.id === _storyCurrentPage.id);
  if (pg) {
    pg.title = title;
    pg.updated_at = _storyCurrentPage.updated_at;
  }
  _renderStoryNav();
  _renderStoryPageView();
}

async function storyAddPage() {
  const newPage = await post(`/projects/${_storyProjId}/story`, {
    title: "Untitled",
  });
  _storyPages.push({
    id: newPage.id,
    title: newPage.title,
    updated_at: newPage.updated_at,
  });
  _storyPageId = newPage.id;
  _storyCurrentPage = {
    id: newPage.id,
    title: newPage.title,
    content: "",
    updated_at: newPage.updated_at,
  };
  _renderStoryNav();
  storyStartEdit();
}

async function storyDeletePage(pageId) {
  if (!confirm("Delete this page? This cannot be undone.")) return;
  await del(`/projects/${_storyProjId}/story/${pageId}`);
  _storyPages = _storyPages.filter((p) => p.id !== pageId);
  if (_storyPageId === pageId) {
    _storyPageId = null;
    _storyCurrentPage = null;
  }
  _renderStoryNav();
  if (_storyPages.length) {
    await _loadStoryPage(_storyPages[0].id);
  } else {
    _showStoryEmpty();
  }
}

function renderNotesTab(proj) {
  _tabNotes = proj.notes || [];
  _tabNotesProjId = proj.id;
  _tabNotesFilter = "all";
  _tabNotesSort = "updated";
  const el = document.getElementById("tab-content");
  const pinnedCount = _tabNotes.filter((n) => n.pinned).length;
  const quickCount = _tabNotes.filter((n) => n.type === "quick").length;
  const sketchCount = _tabNotes.filter((n) => n.type === "sketch").length;
  el.innerHTML = `
    <div class="tab-filter-bar">
      <div class="tab-filter-pills" id="notes-filter-pills">
        <button class="tab-pill active" onclick="_setNotesFilter('all',this)">All (${_tabNotes.length})</button>
        ${pinnedCount ? `<button class="tab-pill" onclick="_setNotesFilter('pinned',this)">📌 Pinned (${pinnedCount})</button>` : ""}
        ${quickCount ? `<button class="tab-pill" onclick="_setNotesFilter('quick',this)">⚡ Quick (${quickCount})</button>` : ""}
        ${sketchCount ? `<button class="tab-pill" onclick="_setNotesFilter('sketch',this)">✏️ Sketch (${sketchCount})</button>` : ""}
      </div>
      <div class="tab-filter-right">
        <select class="form-select form-select-sm" onchange="_setNotesSort(this.value)">
          <option value="updated">Sort: Updated</option>
          <option value="title">Sort: Title</option>
          <option value="created">Sort: Created</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="location.hash='#/note/new/${proj.id}'">+ New Note</button>
      </div>
    </div>
    <div id="notes-list-container"></div>`;
  _renderNotesList();
}

function _setNotesFilter(f, btn) {
  _tabNotesFilter = f;
  document
    .querySelectorAll("#notes-filter-pills .tab-pill")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  _renderNotesList();
}

function _setNotesSort(s) {
  _tabNotesSort = s;
  _renderNotesList();
}

function _renderNotesList() {
  const container = document.getElementById("notes-list-container");
  if (!container) return;
  let notes = [..._tabNotes];
  if (_tabNotesFilter === "pinned") notes = notes.filter((n) => n.pinned);
  else if (_tabNotesFilter === "quick")
    notes = notes.filter((n) => n.type === "quick");
  else if (_tabNotesFilter === "sketch")
    notes = notes.filter((n) => n.type === "sketch");
  if (_tabNotesSort === "title")
    notes.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else if (_tabNotesSort === "created")
    notes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!notes.length) {
    container.innerHTML = `<div class="empty" style="padding:40px 0">
      <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <h3>No notes</h3><p>No notes match this filter.</p>
      <button class="btn btn-primary" onclick="location.hash='#/note/new/${_tabNotesProjId}'">+ New Note</button></div>`;
    return;
  }
  container.innerHTML = `<div class="notes-list">${notes
    .map((n) => {
      const tags = parseTags(n.tags);
      return `
    <div class="note-item ${n.pinned ? "is-pinned" : ""}" onclick="location.hash='#/note/${n.id}'">
      <div class="note-item-top">
        <span class="note-title" title="${esc(n.title)}">${n.pinned ? "📌 " : ""}${esc(n.title)}</span>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${n.type === "quick" ? '<span class="badge badge-quick">⚡ Quick</span>' : n.type === "sketch" ? '<span class="badge badge-sketch">✏️ Sketch</span>' : ""}
          <span class="note-time">${fmtDate(n.updated_at)}</span>
        </div>
      </div>
      ${n.excerpt && n.type !== "quick" ? `<div class="note-excerpt">${esc(n.excerpt)}</div>` : n.type === "quick" && n.excerpt ? `<div class="note-excerpt" style="font-family:inherit">${esc(n.excerpt)}</div>` : ""}
      ${tags.length ? `<div class="note-tags">${tagsHtml(tags)}</div>` : ""}
      <div class="note-item-actions" onclick="event.stopPropagation()">
        <button class="note-action-btn${n.pinned ? " active" : ""}" onclick="pinNoteInProject(${n.id},${n.pinned ? 1 : 0})">${n.pinned ? "📌 Unpin" : "📍 Pin"}</button>
        <button class="note-action-btn" onclick="location.hash='#/note/${n.id}'">✎ Edit</button>
        <button class="note-action-btn danger" onclick="deleteNoteInProject(${n.id})">✕ Delete</button>
      </div>
    </div>`;
    })
    .join("")}</div>`;
}

async function pinNoteInProject(noteId, pinned) {
  try {
    await put(`/notes/${noteId}`, { pinned: pinned ? 0 : 1 });
    const note = _tabNotes.find((n) => n.id === noteId);
    if (note) note.pinned = pinned ? 0 : 1;
    _renderNotesList();
    toast(pinned ? "Unpinned" : "Pinned ✓", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteNoteInProject(noteId) {
  if (!confirm("Delete this note? This cannot be undone.")) return;
  try {
    await del(`/notes/${noteId}`);
    _tabNotes = _tabNotes.filter((n) => n.id !== noteId);
    _renderNotesList();
    const pill = document.querySelector("#notes-filter-pills .tab-pill");
    if (pill) pill.textContent = `All (${_tabNotes.length})`;
    toast("Note deleted", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Todos tab ────────────────────────────────────────────────────────────────
async function renderTodosTab(projectId, proj, prefetchedTodos) {
  const el = document.getElementById("tab-content");
  const todos =
    prefetchedTodos ?? (await get(`/todos?project_id=${projectId}`));
  el.innerHTML = buildTodosHTML(todos, projectId);
}

function buildTodosHTML(todos, projectId) {
  const active = todos.filter((t) => t.status !== "done");
  const done = todos.filter((t) => t.status === "done");
  const high = todos.filter((t) => t.priority === "high");
  const medium = todos.filter((t) => t.priority === "medium");
  const low = todos.filter((t) => t.priority === "low");
  return `
    <div class="tab-filter-bar">
      <div class="tab-filter-pills" id="todos-filter-pills">
        <button class="tab-pill active" onclick="_filterTodosDisplay(event,'all')">All (${todos.length})</button>
        <button class="tab-pill" onclick="_filterTodosDisplay(event,'active')">Active (${active.length})</button>
        <button class="tab-pill" onclick="_filterTodosDisplay(event,'done')">Done (${done.length})</button>
        ${high.length ? `<button class="tab-pill" onclick="_filterTodosDisplay(event,'high')">🔴 High (${high.length})</button>` : ""}
        ${medium.length ? `<button class="tab-pill" onclick="_filterTodosDisplay(event,'medium')">🟡 Medium (${medium.length})</button>` : ""}
        ${low.length ? `<button class="tab-pill" onclick="_filterTodosDisplay(event,'low')">🟢 Low (${low.length})</button>` : ""}
      </div>
    </div>
    <div class="todo-add-bar">
      <input type="text" class="form-input" id="todo-quick-input"
        placeholder="Add a todo… (press Enter)"
        onkeydown="if(event.key==='Enter')quickAddTodo(${projectId})"/>
      <select class="form-select" id="todo-quick-priority" style="width:110px">
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="low">Low</option>
      </select>
      <button class="btn btn-primary btn-sm" onclick="quickAddTodo(${projectId})">Add</button>
    </div>
    <div class="todo-list" id="todo-list">
      ${
        active.length === 0 && done.length === 0
          ? `
        <div class="empty" style="padding:40px 0">
          <svg class="empty-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
          <h3>No todos yet</h3><p>Add tasks to track your work.</p>
        </div>`
          : ""
      }
      ${active.map((t) => todoItemHTML(t)).join("")}
      ${
        done.length > 0
          ? `
        <div class="todo-section-label" id="todo-done-label">✓ Completed (${done.length})</div>
        ${done.map((t) => todoItemHTML(t)).join("")}`
          : ""
      }
    </div>`;
}

function _filterTodosDisplay(event, filter) {
  const btn = event.currentTarget;
  document
    .querySelectorAll("#todos-filter-pills .tab-pill")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  const items = document.querySelectorAll("#todo-list .todo-item");
  const label = document.getElementById("todo-done-label");
  let hasDoneVisible = false;
  items.forEach((item) => {
    const status = item.dataset.status;
    const priority = item.dataset.priority;
    let show = true;
    if (filter === "active") show = status !== "done";
    else if (filter === "done") show = status === "done";
    else if (filter === "high") show = priority === "high";
    else if (filter === "medium") show = priority === "medium";
    else if (filter === "low") show = priority === "low";
    item.style.display = show ? "" : "none";
    if (show && status === "done") hasDoneVisible = true;
  });
  if (label) label.style.display = hasDoneVisible ? "" : "none";
}

function todoItemHTML(t) {
  const due = t.due_date ? new Date(t.due_date) : null;
  const isOver = due && due < new Date() && t.status !== "done";
  const statusLabels = {
    todo: "Todo",
    in_progress: "In Progress",
    done: "Done",
  };
  const hasDesc = !!t.description?.trim();
  return `
  <div class="todo-item ${t.status === "done" ? "is-done" : ""}" id="todo-${t.id}" data-status="${t.status}" data-priority="${t.priority}">
    <div class="todo-check ${t.status}" onclick="cycleTodoStatus(${t.id}, '${t.status}')"></div>
    <span class="todo-title" title="${esc(t.title)}">${esc(t.title)}</span>
    <div class="todo-meta">
      ${hasDesc ? `<button class="todo-desc-toggle" onclick="toggleTodoDescription(${t.id})" title="Show description">📄</button>` : ""}
      ${t.priority !== "medium" ? `<span class="priority-badge priority-${t.priority}">${t.priority}</span>` : ""}
      ${due ? `<span class="todo-due ${isOver ? "overdue" : ""}">${isOver ? "⚠" : "📅"} ${t.due_date}</span>` : ""}
      <button class="todo-status-cycle status-${t.status}" onclick="cycleTodoStatus(${t.id}, '${t.status}')">${statusLabels[t.status]}</button>
    </div>
    <div class="todo-actions">
      <button class="todo-action-btn" onclick="openEditTodoModal(${t.id})" title="Edit">✎</button>
      <button class="todo-action-btn" onclick="deleteTodo(${t.id})" title="Delete">✕</button>
    </div>
  </div>
  ${
    hasDesc
      ? `<div class="todo-desc-body hidden ${t.handwritten ? "handwritten-text" : ""}" id="todo-desc-${t.id}" data-content="${esc(t.description)}"></div>`
      : ""
  }`;
}

function toggleTodoDescription(id) {
  const el = document.getElementById(`todo-desc-${id}`);
  if (!el) return;
  const willShow = el.classList.contains("hidden");
  el.classList.toggle("hidden");
  if (willShow && !el.dataset.rendered) {
    el.innerHTML = renderRichContent(el.dataset.content || "");
    el.dataset.rendered = "1";
    hydrateRichEmbeds(el);
  }
}

async function quickAddTodo(projectId) {
  const inp = document.getElementById("todo-quick-input");
  const prio = document.getElementById("todo-quick-priority");
  const title = inp.value.trim();
  if (!title) return;
  try {
    await post("/todos", {
      project_id: projectId,
      title,
      priority: prio.value,
    });
    inp.value = "";
    const todos = await get(`/todos?project_id=${projectId}`);
    const tc = document.getElementById("tab-content");
    if (tc) tc.innerHTML = buildTodosHTML(todos, projectId);
  } catch (e) {
    toast(e.message, "error");
  }
}

async function cycleTodoStatus(id, current) {
  const next = { todo: "in_progress", in_progress: "done", done: "todo" };
  try {
    await put(`/todos/${id}`, { status: next[current] });
    // Re-fetch current project todos
    const projectId = getCurrentProjectId();
    if (projectId) {
      const todos = await get(`/todos?project_id=${projectId}`);
      const tc = document.getElementById("tab-content");
      if (tc) tc.innerHTML = buildTodosHTML(todos, projectId);
    }
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteTodo(id) {
  if (!confirm("Delete this todo?")) return;
  try {
    await del(`/todos/${id}`);
    const projectId = getCurrentProjectId();
    if (projectId) {
      const todos = await get(`/todos?project_id=${projectId}`);
      const tc = document.getElementById("tab-content");
      if (tc) tc.innerHTML = buildTodosHTML(todos, projectId);
    }
  } catch (e) {
    toast(e.message, "error");
  }
}

function getCurrentProjectId() {
  const m = window.location.hash.match(/project\/(\d+)/);
  return m ? +m[1] : null;
}

function openNewTodoModal(projectId) {
  modal(`
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input id="todo-title" class="form-input" placeholder="What needs to be done?" autofocus/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="todo-priority" class="form-select">
            <option value="low">Low</option>
            <option value="medium" selected>Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Due date</label>
          <input id="todo-due" type="date" class="form-input"/>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createTodo(${projectId})">Create</button>
    </div>
  `);
}

async function createTodo(projectId) {
  const title = document.getElementById("todo-title").value.trim();
  const priority = document.getElementById("todo-priority").value;
  const due_date = document.getElementById("todo-due").value || null;
  if (!title) {
    toast("Title is required", "error");
    return;
  }
  try {
    await post("/todos", { project_id: projectId, title, priority, due_date });
    closeModal();
    await viewProject(projectId, "todos");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function openEditTodoModal(id) {
  const todo = await get(`/todos/${id}`);
  registerRichSurface("todo-editor", {
    textareaId: "todo-edit-description",
    entityType: "todo",
    getEntityId: () => id,
    handwritten: todo.handwritten,
    onChange: () => {},
  });
  modal(`
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input id="todo-edit-title" class="form-input" value="${esc(todo.title)}" autofocus/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="form-group">
          <label class="form-label">Priority</label>
          <select id="todo-edit-priority" class="form-select">
            <option value="low" ${todo.priority === "low" ? "selected" : ""}>Low</option>
            <option value="medium" ${todo.priority === "medium" ? "selected" : ""}>Medium</option>
            <option value="high" ${todo.priority === "high" ? "selected" : ""}>High</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Status</label>
          <select id="todo-edit-status" class="form-select">
            <option value="todo" ${todo.status === "todo" ? "selected" : ""}>Todo</option>
            <option value="in_progress" ${todo.status === "in_progress" ? "selected" : ""}>In Progress</option>
            <option value="done" ${todo.status === "done" ? "selected" : ""}>Done</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Due date</label>
        <input id="todo-edit-due" type="date" class="form-input" value="${todo.due_date || ""}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <div class="rich-mini-toolbar">${richToolbarHtml("todo-editor", { full: true })}</div>
        <textarea id="todo-edit-description" class="form-textarea" rows="4">${esc(todo.description || "")}</textarea>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveTodo(${id}, ${todo.project_id})">Save</button>
    </div>
  `);
}

async function saveTodo(id, projectId) {
  const title = document.getElementById("todo-edit-title").value.trim();
  const priority = document.getElementById("todo-edit-priority").value;
  const status = document.getElementById("todo-edit-status").value;
  const due_date = document.getElementById("todo-edit-due").value || null;
  const description = document.getElementById("todo-edit-description")?.value ?? "";
  const handwritten = isRichHandwritten("todo-editor");
  if (!title) {
    toast("Title is required", "error");
    return;
  }
  try {
    await put(`/todos/${id}`, {
      title,
      priority,
      status,
      due_date,
      description,
      handwritten,
    });
    closeModal();
    await viewProject(projectId, "todos");
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Reminders tab (per-project) ─────────────────────────────────────────────
async function renderRemindersTab(projectId, proj) {
  const el = document.getElementById("tab-content");
  el.innerHTML = loading();
  const reminders = await get(`/reminders?project_id=${projectId}`);

  const now = new Date();
  const active = reminders.filter((r) => !r.is_done);
  const overdue = active.filter((r) => new Date(r.remind_at) < now);
  const upcoming = active.filter((r) => new Date(r.remind_at) >= now);
  const done = reminders.filter((r) => r.is_done);

  function reminderCard(r) {
    const dt = new Date(r.remind_at);
    const past = dt < now;
    const label = dt.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `
    <div class="reminder-card ${r.is_done ? "is-done" : past ? "is-overdue" : ""}" id="rem-${r.id}">
      <div class="reminder-card-left">
        <button class="reminder-check ${r.is_done ? "done" : ""}"
          onclick="toggleReminderDoneInProject(${r.id}, ${r.is_done ? 0 : 1}, ${projectId})"
          title="${r.is_done ? "Mark pending" : "Mark done"}">${r.is_done ? "✓" : ""}</button>
      </div>
      <div class="reminder-card-body">
        <div class="reminder-title">${esc(r.title)}</div>
        ${r.note ? `<div class="reminder-note md ${r.handwritten ? "handwritten-text" : ""}">${renderRichContent(r.note)}</div>` : ""}
        <div class="reminder-meta">
          <span class="reminder-time ${past && !r.is_done ? "overdue" : ""}">
            ${past && !r.is_done ? "⚠ Overdue · " : "🔔 "}${label}
          </span>
        </div>
      </div>
      <div class="reminder-card-actions">
        <button class="todo-action-btn" onclick="openEditReminderInProject(${r.id}, ${projectId})" title="Edit">✎</button>
        <button class="todo-action-btn" onclick="deleteReminderInProject(${r.id}, ${projectId})" title="Delete">✕</button>
      </div>
    </div>`;
  }

  el.innerHTML = `
    ${
      overdue.length
        ? `
    <div class="reminder-section">
      <div class="reminder-section-label danger">⚠ Overdue (${overdue.length})</div>
      ${overdue.map(reminderCard).join("")}
    </div>`
        : ""
    }

    <div class="reminder-section">
      <div class="reminder-section-label">Upcoming</div>
      ${
        upcoming.length
          ? upcoming.map(reminderCard).join("")
          : `<div class="reminder-empty">No upcoming reminders. <button class="sb-inline-btn" onclick="openNewReminderModal(${projectId})">Add one</button></div>`
      }
    </div>

    ${
      done.length
        ? `
    <div class="reminder-section">
      <div class="reminder-section-label muted">✓ Done (${done.length})</div>
      ${done.map(reminderCard).join("")}
    </div>`
        : ""
    }
  `;
  hydrateRichEmbeds(el);
}

async function toggleReminderDoneInProject(id, newDone, projectId) {
  try {
    await put(`/reminders/${id}`, { is_done: newDone });
    const proj = await get(`/projects/${projectId}`);
    await renderRemindersTab(projectId, proj);
    refreshReminderBadge();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function openEditReminderInProject(id, projectId) {
  await openEditReminderModal(id);
  // Patch the save button to refresh the project tab instead of global view
  const saveBtn = document.querySelector(".modal-footer .btn-primary");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      await saveReminderInProject(id, projectId);
    };
  }
}

async function saveReminderInProject(id, projectId) {
  const title = document.getElementById("rem-edit-title")?.value.trim();
  const remind_at = document.getElementById("rem-edit-at")?.value;
  const note = document.getElementById("rem-edit-note")?.value.trim() || "";
  const project_id = document.getElementById("rem-edit-project")?.value || null;
  const is_done =
    document.getElementById("rem-edit-done")?.value === "1" ? 1 : 0;
  if (!title) {
    toast("Title is required", "error");
    return;
  }
  if (!remind_at) {
    toast("Remind-at time is required", "error");
    return;
  }
  try {
    await put(`/reminders/${id}`, {
      title,
      remind_at: new Date(remind_at).toISOString(),
      note,
      project_id: project_id || null,
      is_done,
      handwritten: isRichHandwritten("reminder-editor"),
    });
    closeModal();
    toast("Reminder updated", "success");
    const proj = await get(`/projects/${projectId}`);
    await renderRemindersTab(projectId, proj);
    refreshReminderBadge();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteReminderInProject(id, projectId) {
  if (!confirm("Delete this reminder?")) return;
  try {
    await del(`/reminders/${id}`);
    toast("Reminder deleted", "success");
    const proj = await get(`/projects/${projectId}`);
    await renderRemindersTab(projectId, proj);
    refreshReminderBadge();
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Reminders view ──────────────────────────────────────────────────────────
async function viewReminders() {
  const el = document.getElementById("content");
  el.innerHTML = loading();

  const [reminders, orgs] = await Promise.all([
    get("/reminders"),
    get("/organizations"),
  ]);

  // Collect all projects for the dropdown
  const allProjects = [];
  const orgFullResults = await Promise.all(
    orgs.map((org) =>
      get(`/organizations/${org.id}`).catch(() => ({ projects: [] })),
    ),
  );
  orgFullResults.forEach((full, i) => {
    const org = orgs[i];
    (full.projects || []).forEach((p) =>
      allProjects.push({
        id: p.id,
        name: p.name,
        org_name: org.name,
        org_color: org.color,
      }),
    );
  });

  const now = new Date();
  const upcoming = reminders.filter(
    (r) => !r.is_done && new Date(r.remind_at) >= now,
  );
  const overdue = reminders.filter(
    (r) => !r.is_done && new Date(r.remind_at) < now,
  );
  const done = reminders.filter((r) => r.is_done);

  // Update badge
  const badge = document.getElementById("nav-reminders-badge");
  if (badge) {
    const urgentCount =
      overdue.length +
      upcoming.filter((r) => {
        const diff = new Date(r.remind_at) - now;
        return diff < 24 * 60 * 60 * 1000; // within 24 h
      }).length;
    if (urgentCount > 0) {
      badge.textContent = urgentCount;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  function reminderCard(r) {
    const dt = new Date(r.remind_at);
    const past = dt < now;
    const label = dt.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `
    <div class="reminder-card ${r.is_done ? "is-done" : past ? "is-overdue" : ""}" id="rem-${r.id}">
      <div class="reminder-card-left">
        <button class="reminder-check ${r.is_done ? "done" : ""}"
          onclick="toggleReminderDone(${r.id}, ${r.is_done ? 0 : 1})" title="${r.is_done ? "Mark pending" : "Mark done"}">
          ${r.is_done ? "✓" : ""}
        </button>
      </div>
      <div class="reminder-card-body">
        <div class="reminder-title">${esc(r.title)}</div>
        ${r.note ? `<div class="reminder-note md ${r.handwritten ? "handwritten-text" : ""}">${renderRichContent(r.note)}</div>` : ""}
        <div class="reminder-meta">
          <span class="reminder-time ${past && !r.is_done ? "overdue" : ""}">
            ${past && !r.is_done ? "⚠ Overdue · " : "🔔 "}${label}
          </span>
          ${r.project_name ? `<span class="reminder-proj" style="color:${esc(r.org_color || "var(--accent)")}">● ${esc(r.project_name)}</span>` : ""}
        </div>
      </div>
      <div class="reminder-card-actions">
        <button class="todo-action-btn" onclick="openEditReminderModal(${r.id})" title="Edit">✎</button>
        <button class="todo-action-btn" onclick="deleteReminder(${r.id})" title="Delete">✕</button>
      </div>
    </div>`;
  }

  const calUrl = `${location.origin}${BASE}/api/calendar/feed.ics`;
  const webcalUrl = calUrl.replace(/^https?/, "webcal");

  el.innerHTML = `
    <div class="page-in">
      <div class="page-header">
        <div class="page-header-left">
          <div class="page-title">Reminders</div>
          <div class="page-subtitle">${reminders.length} total · ${upcoming.length} upcoming · ${overdue.length} overdue</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" onclick="openNewReminderModal()">+ New Reminder</button>
        </div>
      </div>

      ${
        overdue.length
          ? `
      <div class="reminder-section">
        <div class="reminder-section-label danger">⚠ Overdue (${overdue.length})</div>
        ${overdue.map(reminderCard).join("")}
      </div>`
          : ""
      }

      <div class="reminder-section">
        <div class="reminder-section-label">Upcoming</div>
        ${
          upcoming.length
            ? upcoming.map(reminderCard).join("")
            : `<div class="reminder-empty">No upcoming reminders. <button class="sb-inline-btn" onclick="openNewReminderModal()">Add one</button></div>`
        }
      </div>

      ${
        done.length
          ? `
      <div class="reminder-section">
        <div class="reminder-section-label muted">✓ Done (${done.length})</div>
        ${done.map(reminderCard).join("")}
      </div>`
          : ""
      }

      <div class="reminder-cal-section">
        <div class="reminder-cal-header">📅 Calendar Sync</div>
        <div class="reminder-cal-desc">Subscribe to your todos and reminders in any calendar app that supports iCal (Apple Calendar, Google Calendar, Outlook, etc.).</div>
        <div class="reminder-cal-actions">
          <a class="btn btn-secondary btn-sm" href="${esc(calUrl)}" download="logbook.ics">⬇ Download .ics</a>
          <a class="btn btn-secondary btn-sm" href="${esc(webcalUrl)}">📅 Subscribe (webcal)</a>
        </div>
        <div class="reminder-cal-url">
          <span class="reminder-cal-url-label">Feed URL</span>
          <code class="reminder-cal-url-code" id="cal-url-text">${esc(calUrl)}</code>
          <button class="btn btn-ghost btn-sm" onclick="copyCalUrl()">⎘ Copy</button>
        </div>
        <div class="help" style="margin-top:8px;color:var(--text-dim);font-size:12px">Includes all todos with due dates and all reminders. Re-subscribe to refresh.</div>
      </div>
    </div>
  `;
  hydrateRichEmbeds(el);
}

function copyCalUrl() {
  const url = document.getElementById("cal-url-text")?.textContent;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => toast("URL copied", "success"));
}

function copySettingsCalUrl() {
  const url = `${location.origin}${BASE}/api/calendar/feed.ics`;
  navigator.clipboard.writeText(url).then(() => toast("URL copied", "success"));
}

async function toggleReminderDone(id, newDone) {
  try {
    await put(`/reminders/${id}`, { is_done: newDone });
    await viewReminders();
  } catch (e) {
    toast(e.message, "error");
  }
}

function openNewReminderModal(prefillProjectId = null) {
  const orgsHtml = buildProjectSelect(null, "rem-project");
  // Default to next hour
  const next = new Date(Date.now() + 60 * 60 * 1000);
  next.setMinutes(0, 0, 0);
  const localDt = new Date(next.getTime() - next.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

  registerRichSurface("reminder-editor", {
    textareaId: "rem-note",
    entityType: "reminder",
    getEntityId: () => null,
    handwritten: false,
    onChange: () => {},
  });

  modal(`
    <div class="modal-header">
      <div class="modal-title">New Reminder</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input id="rem-title" class="form-input" placeholder="What do you need to remember?" autofocus/>
      </div>
      <div class="form-group">
        <label class="form-label">Remind at *</label>
        <input id="rem-at" type="datetime-local" class="form-input" value="${localDt}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <div class="rich-mini-toolbar">${richToolbarHtml("reminder-editor", { full: true })}</div>
        <textarea id="rem-note" class="form-textarea" rows="2" placeholder="Optional details…"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Project (optional)</label>
        ${orgsHtml}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createReminder(${prefillProjectId || "null"})">Create</button>
    </div>
  `);
  if (prefillProjectId) {
    const sel = document.getElementById("rem-project");
    if (sel) sel.value = prefillProjectId;
  }
}

async function createReminder(prefillProjectId) {
  const title = document.getElementById("rem-title")?.value.trim();
  const remind_at = document.getElementById("rem-at")?.value;
  const note = document.getElementById("rem-note")?.value.trim() || "";
  const project_id = document.getElementById("rem-project")?.value || null;

  if (!title) {
    toast("Title is required", "error");
    return;
  }
  if (!remind_at) {
    toast("Remind-at time is required", "error");
    return;
  }

  try {
    await post("/reminders", {
      title,
      remind_at: new Date(remind_at).toISOString(),
      note,
      project_id: project_id || null,
      handwritten: isRichHandwritten("reminder-editor"),
    });
    closeModal();
    toast("Reminder created", "success");
    refreshReminderBadge();
    if (prefillProjectId) {
      const proj = await get(`/projects/${prefillProjectId}`);
      await viewProject(prefillProjectId, "reminders");
    } else {
      await viewReminders();
    }
  } catch (e) {
    toast(e.message, "error");
  }
}

async function openEditReminderModal(id) {
  const r = await get(`/reminders/${id}`);
  const orgsHtml = buildProjectSelect(r.project_id, "rem-edit-project");
  const localDt = new Date(
    new Date(r.remind_at).getTime() -
      new Date(r.remind_at).getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);

  registerRichSurface("reminder-editor", {
    textareaId: "rem-edit-note",
    entityType: "reminder",
    getEntityId: () => id,
    handwritten: r.handwritten,
    onChange: () => {},
  });

  modal(`
    <div class="modal-header">
      <div class="modal-title">Edit Reminder</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input id="rem-edit-title" class="form-input" value="${esc(r.title)}" autofocus/>
      </div>
      <div class="form-group">
        <label class="form-label">Remind at *</label>
        <input id="rem-edit-at" type="datetime-local" class="form-input" value="${localDt}"/>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <div class="rich-mini-toolbar">${richToolbarHtml("reminder-editor", { full: true })}</div>
        <textarea id="rem-edit-note" class="form-textarea" rows="2">${esc(r.note)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Project (optional)</label>
        ${orgsHtml}
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select id="rem-edit-done" class="form-select">
          <option value="0" ${!r.is_done ? "selected" : ""}>Pending</option>
          <option value="1" ${r.is_done ? "selected" : ""}>Done</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveReminder(${id})">Save</button>
    </div>
  `);
}

async function saveReminder(id) {
  const title = document.getElementById("rem-edit-title")?.value.trim();
  const remind_at = document.getElementById("rem-edit-at")?.value;
  const note = document.getElementById("rem-edit-note")?.value.trim() || "";
  const project_id = document.getElementById("rem-edit-project")?.value || null;
  const is_done =
    document.getElementById("rem-edit-done")?.value === "1" ? 1 : 0;

  if (!title) {
    toast("Title is required", "error");
    return;
  }
  if (!remind_at) {
    toast("Remind-at time is required", "error");
    return;
  }

  try {
    await put(`/reminders/${id}`, {
      title,
      remind_at: new Date(remind_at).toISOString(),
      note,
      project_id: project_id || null,
      is_done,
      handwritten: isRichHandwritten("reminder-editor"),
    });
    closeModal();
    toast("Reminder updated", "success");
    await viewReminders();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteReminder(id) {
  if (!confirm("Delete this reminder?")) return;
  try {
    await del(`/reminders/${id}`);
    toast("Reminder deleted", "success");
    await viewReminders();
  } catch (e) {
    toast(e.message, "error");
  }
}

/** Build a <select> populated with all projects grouped by org. */
function buildProjectSelect(selectedId, inputId) {
  // Build from S.orgs (already loaded in sidebar)
  const opts = ['<option value="">— No project —</option>'];
  for (const org of S.orgs) {
    if (org.projects?.length) {
      opts.push(`<optgroup label="${esc(org.name)}">`);
      org.projects.forEach((p) => {
        opts.push(
          `<option value="${p.id}" ${String(selectedId) === String(p.id) ? "selected" : ""}>${esc(p.name)}</option>`,
        );
      });
      opts.push("</optgroup>");
    }
  }
  return `<select id="${inputId}" class="form-select">${opts.join("")}</select>`;
}

// ─── Settings page ────────────────────────────────────────────────────────────
async function viewSettings() {
  const el = document.getElementById("content");
  el.innerHTML = loading();
  let cfg = {};
  try {
    cfg = await get("/ai/settings");
  } catch (_) {}

  const provider = cfg.ai_provider || "";
  const model = cfg.ai_model || "";
  const ollUrl = cfg.ollama_url || "http://localhost:11434";
  const hasKey = cfg.ai_api_key && cfg.ai_api_key.length > 0;
  const currentTheme = localStorage.getItem("logbook_theme") || "dark";
  const currentAccent = localStorage.getItem("logbook_accent") || "blue";
  const storageOk = cfg._storageConfigured;

  el.innerHTML = `
    <div class="page-in">
      <div class="page-header">
        <div class="page-header-left">
          <div class="page-title">Settings</div>
          <div class="page-subtitle">Configure your workspace, appearance and integrations</div>
        </div>
      </div>
      <div class="settings-page">
        <div class="settings-grid">

        <!-- ── LEFT COLUMN ─────────────────────────────────────────── -->
        <div class="settings-col">

        <!-- ── Profile ─────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="settings-section-header">👤 Profile</div>
          <div class="settings-row">
            <label>Display Name</label>
            <input id="cfg-user-name" class="form-input" value="${esc(cfg.user_name || "")}" placeholder="Your name">
            <div class="help">Used in dashboard greetings — "Good morning, Alice".</div>
          </div>
          <div class="settings-row">
            <button class="btn btn-primary" onclick="saveProfileSettings()">Save Profile</button>
          </div>
        </div>

        <!-- ── Appearance ───────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="settings-section-header">🎨 Appearance</div>
          <div class="settings-row">
            <label>Theme</label>
            <div class="theme-toggle-row">
              <button class="theme-btn${currentTheme !== "light" ? " active" : ""}" data-theme="dark" onclick="applyTheme('dark')">🌙 Dark</button>
              <button class="theme-btn${currentTheme === "light" ? " active" : ""}" data-theme="light" onclick="applyTheme('light')">☀️ Light</button>
            </div>
          </div>
          <div class="settings-row">
            <label>Accent Color</label>
            <div class="color-swatches">
              ${ACCENT_PALETTE.map((p) => `<button class="color-swatch${currentAccent === p.id ? " active" : ""}" data-accent="${p.id}" style="background:${p.dark}" onclick="applyAccent('${p.id}')" title="${p.id}"></button>`).join("")}
            </div>
            <div class="help">Used for buttons, links and highlights throughout the app.</div>
          </div>
        </div>

        <!-- ── Calendar ─────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="settings-section-header">📅 Calendar Sync</div>
          <div class="settings-row">
            <label>iCal Feed</label>
            <div class="help">Subscribe to your todos (with due dates) and reminders in any calendar app that supports iCal — Apple Calendar, Google Calendar, Outlook, etc.</div>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <a class="btn btn-secondary btn-sm" href="${BASE}/api/calendar/feed.ics" download="logbook.ics">⬇ Download .ics</a>
              <a class="btn btn-secondary btn-sm" href="${(location.origin + BASE + "/api/calendar/feed.ics").replace(/^https?/, "webcal")}">📅 Subscribe (webcal)</a>
              <button class="btn btn-ghost btn-sm" onclick="copySettingsCalUrl()">⎘ Copy URL</button>
            </div>
            <div class="help" style="margin-top:8px;font-size:12px;color:var(--text-dim)">
              Feed URL: <code>${esc(location.origin + (BASE || "") + "/api/calendar/feed.ics")}</code>
            </div>
          </div>
          <div class="settings-row">
            <label>Reminders</label>
            <div class="help">Manage all your reminders from the <a href="#/reminders" style="color:var(--accent)" onclick="closeModal?.()">Reminders page</a>.</div>
          </div>
        </div>

        <!-- ── Import / Export ──────────────────────────────────────── -->
        <div class="settings-section">
          <div class="settings-section-header">📤 Import / Export</div>
          <div class="settings-row">
            <label>Export</label>
            <div class="help">Download all your logbook data as a portable JSON file that can be imported into another Logbook instance.</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
              <button class="btn btn-secondary btn-sm" onclick="exportAllData()">⬇ Export JSON</button>
              <button class="btn btn-secondary btn-sm" onclick="exportAllData('zip')">⬇ Export ZIP (with files)</button>
            </div>
          </div>
          <div class="settings-row">
            <label>Import</label>
            <div class="help">Import from a Logbook export. Existing orgs, projects and labels with the same name are reused; notes, todos and ideas are always added as new. ZIP exports also restore file attachments if storage is configured.</div>
            <div id="import-file-info" style="font-size:11px;color:var(--text-dim);margin-top:4px"></div>
            <div class="transfer-dropzone" style="margin-top:8px"
              onclick="document.getElementById('import-file-input').click()"
              ondragover="event.preventDefault();this.classList.add('drag-over')"
              ondragleave="this.classList.remove('drag-over')"
              ondrop="event.preventDefault();this.classList.remove('drag-over');_handleImportFile(event.dataTransfer.files[0])">
              <input type="file" id="import-file-input" accept=".json,.zip"
                onchange="_handleImportFile(this.files[0])">
              📂 Click or drop a <strong>.json</strong> or <strong>.zip</strong> export file here
            </div>
            <div class="transfer-preview" id="import-preview" style="display:none"></div>
            <button id="import-confirm-btn" class="btn btn-primary btn-sm" style="display:none;margin-top:8px" onclick="confirmImport()">Import</button>
          </div>
        </div>

        </div><!-- /settings-col left -->

        <!-- ── RIGHT COLUMN ────────────────────────────────────────── -->
        <div class="settings-col">

        <!-- ── Storage ──────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="settings-section-header">
            📦 File Storage (MinIO / S3)
            <span class="ai-status-badge ${storageOk ? "configured" : "not-configured"}" style="margin-left:auto">
              ● ${storageOk ? "Configured" : "Not configured — uploads disabled"}
            </span>
          </div>
          <div class="settings-row">
            <div class="help">Connect a MinIO or S3-compatible server to enable file attachments on notes. Leave all fields blank to disable uploads.</div>
          </div>
          <div class="settings-row">
            <label>Endpoint URL</label>
            <input id="cfg-minio-endpoint" class="form-input" value="${esc(cfg.minio_endpoint || "")}" placeholder="http://localhost:9000">
          </div>
          <div class="settings-row">
            <label>Access Key</label>
            <input id="cfg-minio-access" class="form-input" value="${esc(cfg.minio_access_key || "")}" placeholder="minioadmin">
          </div>
          <div class="settings-row">
            <label>Secret Key</label>
            <input id="cfg-minio-secret" type="password" class="form-input"
              placeholder="${cfg.minio_secret_key ? "(saved — enter to update)" : "secret key"}">
          </div>
          <div class="settings-row">
            <label>Bucket Name</label>
            <input id="cfg-minio-bucket" class="form-input" value="${esc(cfg.minio_bucket || "")}" placeholder="logbook">
          </div>
          <div class="settings-row" style="flex-direction:row;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="saveStorageSettings()">Save Storage</button>
            <button class="btn btn-secondary" onclick="clearStorageSettings()">Clear / Disable</button>
          </div>
        </div>

        <!-- ── AI ───────────────────────────────────────────────────── -->
        <div class="settings-section">
          <div class="settings-section-header">
            ✨ AI Integration
            ${
              provider
                ? `<span class="ai-status-badge configured" style="margin-left:auto">● Configured (${provider})</span>`
                : `<span class="ai-status-badge not-configured" style="margin-left:auto">● Not configured</span>`
            }
          </div>
          <div class="settings-row">
            <label>AI Provider</label>
            <div class="help">Choose your AI backend. Ollama is free and runs locally. OpenAI is cloud-based and requires an API key.</div>
            <div class="settings-provider-grid">
              <button class="provider-card ${provider === "" ? "selected" : ""}" onclick="selectProvider('')">
                <span class="provider-card-icon">🚫</span>
                <div class="provider-card-name">None</div>
                <div class="provider-card-desc">Use FTS search only</div>
              </button>
              <button class="provider-card ${provider === "ollama" ? "selected" : ""}" onclick="selectProvider('ollama')">
                <span class="provider-card-icon">🦙</span>
                <div class="provider-card-name">Ollama</div>
                <div class="provider-card-desc">Local, free, private</div>
              </button>
              <button class="provider-card ${provider === "openai" ? "selected" : ""}" onclick="selectProvider('openai')">
                <span class="provider-card-icon">⚡</span>
                <div class="provider-card-name">OpenAI</div>
                <div class="provider-card-desc">Cloud, needs API key</div>
              </button>
            </div>
          </div>
          <div class="settings-row" id="ollama-row" style="${provider !== "ollama" ? "display:none" : ""}">
            <label>Ollama Base URL</label>
            <input id="cfg-ollama-url" class="form-input" value="${esc(ollUrl)}" placeholder="http://localhost:11434"/>
            <div class="help">Default: <code>http://localhost:11434</code> · Service starts automatically on login via Homebrew.<br>
            Run <code>ollama pull qwen2.5:0.5b</code> in terminal to get the tiny model.</div>
          </div>
          <div class="settings-row" id="openai-row" style="${provider !== "openai" ? "display:none" : ""}">
            <label>OpenAI API Key</label>
            <input id="cfg-api-key" type="password" class="form-input" value="" placeholder="${hasKey ? "sk-…(already saved)" : "sk-…"}"/>
            <div class="help">Get your key at <a href="#" onclick="return false" style="color:var(--accent)">platform.openai.com</a>. Stored locally on this server.</div>
          </div>
          <div class="settings-row">
            <label>Model name</label>
            <input id="cfg-model" class="form-input" value="${esc(model)}" placeholder="${provider === "openai" ? "gpt-4o-mini" : "qwen2.5:0.5b"}"/>
            <div class="help">Ollama tiny: <strong>qwen2.5:0.5b</strong> (400MB) · small: llama3.2:1b · OpenAI: gpt-4o-mini, gpt-4o</div>
          </div>
          <div class="settings-row">
            <button class="btn btn-primary" onclick="saveAISettings()">Save AI Settings</button>
            ${provider ? `<button class="btn btn-secondary" style="margin-top:8px" onclick="testAI()">Test Connection</button>` : ""}
          </div>
        </div>

        </div><!-- /settings-col right -->

        </div><!-- /settings-grid -->
      </div>
    </div>
  `;
}

function selectProvider(p) {
  document
    .querySelectorAll(".provider-card")
    .forEach((c) => c.classList.remove("selected"));
  event.currentTarget.classList.add("selected");
  document.getElementById("ollama-row").style.display =
    p === "ollama" ? "" : "none";
  document.getElementById("openai-row").style.display =
    p === "openai" ? "" : "none";
  // Update model placeholder
  const modelInput = document.getElementById("cfg-model");
  if (modelInput) {
    modelInput.placeholder = p === "openai" ? "gpt-4o-mini" : "qwen2.5:0.5b";
    // Pre-fill default model when switching provider and field is empty
    if (!modelInput.value) {
      modelInput.value =
        p === "openai" ? "" : p === "ollama" ? "qwen2.5:0.5b" : "";
    }
  }
}

// ─── Appearance helpers ───────────────────────────────────────────────────────
function _applyAccentVars(id) {
  const p = ACCENT_PALETTE.find((a) => a.id === id) || ACCENT_PALETTE[0];
  const root = document.documentElement.style;
  root.setProperty("--accent", p.light);
  root.setProperty("--accent-dark", p.dark);
  root.setProperty("--accent-bg", p.bg);
  root.setProperty("--accent-ring", p.ring);
}

function applyTheme(theme) {
  document.body.classList.toggle("light", theme === "light");
  localStorage.setItem("logbook_theme", theme);
  document
    .querySelectorAll(".theme-btn")
    .forEach((b) => b.classList.remove("active"));
  document
    .querySelector(`.theme-btn[data-theme="${theme}"]`)
    ?.classList.add("active");
  put("/ai/settings", { theme }).catch(() => {});
}

function applyAccent(id) {
  _applyAccentVars(id);
  localStorage.setItem("logbook_accent", id);
  document
    .querySelectorAll(".color-swatch")
    .forEach((s) => s.classList.remove("active"));
  document
    .querySelector(`.color-swatch[data-accent="${id}"]`)
    ?.classList.add("active");
  put("/ai/settings", { accent_color: id }).catch(() => {});
}

// ─── Section CRUD (DB-backed) ──────────────────────────────────────────────────
function closeSectionMenus() {
  document
    .querySelectorAll(".sb-section-menu")
    .forEach((m) => m.classList.add("hidden"));
}
function toggleSectionMenu(sectionId, orgId, e) {
  e.stopPropagation();
  const menu = document.getElementById(`sb-smenu-${sectionId}`);
  if (!menu) return;
  const wasHidden = menu.classList.contains("hidden");
  closeSectionMenus();
  if (wasHidden) {
    menu.classList.remove("hidden");
    // close on outside click
    const close = (ev) => {
      if (!menu.contains(ev.target)) {
        closeSectionMenus();
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
}

function openNewSidebarSectionModal() {
  const orgId = S.activeSidebarOrg;
  if (!orgId) {
    toast("Select an organization first", "error");
    return;
  }
  modal(`
    <div class="modal-header">
      <div class="modal-title">New Section</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Section name *</label>
        <input class="form-input" id="m-section-name" placeholder="e.g. Technical Notes, Client Work, Personal">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createSectionQuick(${orgId})">Create</button>
    </div>
  `);
}

async function createSectionQuick(orgId) {
  const name = document.getElementById("m-section-name")?.value.trim();
  if (!name) {
    toast("Section name is required", "error");
    return;
  }
  try {
    const s = await post("/sections", { org_id: orgId, name });
    S.sections.push(s);
    closeModal();
    renderSidebar();
    toast(`"${s.name}" section created`, "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function renameSidebarSection(sectionId, currentName) {
  const name = prompt("Rename section:", currentName);
  if (!name || name.trim() === currentName) return;
  try {
    const updated = await put(`/sections/${sectionId}`, { name: name.trim() });
    const idx = S.sections.findIndex((s) => s.id === sectionId);
    if (idx !== -1)
      S.sections[idx] = { ...S.sections[idx], name: updated.name };
    renderSidebar();
    toast("Section renamed", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deleteSidebarSection(sectionId, orgId) {
  if (
    !confirm(
      "Delete this section? Projects will be moved to the first remaining section.",
    )
  )
    return;
  try {
    await del(`/sections/${sectionId}`);
    S.sections = S.sections.filter((s) => s.id !== sectionId);
    const full = await get(`/organizations/${orgId}`);
    const org = S.orgs.find((o) => o.id === orgId);
    if (org) org.projects = full.projects;
    renderSidebar();
    toast("Section deleted", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function saveProfileSettings() {
  const name = document.getElementById("cfg-user-name")?.value.trim() || "";
  try {
    await put("/ai/settings", { user_name: name });
    _userName = name;
    toast("Profile saved", "success");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function saveStorageSettings() {
  const endpoint =
    document.getElementById("cfg-minio-endpoint")?.value.trim() || "";
  const accessKey =
    document.getElementById("cfg-minio-access")?.value.trim() || "";
  const secretKey = document.getElementById("cfg-minio-secret")?.value.trim();
  const bucket =
    document.getElementById("cfg-minio-bucket")?.value.trim() || "";
  const body = {
    minio_endpoint: endpoint,
    minio_access_key: accessKey,
    minio_bucket: bucket,
  };
  if (secretKey) body.minio_secret_key = secretKey;
  try {
    await put("/ai/settings", body);
    toast("Storage settings saved ✓", "success");
    await viewSettings();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function clearStorageSettings() {
  try {
    await put("/ai/settings", {
      minio_endpoint: "",
      minio_access_key: "",
      minio_secret_key: "",
      minio_bucket: "",
    });
    toast("Storage cleared", "success");
    await viewSettings();
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Import / Export helpers ──────────────────────────────────────────────────
function exportAllData(format = "json") {
  const a = document.createElement("a");
  a.href = `${BASE}/api/transfer/export?scope=all&format=${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Export started — check your downloads", "success");
}

function exportScopeData(scope, id) {
  const a = document.createElement("a");
  a.href = `${BASE}/api/transfer/export?scope=${scope}&id=${id}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast("Export started — check your downloads", "success");
}

function exportNoteMarkdown(id) {
  const a = document.createElement("a");
  a.href = `${BASE}/api/transfer/note/${id}/markdown`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function exportSketchPng(id) {
  const canvas = document.querySelector("#note-sketch-view .sketch-canvas");
  if (!canvas) return toast("Sketch not ready yet", "error");
  canvas.toBlob((blob) => {
    if (!blob) return toast("Export failed", "error");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sketch-${id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

let _importFile = null;

function _handleImportFile(file) {
  if (!file || !file.name.endsWith(".json")) {
    toast("Please select a .json export file", "error");
    return;
  }
  _importFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const counts = {
        Organizations: (data.organizations || []).length,
        Projects: (data.projects || []).length,
        Notes: (data.notes || []).length,
        Todos: (data.todos || []).length,
        Ideas: (data.ideas || []).length,
        Labels: (data.labels || []).length,
        Reminders: (data.reminders || []).length,
      };
      const preview = document.getElementById("import-preview");
      const btn = document.getElementById("import-confirm-btn");
      const info = document.getElementById("import-file-info");
      if (info)
        info.textContent = `${file.name} · exported ${data.exported_at ? new Date(data.exported_at).toLocaleDateString() : "unknown"}`;
      if (preview) {
        preview.innerHTML =
          Object.entries(counts)
            .filter(([, v]) => v > 0)
            .map(
              ([k, v]) =>
                `<div class="transfer-preview-item"><div class="transfer-preview-num">${v}</div><div class="transfer-preview-lbl">${k}</div></div>`,
            )
            .join("") ||
          '<span style="color:var(--text-dim);font-size:12px">No data found in file</span>';
        preview.style.display = "flex";
      }
      if (btn) btn.style.display = "";
    } catch (_) {
      toast(
        "Could not parse file — make sure it is a valid Logbook export",
        "error",
      );
    }
  };
  reader.readAsText(file);
}

async function confirmImport() {
  if (!_importFile) return;
  const btn = document.getElementById("import-confirm-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Importing…";
  }
  try {
    const fd = new FormData();
    fd.append("file", _importFile);
    const res = await fetch(`${BASE}/api/transfer/import`, {
      method: "POST",
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Import failed");
    const c = data.counts || {};
    toast(
      `Imported: ${c.notes || 0} notes, ${c.todos || 0} todos, ${c.projects || 0} projects`,
      "success",
    );
    _importFile = null;
    await viewSettings();
  } catch (e) {
    toast(e.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Import";
    }
  }
}

async function saveAISettings() {
  const selected = document.querySelector(".provider-card.selected");
  const provider = selected
    ? selected
        .querySelector(".provider-card-name")
        .textContent.toLowerCase()
        .trim()
    : "";
  const realProvider = provider === "none" ? "" : provider;
  const model = document.getElementById("cfg-model").value.trim();
  const apiKey = document.getElementById("cfg-api-key")?.value.trim();
  const ollUrl = document.getElementById("cfg-ollama-url")?.value.trim();

  const body = { ai_provider: realProvider, ai_model: model };
  if (apiKey) body.ai_api_key = apiKey;
  if (ollUrl) body.ollama_url = ollUrl;

  try {
    await put("/ai/settings", body);
    toast("Settings saved");
    await viewSettings();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function testAI() {
  toast("Testing AI connection…", "info");
  try {
    const res = await post("/ai/ask", {
      question: "Hello, respond with one word: working",
    });
    if (res.error) {
      toast(`AI error: ${res.error}`, "error");
      return;
    }
    if (res.answer)
      toast(`AI is working: "${res.answer.slice(0, 60)}"`, "success");
    else toast("AI not configured — search fallback works", "info");
  } catch (e) {
    toast(`Connection failed: ${e.message}`, "error");
  }
}

// ─── AI Panel ────────────────────────────────────────────────────────────────
function toggleAIPanel() {
  const panel = document.getElementById("ai-panel");
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) {
    document.getElementById("ai-input").focus();
  }
}

// ─── Sidebar collapse ─────────────────────────────────────────────────────────
function toggleSidebar() {
  const app = document.getElementById("app");
  const hidden = app.classList.toggle("sidebar-hidden");
  localStorage.setItem("logbook_sidebar_hidden", hidden ? "1" : "0");
}

function _restoreSidebarState() {
  if (localStorage.getItem("logbook_sidebar_hidden") === "1") {
    document.getElementById("app").classList.add("sidebar-hidden");
  }
}

function fillAIQuery(el) {
  document.getElementById("ai-input").value = el.textContent.trim();
  document.getElementById("ai-input").focus();
}

function appendAIMessage(role, html) {
  const msgs = document.getElementById("ai-messages");
  // Remove welcome screen on first message
  const welcome = msgs.querySelector(".ai-welcome");
  if (welcome) welcome.remove();
  const div = document.createElement("div");
  div.className = `ai-msg ${role}`;
  div.innerHTML = html;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

async function sendAIMessage() {
  const inp = document.getElementById("ai-input");
  const q = inp.value.trim();
  if (!q) return;
  inp.value = "";

  const sendBtn = document.getElementById("ai-send-btn");
  sendBtn.disabled = true;

  appendAIMessage("user", `<div class="ai-bubble">${esc(q)}</div>`);
  const thinkingEl = appendAIMessage(
    "assistant",
    `<div class="ai-thinking"><span></span><span></span><span></span></div>`,
  );

  // Pass project context if on a project page
  const projectId = getCurrentProjectId();
  try {
    const res = await post("/ai/ask", {
      question: q,
      ...(projectId ? { project_id: projectId } : {}),
    });
    thinkingEl.remove();

    let html = "";
    if (res.answer) {
      html += `<div class="ai-bubble">${esc(res.answer)}</div>`;
    }
    if (res.hint) {
      html += `<div class="ai-not-configured">${esc(res.hint)} <a onclick="location.hash='#/settings'; toggleAIPanel()">Configure in Settings →</a></div>`;
    }
    if (res.sources && res.sources.length) {
      html += `<div class="ai-sources">
        <div class="ai-source-label">Relevant notes</div>
        ${res.sources
          .map(
            (s) => `
          <a class="ai-source-card" href="#/note/${s.id}" onclick="if(document.getElementById('ai-panel').classList.contains('open')) toggleAIPanel()">
            <strong>${esc(s.title)}</strong>${s.project_name ? esc(s.project_name) : ""}
          </a>`,
          )
          .join("")}
      </div>`;
    }
    if (!html) html = `<div class="ai-bubble">No relevant notes found.</div>`;
    appendAIMessage("assistant", html);
  } catch (e) {
    thinkingEl.remove();
    appendAIMessage(
      "assistant",
      `<div class="ai-bubble" style="color:var(--danger)">${esc(e.message)}</div>`,
    );
  } finally {
    sendBtn.disabled = false;
  }
}

// ─── Note view ────────────────────────────────────────────────────────────────
function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
function readingTime(text) {
  return Math.max(1, Math.ceil(wordCount(text) / 200));
}

async function viewNote(id) {
  const el = document.getElementById("content");
  el.innerHTML = loading();
  if (S.sketchViewBoard) {
    S.sketchViewBoard.destroy();
    S.sketchViewBoard = null;
  }
  const note = await get(`/notes/${id}`);
  const tags = parseTags(note.tags);
  const isSketch = note.type === "sketch";
  const wc = isSketch ? 0 : wordCount(note.content);
  const rt = isSketch ? 0 : readingTime(note.content);

  S.activeSidebarOrg = note.org_id;
  renderSidebar();

  // Kick off related-notes + attachments fetches in parallel (non-blocking render)
  const projPromise = get(`/projects/${note.project_id}`).catch(() => null);
  const attachPromise = get(`/attachments/${note.id}`).catch(() => []);

  el.innerHTML = `
    <div class="page-in">
    <div class="page-header">
      <div class="page-header-left">
        <div class="breadcrumb">
          <a href="#/">Dashboard</a><span class="sep">›</span>
          <a href="#/org/${note.org_id}">${esc(note.org_name)}</a><span class="sep">›</span>
          <a href="#/project/${note.project_id}">${esc(note.project_name)}</a><span class="sep">›</span>
          <span>${esc(note.title)}</span>
        </div>
      </div>
      <div class="page-actions">
        ${
          isSketch
            ? `<button class="btn btn-ghost btn-sm" onclick="exportSketchPng(${note.id})" title="Export as PNG">⬇ .png</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="exportNoteMarkdown(${note.id})" title="Export as Markdown">⬇ .md</button>`
        }
        <button class="btn btn-ghost btn-sm" onclick="copyNoteLink(${note.id})" title="Copy link">⎘</button>
        <button class="btn btn-ghost btn-sm" onclick="togglePin(${note.id}, ${note.pinned})">
          ${note.pinned ? "📌 Unpin" : "📌 Pin"}
        </button>
        <button class="btn btn-secondary btn-sm" onclick="location.hash='#/note/${note.id}/edit'">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="confirmDeleteNote(${note.id}, ${note.project_id})">Delete</button>
      </div>
    </div>

    <div class="note-view">
      <div class="note-view-header">
        <h1 class="note-view-title">${esc(note.title)}</h1>
        <div class="note-view-meta">
          <span class="badge ${note.type === "quick" ? "badge-quick" : isSketch ? "badge-sketch" : "badge-desc"}">${note.type === "quick" ? "⚡ Quick" : isSketch ? "✏️ Sketch" : "📝 Descriptive"}</span>
          ${isSketch ? "" : `<span class="note-stat-pill">🕐 ${rt} min read</span><span class="note-stat-pill">${wc.toLocaleString()} words</span>`}
          <span>Updated ${fmtDate(note.updated_at)}</span>
          <span>·</span>
          <span>Created ${fmtDate(note.created_at)}</span>
        </div>
        ${
          (note.labels || []).length
            ? `
        <div class="note-view-labels">
          ${(note.labels || [])
            .map(
              (l) =>
                `<span class="label-pill" style="background:${esc(l.color)}22;color:${esc(l.color)};border-color:${esc(l.color)}55">${esc(l.name)}</span>`,
            )
            .join("")}
        </div>`
            : ""
        }
        ${tags.length ? `<div class="note-tags" style="margin-top:8px">${tagsHtml(tags)}</div>` : ""}
      </div>

      ${
        isSketch
          ? `<div class="note-sketch-body" id="note-sketch-view"></div>`
          : note.type === "quick"
            ? `<div class="note-quick-body ${note.handwritten ? "handwritten-text" : ""}">${esc(note.content).replace(/\n/g, "<br>")}</div>`
            : `<div class="md ${note.handwritten ? "handwritten-text" : ""}" id="note-view-body">${renderRichContent(note.content)}</div>`
      }

      ${
        isSketch
          ? ""
          : `<div class="note-ai-actions">
        <button class="note-ai-btn" onclick="summariseNote(${note.id})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
          AI Summary
        </button>
        <button class="note-ai-btn" onclick="askAboutNote(${note.id}, ${JSON.stringify(esc(note.title))})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Ask about this
        </button>
      </div>
      <div id="note-ai-summary-area"></div>`
      }

      <div class="note-attachments-view" id="note-attachments-view">
        <div class="note-related-label" style="margin-top:32px;padding-top:20px;border-top:1px solid var(--border-soft)">
          📎 Attachments <span id="attach-count-badge"></span>
        </div>
        <div id="note-view-attachments"><div class="attach-loading">Loading…</div></div>
      </div>

      <div id="note-related-area"></div>
    </div>
    </div>
  `;

  if (isSketch) {
    const viewEl = document.getElementById("note-sketch-view");
    let data = null;
    try {
      data = note.content ? JSON.parse(note.content) : null;
    } catch {
      data = null;
    }
    if (viewEl) S.sketchViewBoard = createSketchBoard(viewEl, { data, readOnly: true });
  } else if (note.type !== "quick") {
    hydrateRichEmbeds(document.getElementById("note-view-body"));
  }

  // Resolve already-started promises for attachments and related notes
  attachPromise
    .then((items) => {
      const el2 = document.getElementById("note-view-attachments");
      const badge = document.getElementById("attach-count-badge");
      if (!el2) return;
      if (badge && items.length) badge.textContent = `(${items.length})`;
      if (!items.length) {
        el2.innerHTML = `<div class="attach-empty">None</div>`;
        return;
      }
      el2.innerHTML = items
        .map(
          (a) => `
      <a class="attach-item attach-item-view" href="${esc(a.url)}" target="_blank" rel="noopener">
        <span class="attach-icon">${attachIcon(a.mime_type)}</span>
        <span class="attach-name">${esc(a.original_name)}</span>
        <span class="attach-size">${fmtBytes(a.size_bytes)}</span>
      </a>`,
        )
        .join("");
    })
    .catch(() => {
      const el2 = document.getElementById("note-view-attachments");
      if (el2) el2.innerHTML = "";
    });

  projPromise
    .then((proj) => {
      if (!proj) return;
      const related = (proj.notes || [])
        .filter((n) => n.id !== note.id)
        .slice(0, 5);
      if (!related.length) return;
      const relatedEl = document.getElementById("note-related-area");
      if (!relatedEl) return;
      relatedEl.innerHTML = `
      <div class="note-related">
        <div class="note-related-label">More in ${esc(proj.name)}</div>
        ${related
          .map(
            (n) => `
          <a class="note-related-item" href="#/note/${n.id}">
            <span class="note-related-icon">${n.pinned ? "📌" : "📝"}</span>
            <span>${esc(n.title)}</span>
            <span class="note-related-time">${fmtDate(n.updated_at)}</span>
          </a>`,
          )
          .join("")}
      </div>`;
    })
    .catch(() => {});
}

function copyNoteLink(id) {
  const url = `${location.origin}${location.pathname}#/note/${id}`;
  navigator.clipboard
    .writeText(url)
    .then(() => showToast("Link copied", "success"));
}

// ─── Note AI helpers ──────────────────────────────────────────────────────────
async function summariseNote(id) {
  const area = document.getElementById("note-ai-summary-area");
  if (!area) return;
  area.innerHTML = `<div class="note-ai-summary"><div class="note-ai-summary-label">✨ Generating summary…</div><div class="loading" style="padding:10px 0"><div class="spinner"></div></div></div>`;
  try {
    const res = await post(`/ai/summarize/${id}`, {});
    area.innerHTML = `<div class="note-ai-summary"><div class="note-ai-summary-label">✨ AI Summary</div>${md(res.summary)}</div>`;
  } catch (e) {
    area.innerHTML = `<div class="note-ai-summary" style="border-color:var(--danger-border)"><span style="color:var(--danger)">${esc(e.message)}</span> — <a href="#/settings" style="color:var(--accent)">Configure AI in Settings</a></div>`;
  }
}

function askAboutNote(id, title) {
  const panel = document.getElementById("ai-panel");
  panel.classList.add("open");
  const inp = document.getElementById("ai-input");
  inp.value = `Tell me about "${title}"`;
  document.getElementById("ai-input").focus();
}

// ─── Note editor ──────────────────────────────────────────────────────────────
async function viewNoteEditor(noteId, projectId) {
  const el = document.getElementById("content");
  el.innerHTML = loading();

  let note = null;
  let proj = null;
  if (noteId) {
    note = await get(`/notes/${noteId}`);
    projectId = note.project_id;
    S.activeSidebarOrg = note.org_id;
    proj = {
      id: note.project_id,
      name: note.project_name,
      org_id: note.org_id,
      org_name: note.org_name,
    };
  } else if (projectId) {
    proj = await get(`/projects/${projectId}`);
    S.activeSidebarOrg = proj.org_id;
  }

  S.editTags = note ? parseTags(note.tags) : [];
  S.editLabels = note?.labels ? note.labels.map((l) => ({ ...l })) : [];
  S.editType = note?.type ?? "descriptive";
  S.isDirty = false;
  S.editorView = "split";
  if (S.sketchBoard) S.sketchBoard.destroy();
  S.sketchBoard = null;
  S.sketchDraftContent = null;

  // Load label suggestions for autocomplete
  try {
    S.labelSuggestions = await get("/labels");
  } catch {
    S.labelSuggestions = [];
  }

  renderSidebar();

  registerRichSurface("note-editor", {
    textareaId: "et-content",
    entityType: "note",
    getEntityId: () => editorNoteId(),
    handwritten: note?.handwritten,
    onChange: () => {
      refreshPreview();
      markDirty();
      updateEditorWordCount();
    },
  });

  const title = note?.title ?? "";
  const content = note?.content ?? "";
  const isSketch = S.editType === "sketch";
  const editPaneHidden =
    isSketch || (S.editType === "descriptive" && S.editorView === "preview");
  const prevPaneHidden =
    isSketch || S.editType === "quick" || S.editorView === "edit";
  const editorPlaceholder =
    S.editType === "quick" ? "Jot it down…" : "Start writing in Markdown…";

  el.innerHTML = `
    <div class="note-editor page-in">
      <div class="editor-top">
        <div class="breadcrumb" style="margin-bottom:10px">
          <a href="#/">Dashboard</a>
          ${proj ? `<span class="sep">›</span><a href="#/org/${proj.org_id}">${esc(proj.org_name)}</a>` : ""}
          ${proj ? `<span class="sep">›</span><a href="#/project/${proj.id}">${esc(proj.name)}</a>` : ""}
          <span class="sep">›</span>
          <span>${noteId ? "Edit Note" : "New Note"}</span>
        </div>
        <div class="type-toggle">
          <button class="type-btn ${S.editType === "quick" ? "on" : ""}" onclick="setNoteType('quick')">⚡ Quick</button>
          <button class="type-btn ${S.editType === "descriptive" ? "on" : ""}" onclick="setNoteType('descriptive')">📝 Descriptive</button>
          <button class="type-btn ${S.editType === "sketch" ? "on" : ""}" onclick="setNoteType('sketch')">✏️ Sketch</button>
        </div>
        <input class="editor-title" id="et-title" type="text"
          placeholder="${S.editType === "quick" ? "Title (optional — auto-filled from content)" : "Note title…"}" value="${esc(title)}"
          oninput="markDirty()">
        <div class="editor-meta">
          <div class="tags-wrap" id="labels-wrap" onclick="document.getElementById('label-field').focus()">
            ${S.editLabels.map((l) => labelChipHtml(l)).join("")}
            <div class="label-ac-wrap" id="label-ac-wrap">
              <input class="tags-field" id="label-field"
                placeholder="${S.editLabels.length ? "" : "Add labels…"}"
                autocomplete="off"
                oninput="onLabelInput()"
                onkeydown="onLabelKey(event)"
                onfocus="onLabelInput()">
              <div class="label-ac-dropdown hidden" id="label-ac-dropdown"></div>
            </div>
          </div>
          <span class="save-status" id="save-status"></span>
          <span class="editor-wordcount ${isSketch ? "hidden" : ""}" id="editor-wc">${isSketch ? "" : `${wordCount(content).toLocaleString()} words`}</span>
          <div style="display:flex;gap:7px;margin-left:auto">
            <button class="tb-btn ai-grammar-btn" id="grammar-btn" title="AI Grammar Check" onclick="runGrammarCheck()">✦ Grammar</button>
            <button class="tb-btn" id="focus-btn" title="Focus mode" onclick="toggleFocusMode()">⤢</button>
            <button class="btn btn-secondary btn-sm"
              onclick="cancelEdit(${noteId ?? "null"}, ${projectId})">Cancel</button>
            <button class="btn btn-primary btn-sm"
              onclick="saveNote(${noteId ?? "null"}, ${projectId})">Save</button>
          </div>
        </div>
      </div>

      <div class="editor-toolbar${S.editType === "quick" || isSketch ? " hidden" : ""}">
        <button class="tb-btn" title="Bold (Ctrl+B)"         onclick="ins('bold')"><b>B</b></button>
        <button class="tb-btn" title="Italic (Ctrl+I)"       onclick="ins('italic')"><i>I</i></button>
        <button class="tb-btn" title="Strikethrough"         onclick="ins('strike')"><s>S</s></button>
        <div class="tb-sep"></div>
        <button class="tb-btn" title="Heading 1"             onclick="ins('h1')">H1</button>
        <button class="tb-btn" title="Heading 2"             onclick="ins('h2')">H2</button>
        <button class="tb-btn" title="Heading 3"             onclick="ins('h3')">H3</button>
        <div class="tb-sep"></div>
        <button class="tb-btn" title="Bullet list"           onclick="ins('ul')">• List</button>
        <button class="tb-btn" title="Ordered list"          onclick="ins('ol')">1. List</button>
        <button class="tb-btn" title="Blockquote"            onclick="ins('quote')">❝</button>
        <div class="tb-sep"></div>
        <button class="tb-btn" title="Inline code (Ctrl+E)"  onclick="ins('code')">\`code\`</button>
        <button class="tb-btn" title="Code block"            onclick="ins('codeblock')">{ }</button>
        <button class="tb-btn" title="Link"                  onclick="ins('link')">🔗</button>
        <button class="tb-btn" title="Horizontal rule"       onclick="ins('hr')">—</button>
        <button class="tb-btn" title="Table"                 onclick="ins('table')">⊞</button>
        <div class="tb-sep"></div>
        ${richToolbarHtml("note-editor", { full: false })}
        <div class="tb-view">
          <button class="tb-view-btn ${S.editorView === "edit" ? "on" : ""}"    onclick="setView('edit')">Edit</button>
          <button class="tb-view-btn ${S.editorView === "split" ? "on" : ""}"   onclick="setView('split')">Split</button>
          <button class="tb-view-btn ${S.editorView === "preview" ? "on" : ""}" onclick="setView('preview')">Preview</button>
        </div>
      </div>

      <div class="editor-panes">
        <div class="editor-pane ${editPaneHidden ? "hidden" : ""}">
          <textarea class="editor-textarea" id="et-content"
            placeholder="${editorPlaceholder}"
            oninput="autoGrow(this);markDirty();refreshPreview();updateEditorWordCount()"
            onkeydown="onEditorKeyDown(event)">${esc(content)}</textarea>
        </div>
        <div class="editor-pane ${prevPaneHidden ? "hidden" : ""}">
          <div class="editor-preview md ${note?.handwritten ? "handwritten-text" : ""}" id="et-preview">${renderRichContent(content)}</div>
        </div>
      </div>

      <div class="sketch-editor-wrap ${isSketch ? "" : "hidden"}" id="et-sketch"></div>

      <!-- Grammar check results panel (hidden by default) -->
      <div class="grammar-panel hidden" id="grammar-panel">
        <div class="grammar-panel-header">
          <span class="grammar-panel-title">✦ Grammar & Clarity Check</span>
          <button class="grammar-close" onclick="closeGrammarPanel()">✕</button>
        </div>
        <div id="grammar-panel-body"></div>
      </div>

      <!-- Attachments panel (shown for existing notes) -->
      ${
        noteId
          ? `
      <div class="attachments-panel">
        <div class="attachments-header">
          <span class="attachments-title">📎 Attachments</span>
          <label class="attach-upload-btn" title="Attach file">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add file
            <input type="file" class="hidden" id="attach-input" multiple onchange="uploadAttachments(${noteId}, this)">
          </label>
        </div>
        <div id="attach-drop-zone" class="attach-drop-zone" ondragover="event.preventDefault()" ondrop="onAttachDrop(${noteId}, event)">
          <div id="attachments-list" class="attachments-list"><div class="attach-loading">Loading…</div></div>
          <div class="attach-drop-hint">or drag files here</div>
        </div>
      </div>`
          : `
      <div class="attachments-panel">
        <div class="attachments-header">
          <span class="attachments-title">📎 Attachments</span>
        </div>
        <div class="attach-new-hint">Save the note first, then you can attach files.</div>
      </div>`
      }
    </div>
  `;

  if (noteId) loadAttachments(noteId);

  // Auto-size the textarea to its content on load
  setTimeout(() => {
    const ta = document.getElementById("et-content");
    if (ta) autoGrow(ta);
  }, 0);
  hydrateRichEmbeds(document.getElementById("et-preview"));

  if (isSketch) mountSketchEditor(content);
}

function mountSketchEditor(rawContent) {
  const el = document.getElementById("et-sketch");
  if (!el) return;
  let data = null;
  if (rawContent) {
    try {
      data = JSON.parse(rawContent);
    } catch {
      data = null;
    }
  }
  S.sketchBoard = createSketchBoard(el, { data, onChange: markDirty });
}

function setView(v) {
  S.editorView = v;
  document
    .querySelectorAll(".tb-view-btn")
    .forEach((b, i) =>
      b.classList.toggle("on", ["edit", "split", "preview"][i] === v),
    );
  const [editP, prevP] = document.querySelectorAll(".editor-pane");
  if (editP) editP.classList.toggle("hidden", v === "preview");
  if (prevP) prevP.classList.toggle("hidden", v === "edit");
}

function setNoteType(type) {
  const prevType = S.editType;
  if (prevType === "sketch" && type !== "sketch" && S.sketchBoard) {
    S.sketchDraftContent = JSON.stringify(S.sketchBoard.serialize());
    S.sketchBoard.destroy();
    S.sketchBoard = null;
  }

  S.editType = type;
  document
    .querySelectorAll(".type-btn")
    .forEach((b, i) =>
      b.classList.toggle("on", ["quick", "descriptive", "sketch"][i] === type),
    );
  const toolbar = document.querySelector(".editor-toolbar");
  const sketchWrap = document.getElementById("et-sketch");
  if (type === "sketch") {
    if (toolbar) toolbar.classList.add("hidden");
    document
      .querySelectorAll(".editor-pane")
      .forEach((p) => p.classList.add("hidden"));
    if (sketchWrap) {
      sketchWrap.classList.remove("hidden");
      if (!S.sketchBoard) mountSketchEditor(S.sketchDraftContent || "");
    }
  } else {
    if (sketchWrap) sketchWrap.classList.add("hidden");
    if (toolbar) toolbar.classList.toggle("hidden", type === "quick");
    const [editP, prevP] = document.querySelectorAll(".editor-pane");
    if (type === "quick") {
      if (editP) editP.classList.remove("hidden");
      if (prevP) prevP.classList.add("hidden");
    } else {
      setView(S.editorView);
    }
  }
  // Update title placeholder to reflect optional/required
  const titleInput = document.getElementById("et-title");
  if (titleInput) {
    titleInput.placeholder =
      type === "quick"
        ? "Title (optional — auto-filled from content)"
        : "Note title…";
  }
  markDirty();
}

function refreshPreview() {
  const ta = document.getElementById("et-content");
  const pv = document.getElementById("et-preview");
  if (!ta || !pv) return;
  pv.innerHTML = renderRichContent(ta.value);
  pv.classList.toggle("handwritten-text", isRichHandwritten("note-editor"));
  hydrateRichEmbeds(pv);
}

// ─── Auto-save ────────────────────────────────────────────────────────────────
// ─── Auto-growing textarea (Obsidian-like) ────────────────────────────────────
function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight, window.innerHeight * 0.7) + "px";
}

function markDirty() {
  S.isDirty = true;
  setSaveStatus("unsaved");
  clearTimeout(S.autosaveTimer);
  S.autosaveTimer = setTimeout(autosave, 1800);
}

function getEditorContent() {
  if (S.editType === "sketch")
    return S.sketchBoard ? JSON.stringify(S.sketchBoard.serialize()) : "";
  return document.getElementById("et-content")?.value || "";
}

async function autosave() {
  const nid = editorNoteId();
  const pid = editorProjectId();
  if (!nid && !pid) return;

  setSaveStatus("saving");
  const title = document.getElementById("et-title")?.value || "Untitled";
  const content = getEditorContent();
  const tags = JSON.stringify(S.editTags);
  const type = S.editType;
  const handwritten = isRichHandwritten("note-editor");

  try {
    let savedId = nid;
    if (nid) {
      await put(`/notes/${nid}`, { title, content, tags, type, handwritten });
    } else {
      const created = await post("/notes", {
        project_id: pid,
        title,
        content,
        tags,
        type,
        handwritten,
      });
      savedId = created.id;
      // Switch URL to edit mode without re-rendering
      history.replaceState(
        null,
        "",
        `${location.pathname}#/note/${created.id}/edit`,
      );
    }
    // Sync labels
    if (savedId) {
      await post("/labels/sync", {
        note_id: savedId,
        label_ids: S.editLabels.map((l) => l.id),
      });
    }
    S.isDirty = false;
    setSaveStatus("saved");
    await refreshSidebarProjects();
  } catch (e) {
    setSaveStatus("error");
    toast(e.message, "error");
  }
}

function setSaveStatus(s) {
  const el = document.getElementById("save-status");
  if (!el) return;
  const map = {
    unsaved: ["Unsaved", ""],
    saving: ["Saving…", "saving"],
    saved: ["Saved", "saved"],
    error: ["Save failed", "error"],
  };
  const [txt, cls] = map[s] || ["", ""];
  el.textContent = txt;
  el.className = `save-status ${cls}`;
}

function editorNoteId() {
  const m = location.hash.match(/#\/note\/(\d+)\/edit/);
  return m ? +m[1] : null;
}
function editorProjectId() {
  const m = location.hash.match(/#\/note\/new\/(\d+)/);
  return m ? +m[1] : null;
}

async function saveNote(noteId, projectId) {
  // autosave may have already created the note and updated the URL hash;
  // always prefer the real ID from the URL over the stale onclick value
  const actualId = noteId || editorNoteId();

  const title = document.getElementById("et-title")?.value || "Untitled";
  const content = getEditorContent();
  const tags = JSON.stringify(S.editTags);
  const type = S.editType;
  const handwritten = isRichHandwritten("note-editor");

  // Cancel any pending autosave so we don't double-save
  clearTimeout(S.autosaveTimer);
  S.autosaveTimer = null;

  setSaveStatus("saving");
  try {
    let savedId = actualId;
    if (actualId) {
      await put(`/notes/${actualId}`, { title, content, tags, type, handwritten });
      toast("Note saved", "success");
      S.isDirty = false;
    } else {
      const n = await post("/notes", {
        project_id: projectId,
        title,
        content,
        tags,
        type,
        handwritten,
      });
      savedId = n.id;
      toast("Note created", "success");
      S.isDirty = false;
    }
    // Sync labels atomically
    await post("/labels/sync", {
      note_id: savedId,
      label_ids: S.editLabels.map((l) => l.id),
    });
    await refreshSidebarProjects();
    location.hash = `#/note/${savedId}`;
  } catch (e) {
    setSaveStatus("error");
    toast(e.message, "error");
  }
}

function cancelEdit(noteId, projectId) {
  if (S.isDirty && !confirm("Discard unsaved changes?")) return;
  S.isDirty = false;
  location.hash = noteId ? `#/note/${noteId}` : `#/project/${projectId}`;
}

// ─── Tags in editor ───────────────────────────────────────────────────────────
function tagChipHtml(t) {
  return `<span class="tag-chip">${esc(t)}<span class="tag-chip-x" onclick="removeTag('${esc(t).replace(/'/g, "\\'")}');event.stopPropagation()">×</span></span>`;
}

function onTagKey(e) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    const v = e.target.value.trim().replace(/,/g, "");
    if (v && !S.editTags.includes(v)) {
      S.editTags.push(v);
      e.target.value = "";
      redrawTags();
      markDirty();
    } else e.target.value = "";
  } else if (e.key === "Backspace" && !e.target.value && S.editTags.length) {
    S.editTags.pop();
    redrawTags();
    markDirty();
  }
}

function removeTag(t) {
  S.editTags = S.editTags.filter((x) => x !== t);
  redrawTags();
  markDirty();
}

function redrawTags() {
  const wrap = document.getElementById("tags-wrap");
  const field = document.getElementById("tag-field");
  if (!wrap || !field) return;
  wrap.querySelectorAll(".tag-chip").forEach((c) => c.remove());
  S.editTags.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = "tag-chip";
    chip.innerHTML = `${esc(t)}<span class="tag-chip-x" onclick="removeTag('${esc(t).replace(/'/g, "\\'")}');event.stopPropagation()">×</span>`;
    wrap.insertBefore(chip, field);
  });
  field.placeholder = S.editTags.length ? "" : "Add tags (Enter to confirm)…";
}

// ─── Label autocomplete in editor ────────────────────────────────────────────
function labelChipHtml(l) {
  return `<span class="label-chip" style="background:${esc(l.color)}22;color:${esc(l.color)};border-color:${esc(l.color)}55" data-label-id="${l.id}">${esc(l.name)}<span class="label-chip-x" onclick="removeLabelChip(${l.id});event.stopPropagation()">×</span></span>`;
}

function removeLabelChip(id) {
  S.editLabels = S.editLabels.filter((l) => l.id !== id);
  redrawLabelChips();
  markDirty();
}

function redrawLabelChips() {
  const wrap = document.getElementById("labels-wrap");
  const acWrap = document.getElementById("label-ac-wrap");
  if (!wrap || !acWrap) return;
  wrap.querySelectorAll(".label-chip").forEach((c) => c.remove());
  S.editLabels.forEach((l) => {
    const chip = document.createElement("span");
    chip.className = "label-chip";
    chip.dataset.labelId = l.id;
    chip.style.cssText = `background:${l.color}22;color:${l.color};border-color:${l.color}55`;
    chip.innerHTML = `${esc(l.name)}<span class="label-chip-x" onclick="removeLabelChip(${l.id});event.stopPropagation()">×</span>`;
    wrap.insertBefore(chip, acWrap);
  });
  const field = document.getElementById("label-field");
  if (field) field.placeholder = S.editLabels.length ? "" : "Add labels…";
}

let labelAcIndex = -1;

function onLabelInput() {
  const field = document.getElementById("label-field");
  const dropdown = document.getElementById("label-ac-dropdown");
  if (!field || !dropdown) return;

  const q = field.value.trim().toLowerCase();
  const attached = new Set(S.editLabels.map((l) => l.id));

  const matches = S.labelSuggestions.filter(
    (l) => !attached.has(l.id) && (!q || l.name.toLowerCase().includes(q)),
  );

  labelAcIndex = -1;

  if (!matches.length && !q) {
    dropdown.classList.add("hidden");
    return;
  }

  const items = matches.map(
    (l, i) =>
      `<div class="label-ac-item" data-id="${l.id}" onmousedown="selectLabelById(${l.id})">
        <span class="label-ac-dot" style="background:${esc(l.color)}"></span>
        ${esc(l.name)}
      </div>`,
  );

  // "Create new" option when typed name doesn't match exactly
  const exactMatch = matches.some((l) => l.name.toLowerCase() === q);
  if (q && !exactMatch) {
    items.push(
      `<div class="label-ac-item label-ac-new" onmousedown="createAndSelectLabel()">
        + Create "<strong>${esc(field.value.trim())}</strong>"
      </div>`,
    );
  }

  if (!items.length) {
    dropdown.classList.add("hidden");
    return;
  }

  dropdown.innerHTML = items.join("");
  dropdown.classList.remove("hidden");
}

function onLabelKey(e) {
  const dropdown = document.getElementById("label-ac-dropdown");
  const items = dropdown?.querySelectorAll(".label-ac-item") || [];

  if (e.key === "ArrowDown") {
    e.preventDefault();
    labelAcIndex = Math.min(labelAcIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle("active", i === labelAcIndex));
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    labelAcIndex = Math.max(labelAcIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle("active", i === labelAcIndex));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (labelAcIndex >= 0 && items[labelAcIndex]) {
      items[labelAcIndex].dispatchEvent(new MouseEvent("mousedown"));
    } else if (items.length === 1) {
      items[0].dispatchEvent(new MouseEvent("mousedown"));
    } else {
      const field = document.getElementById("label-field");
      if (field?.value.trim()) createAndSelectLabel();
    }
  } else if (e.key === "Escape") {
    hideLabelDropdown();
  }
}

function hideLabelDropdown() {
  document.getElementById("label-ac-dropdown")?.classList.add("hidden");
  labelAcIndex = -1;
}

function selectLabelById(id) {
  const label = S.labelSuggestions.find((l) => l.id === id);
  if (!label || S.editLabels.some((l) => l.id === id)) return;
  S.editLabels.push({ ...label });
  const field = document.getElementById("label-field");
  if (field) field.value = "";
  redrawLabelChips();
  hideLabelDropdown();
  markDirty();
  // Keep focus
  setTimeout(() => field?.focus(), 0);
}

async function createAndSelectLabel() {
  const field = document.getElementById("label-field");
  const name = field?.value.trim();
  if (!name) return;
  try {
    // Pick a color not already used by existing labels
    const usedColors = new Set(S.labelSuggestions.map((l) => l.color));
    const color =
      LABEL_COLORS.find((c) => !usedColors.has(c)) || LABEL_COLORS[0];
    const newLabel = await post("/labels", { name, color });
    S.labelSuggestions.push(newLabel);
    S.editLabels.push({ ...newLabel });
    if (field) field.value = "";
    redrawLabelChips();
    hideLabelDropdown();
    markDirty();
    setTimeout(() => field?.focus(), 0);
  } catch (err) {
    // Label may already exist — find and select it
    const existing = S.labelSuggestions.find(
      (l) => l.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) selectLabelById(existing.id);
  }
}

// Close autocomplete when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest("#label-ac-wrap")) hideLabelDropdown();
});
function ins(type) {
  const ta = document.getElementById("et-content");
  if (!ta) return;

  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.substring(s, e);
  const lStart = ta.value.lastIndexOf("\n", s - 1) + 1;

  let before = "",
    after = "",
    ph = "",
    lineMode = false,
    linePfx = "";

  switch (type) {
    case "bold":
      before = "**";
      after = "**";
      ph = "bold text";
      break;
    case "italic":
      before = "*";
      after = "*";
      ph = "italic text";
      break;
    case "strike":
      before = "~~";
      after = "~~";
      ph = "text";
      break;
    case "code":
      before = "`";
      after = "`";
      ph = "code";
      break;
    case "link":
      before = "[";
      after = "](url)";
      ph = "link text";
      break;
    case "h1":
      lineMode = true;
      linePfx = "# ";
      break;
    case "h2":
      lineMode = true;
      linePfx = "## ";
      break;
    case "h3":
      lineMode = true;
      linePfx = "### ";
      break;
    case "ul":
      lineMode = true;
      linePfx = "- ";
      break;
    case "ol":
      lineMode = true;
      linePfx = "1. ";
      break;
    case "quote":
      lineMode = true;
      linePfx = "> ";
      break;
    case "hr":
      before = "\n---\n";
      after = "";
      ph = "";
      break;
    case "codeblock":
      before = "\n```\n";
      after = "\n```\n";
      ph = "code";
      break;
    case "table":
      before =
        "\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| ";
      after = " |          |          |\n";
      ph = "cell";
      break;
  }

  let newVal, ns, ne;
  if (lineMode) {
    newVal = ta.value.slice(0, lStart) + linePfx + ta.value.slice(lStart);
    ns = s + linePfx.length;
    ne = e + linePfx.length;
  } else {
    const text = sel || ph;
    const rep = before + text + after;
    newVal = ta.value.slice(0, s) + rep + ta.value.slice(e);
    ns = s + before.length;
    ne = sel ? ns + sel.length : ns + ph.length;
  }

  ta.value = newVal;
  ta.selectionStart = ns;
  ta.selectionEnd = ne;
  ta.focus();
  refreshPreview();
  markDirty();
  updateEditorWordCount();
}

// ─── Editor keyboard shortcuts ────────────────────────────────────────────────
function onEditorKeyDown(e) {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return;
  switch (e.key.toLowerCase()) {
    case "b":
      e.preventDefault();
      ins("bold");
      break;
    case "i":
      e.preventDefault();
      ins("italic");
      break;
    case "e":
      e.preventDefault();
      ins("code");
      break;
    case "k":
      e.preventDefault();
      ins("link");
      break;
  }
}

function updateEditorWordCount() {
  const ta = document.getElementById("et-content");
  const el = document.getElementById("editor-wc");
  if (!ta || !el) return;
  const wc = wordCount(ta.value);
  const rt = readingTime(ta.value);
  el.textContent = `${wc.toLocaleString()} words · ${rt} min`;
}

let _focusMode = false;
function toggleFocusMode() {
  _focusMode = !_focusMode;
  document.getElementById("sidebar")?.classList.toggle("hidden", _focusMode);
  document
    .querySelector(".note-editor")
    ?.classList.toggle("focus-mode", _focusMode);
  document.getElementById("focus-btn").title = _focusMode
    ? "Exit focus mode"
    : "Focus mode";
  document.getElementById("focus-btn").style.color = _focusMode
    ? "var(--accent)"
    : "";
}

// ─── AI Grammar check ─────────────────────────────────────────────────────────
async function runGrammarCheck() {
  const ta = document.getElementById("et-content");
  const btn = document.getElementById("grammar-btn");
  const panel = document.getElementById("grammar-panel");
  const body = document.getElementById("grammar-panel-body");
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) return showToast("Nothing to check", "error");

  btn.disabled = true;
  btn.textContent = "✦ Checking…";
  panel.classList.remove("hidden");
  body.innerHTML = `<div class="grammar-loading">Analysing grammar and clarity…</div>`;

  try {
    const data = await post("/ai/grammar-check", { text });

    if (!data.issues?.length) {
      body.innerHTML = `
        <div class="grammar-ok">
          <span class="grammar-ok-icon">✓</span>
          <strong>Looks great!</strong> ${esc(data.summary)}
        </div>`;
    } else {
      body.innerHTML = `
        <div class="grammar-summary">${esc(data.summary)}</div>
        <div class="grammar-issues">
          ${data.issues
            .map(
              (issue, i) => `
            <div class="grammar-issue" id="gi-${i}">
              <div class="grammar-issue-top">
                <span class="grammar-issue-original">"${esc(issue.original)}"</span>
                <span class="grammar-arrow">→</span>
                <span class="grammar-issue-suggestion">"${esc(issue.suggestion)}"</span>
              </div>
              <div class="grammar-issue-reason">${esc(issue.reason)}</div>
              <div class="grammar-issue-actions">
                <button class="btn btn-xs btn-secondary" onclick="applyGrammarFix(${i}, ${JSON.stringify(issue.original)}, ${JSON.stringify(issue.suggestion)})">Apply</button>
                <button class="btn btn-xs btn-ghost" onclick="dismissGrammarIssue(${i})">Ignore</button>
              </div>
            </div>`,
            )
            .join("")}
        </div>
        <div class="grammar-accept-all">
          <button class="btn btn-secondary btn-sm" onclick="applyAllGrammarFixes(${JSON.stringify(data.corrected)})">Apply All Corrections</button>
        </div>`;
    }
  } catch (e) {
    const msg = e.message || "Grammar check failed";
    body.innerHTML = `<div class="grammar-error">${esc(msg)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "✦ Grammar";
  }
}

function closeGrammarPanel() {
  document.getElementById("grammar-panel")?.classList.add("hidden");
}

function applyGrammarFix(idx, original, suggestion) {
  const ta = document.getElementById("et-content");
  if (!ta) return;
  ta.value = ta.value.replace(original, suggestion);
  document.getElementById(`gi-${idx}`)?.remove();
  refreshPreview();
  markDirty();
  updateEditorWordCount();
}

function dismissGrammarIssue(idx) {
  document.getElementById(`gi-${idx}`)?.remove();
}

function applyAllGrammarFixes(corrected) {
  const ta = document.getElementById("et-content");
  if (!ta) return;
  ta.value = corrected;
  refreshPreview();
  markDirty();
  updateEditorWordCount();
  closeGrammarPanel();
  showToast("All corrections applied", "success");
}

// ─── Attachments ──────────────────────────────────────────────────────────────
async function loadAttachments(noteId) {
  const list = document.getElementById("attachments-list");
  if (!list) return;
  try {
    const items = await get(`/attachments/${noteId}`);
    renderAttachments(noteId, items);
  } catch {
    list.innerHTML = `<div class="attach-empty">Could not load attachments</div>`;
  }
}

function renderAttachments(noteId, items) {
  const list = document.getElementById("attachments-list");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="attach-empty">No attachments yet</div>`;
    return;
  }
  list.innerHTML = items
    .map((a) => {
      const icon = attachIcon(a.mime_type);
      const size = fmtBytes(a.size_bytes);
      return `
      <div class="attach-item" id="attach-${a.id}">
        <span class="attach-icon">${icon}</span>
        <a class="attach-name" href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.original_name)}</a>
        <span class="attach-size">${size}</span>
        <button class="attach-del" title="Delete" onclick="deleteAttachment(${noteId}, ${a.id}, '${esc(a.original_name)}')">✕</button>
      </div>`;
    })
    .join("");
}

function attachIcon(mime) {
  if (!mime) return "📄";
  if (mime.startsWith("image/")) return "🖼";
  if (mime.startsWith("video/")) return "🎥";
  if (mime.startsWith("audio/")) return "🎵";
  if (mime.includes("pdf")) return "📕";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("gzip"))
    return "🗜";
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime.includes("csv")
  )
    return "📊";
  if (mime.includes("document") || mime.includes("word")) return "📝";
  return "📄";
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function uploadAttachments(noteId, input) {
  const files = Array.from(input.files);
  if (!files.length) return;
  const progressEl = document.getElementById("attachments-list");
  if (progressEl)
    progressEl.innerHTML += `<div class="attach-uploading">Uploading ${files.length} file(s)…</div>`;

  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      await fetch(`${BASE}/api/attachments/${noteId}`, {
        method: "POST",
        body: fd,
      }).then((r) => r.json());
    } catch (e) {
      showToast(`Upload failed: ${file.name}`, "error");
    }
  }
  input.value = "";
  loadAttachments(noteId);
}

function onAttachDrop(noteId, event) {
  event.preventDefault();
  const files = Array.from(event.dataTransfer.files);
  if (!files.length) return;
  const fakeInput = { files, value: "" };
  uploadAttachments(noteId, fakeInput);
}

async function deleteAttachment(noteId, attachId, name) {
  if (!confirm(`Delete attachment "${name}"?`)) return;
  try {
    await del(`/attachments/file/${attachId}`);
    loadAttachments(noteId);
  } catch {
    showToast("Delete failed", "error");
  }
}

// ─── Pin toggle ───────────────────────────────────────────────────────────────
async function togglePin(noteId, current) {
  try {
    await put(`/notes/${noteId}`, { pinned: current ? 0 : 1 });
    toast(current ? "Unpinned" : "Pinned", "success");
    viewNote(noteId);
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Org modals ───────────────────────────────────────────────────────────────
function openNewOrgModal() {
  modal(`
    <div class="modal-header">
      <div class="modal-title">New Organization</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="form-input" id="m-org-name" placeholder="e.g. Acme Corp">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="m-org-desc" placeholder="Optional"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        ${colorPicker("#6366f1", "org")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="createOrg()">Create</button>
    </div>
  `);
}

async function openEditOrgModal(id) {
  let org = S.orgs.find((o) => o.id === id);
  if (!org) org = await get(`/organizations/${id}`);
  modal(`
    <div class="modal-header">
      <div class="modal-title">Edit Organization</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="form-input" id="m-org-name" value="${esc(org.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="m-org-desc">${esc(org.description)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        ${colorPicker(org.color, "org")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="updateOrg(${id})">Save</button>
    </div>
  `);
}

async function createOrg() {
  const name = document.getElementById("m-org-name")?.value.trim();
  if (!name) {
    toast("Name is required", "error");
    return;
  }
  const description = document.getElementById("m-org-desc")?.value.trim() || "";
  const color = document.getElementById("cp-val-org")?.value || "#6366f1";
  try {
    const org = await post("/organizations", { name, description, color });
    closeModal();
    toast(`"${org.name}" created`, "success");
    await loadSidebar();
    location.hash = `#/org/${org.id}`;
  } catch (e) {
    toast(e.message, "error");
  }
}

async function updateOrg(id) {
  const name = document.getElementById("m-org-name")?.value.trim();
  if (!name) {
    toast("Name is required", "error");
    return;
  }
  const description = document.getElementById("m-org-desc")?.value.trim() || "";
  const color = document.getElementById("cp-val-org")?.value || "#6366f1";
  try {
    await put(`/organizations/${id}`, { name, description, color });
    closeModal();
    toast("Organization updated", "success");
    await loadSidebar();
    viewOrg(id);
  } catch (e) {
    toast(e.message, "error");
  }
}

function confirmDeleteOrg(id) {
  const org = S.orgs.find((o) => o.id === id) || {};
  modal(`
    <div class="modal-header">
      <div class="modal-title">Delete Organization</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="color:var(--text-muted);font-size:13.5px;line-height:1.6">
        Delete <strong style="color:var(--text)">${esc(org.name)}</strong>?<br>
        All projects and notes will be permanently removed.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger"    onclick="deleteOrg(${id})">Delete</button>
    </div>
  `);
}

async function deleteOrg(id) {
  try {
    await del(`/organizations/${id}`);
    closeModal();
    toast("Organization deleted", "success");
    if (S.activeSidebarOrg === id) S.activeSidebarOrg = null;
    await loadSidebar();
    location.hash = "#/";
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Project modals ───────────────────────────────────────────────────────────
function openNewProjectModal(orgId, preselectSectionId) {
  const defaultSectionId = preselectSectionId || S.sections[0]?.id || "";
  modal(`
    <div class="modal-header">
      <div class="modal-title">New Project</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="form-input" id="m-prj-name" placeholder="e.g. Website Redesign">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="m-prj-desc" placeholder="Optional"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="m-prj-status">
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        ${colorPicker("#818cf8", "prj")}
      </div>
      <div class="form-group">
        <label class="form-label">Section</label>
        ${buildSidebarSectionSelect(defaultSectionId, "m-prj-sidebar-section")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="createProject(${orgId})">Create</button>
    </div>
  `);
}

async function openEditProjectModal(id) {
  const proj = await get(`/projects/${id}`);
  const sectionId = proj.section_id || S.sections[0]?.id || "";
  modal(`
    <div class="modal-header">
      <div class="modal-title">Edit Project</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">Name *</label>
        <input class="form-input" id="m-prj-name" value="${esc(proj.name)}">
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="m-prj-desc">${esc(proj.description)}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" id="m-prj-status">
          <option value="active"    ${proj.status === "active" ? "selected" : ""}>Active</option>
          <option value="completed" ${proj.status === "completed" ? "selected" : ""}>Completed</option>
          <option value="archived"  ${proj.status === "archived" ? "selected" : ""}>Archived</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        ${colorPicker(proj.color, "prj")}
      </div>
      <div class="form-group">
        <label class="form-label">Sidebar Section</label>
        ${buildSidebarSectionSelect(sectionId, "m-prj-sidebar-section")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary"   onclick="updateProject(${id}, ${proj.org_id})">Save</button>
    </div>
  `);
}

async function createProject(orgId) {
  const name = document.getElementById("m-prj-name")?.value.trim();
  if (!name) {
    toast("Name is required", "error");
    return;
  }
  const description = document.getElementById("m-prj-desc")?.value.trim() || "";
  const status = document.getElementById("m-prj-status")?.value || "active";
  const color = document.getElementById("cp-val-prj")?.value || "#818cf8";
  const section_id =
    document.getElementById("m-prj-sidebar-section")?.value || null;
  try {
    const proj = await post("/projects", {
      org_id: orgId,
      name,
      description,
      status,
      color,
      section_id: section_id ? Number(section_id) : null,
    });
    closeModal();
    toast(`"${proj.name}" created`, "success");
    await refreshSidebarProjects(orgId);
    location.hash = `#/project/${proj.id}`;
  } catch (e) {
    toast(e.message, "error");
  }
}

async function updateProject(id, orgId) {
  const name = document.getElementById("m-prj-name")?.value.trim();
  if (!name) {
    toast("Name is required", "error");
    return;
  }
  const description = document.getElementById("m-prj-desc")?.value.trim() || "";
  const status = document.getElementById("m-prj-status")?.value || "active";
  const color = document.getElementById("cp-val-prj")?.value || "#818cf8";
  const section_id =
    document.getElementById("m-prj-sidebar-section")?.value || null;
  try {
    await put(`/projects/${id}`, {
      name,
      description,
      status,
      color,
      section_id: section_id ? Number(section_id) : null,
    });
    closeModal();
    toast("Project updated", "success");
    await refreshSidebarProjects(orgId);
    viewProject(id);
  } catch (e) {
    toast(e.message, "error");
  }
}

function confirmDeleteProject(id, orgId) {
  modal(`
    <div class="modal-header">
      <div class="modal-title">Delete Project</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="color:var(--text-muted);font-size:13.5px;line-height:1.6">
        Delete this project? All notes will be permanently removed.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger"    onclick="deleteProject(${id}, ${orgId})">Delete</button>
    </div>
  `);
}

async function deleteProject(id, orgId) {
  try {
    await del(`/projects/${id}`);
    closeModal();
    toast("Project deleted", "success");
    await refreshSidebarProjects(orgId);
    location.hash = `#/org/${orgId}`;
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Note deletion ────────────────────────────────────────────────────────────
function confirmDeleteNote(id, projectId) {
  modal(`
    <div class="modal-header">
      <div class="modal-title">Delete Note</div>
      <button class="btn-icon" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="color:var(--text-muted);font-size:13.5px;line-height:1.6">
        Delete this note? This cannot be undone.
      </p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger"    onclick="deleteNote(${id}, ${projectId})">Delete</button>
    </div>
  `);
}

async function deleteNote(id, projectId) {
  try {
    await del(`/notes/${id}`);
    closeModal();
    toast("Note deleted", "success");
    location.hash = `#/project/${projectId}`;
  } catch (e) {
    toast(e.message, "error");
  }
}

// ─── Sidebar refresh helper ───────────────────────────────────────────────────
async function refreshSidebarProjects(orgId) {
  S.orgs = await get("/organizations");
  const targetId = orgId || S.activeSidebarOrg;
  if (targetId) {
    const org = S.orgs.find((o) => o.id === targetId);
    if (org) {
      const full = await get(`/organizations/${targetId}`);
      org.projects = full.projects;
    }
    S.sections = await get(`/sections?org_id=${targetId}`);
  }
  renderSidebar();
}

// ─── Search ───────────────────────────────────────────────────────────────────
let searchTimer = null;

function setupSearch() {
  // sidebar search is now an openTelescope() button — no-op
}

async function doSearch(q) {
  const el = document.getElementById("content");
  el.innerHTML = loading();
  const results = await get(`/search?q=${encodeURIComponent(q)}`);

  el.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <div class="page-title">Search: "${esc(q)}"</div>
        <div class="page-subtitle">${results.length} result${results.length !== 1 ? "s" : ""}</div>
      </div>
    </div>
    ${
      results.length
        ? results
            .map((r) => {
              const tags = parseTags(r.tags);
              return `
      <a class="search-result" href="#/note/${r.id}">
        <div class="search-result-title">${esc(r.title)}</div>
        <div class="search-result-path">
          <span style="color:${esc(r.org_color)}">●</span>
          ${esc(r.org_name)} › ${esc(r.project_name)}
          <span style="float:right;opacity:.6">${fmtDate(r.updated_at)}</span>
        </div>
        ${r.excerpt ? `<div class="search-result-snip">${esc(r.excerpt)}</div>` : ""}
        ${tags.length ? `<div class="note-tags" style="margin-top:6px">${tagsHtml(tags)}</div>` : ""}
      </a>`;
            })
            .join("")
        : `
    <div class="empty">
      <h3>No results</h3>
      <p>Try different keywords or check spelling.</p>
    </div>`
    }
  `;
}

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key === "s") {
    e.preventDefault();
    const nid = editorNoteId();
    const pid = editorProjectId();
    if (nid || pid) saveNote(nid, pid);
  }
  if (mod && e.key === "k") {
    e.preventDefault();
    openTelescope();
  }
  if (e.key === "Escape") {
    if (!document.getElementById("telescope").classList.contains("hidden")) {
      closeTelescope();
    } else {
      closeModal();
    }
  }

  // Ctrl+B / Ctrl+I inside editor
  if (mod && e.key === "b" && document.activeElement?.id === "et-content") {
    e.preventDefault();
    ins("bold");
  }
  if (mod && e.key === "i" && document.activeElement?.id === "et-content") {
    e.preventDefault();
    ins("italic");
  }
});

// ─── Telescope ────────────────────────────────────────────────────────────────
const LABEL_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#a855f7",
  "#ec4899",
  "#f97316",
  "#06b6d4",
  "#6b7280",
];

let teleTimer = null;
let teleIndex = -1;
let teleFilter = "all";
let teleLabels = [];

async function openTelescope() {
  const wrap = document.getElementById("telescope");
  wrap.classList.remove("hidden");
  const inp = document.getElementById("telescope-input");
  inp.value = "";
  teleIndex = -1;
  teleFilter = "all";

  // load labels for filters
  try {
    teleLabels = await get("/labels");
  } catch {
    teleLabels = [];
  }

  const filtersEl = document.getElementById("telescope-filters");
  filtersEl.innerHTML =
    `<button class="tele-filter-btn active" data-filter="all" onclick="setTeleFilter('all',this)">All</button>` +
    teleLabels
      .map(
        (l) =>
          `<button class="tele-filter-btn" data-filter="${l.id}" onclick="setTeleFilter(${l.id},this)" style="border-color:${esc(l.color)};color:${esc(l.color)}">${esc(l.name)}</button>`,
      )
      .join("");

  document.getElementById("telescope-results").innerHTML =
    '<div class="tele-empty">Type to search your notes</div>';
  requestAnimationFrame(() => inp.focus());
}

function closeTelescope() {
  document.getElementById("telescope").classList.add("hidden");
  clearTimeout(teleTimer);
}

function handleTeleBackdrop(e) {
  if (e.target === document.getElementById("telescope")) closeTelescope();
}

function setTeleFilter(f, el) {
  teleFilter = f;
  document
    .querySelectorAll(".tele-filter-btn")
    .forEach((b) => b.classList.remove("active"));
  el.classList.add("active");
  const q = document.getElementById("telescope-input").value.trim();
  if (q || f !== "all") doTelescopeSearch();
  else {
    document.getElementById("telescope-results").innerHTML =
      '<div class="tele-empty">Type to search your notes</div>';
  }
}

function onTelescopeInput() {
  clearTimeout(teleTimer);
  teleIndex = -1;
  const q = document.getElementById("telescope-input").value.trim();
  if (!q && teleFilter === "all") {
    document.getElementById("telescope-results").innerHTML =
      '<div class="tele-empty">Type to search your notes</div>';
    return;
  }
  teleTimer = setTimeout(doTelescopeSearch, 200);
}

function onTelescopeKey(e) {
  const items = document.querySelectorAll(".tele-result-item");
  if (e.key === "ArrowDown") {
    e.preventDefault();
    teleIndex = Math.min(teleIndex + 1, items.length - 1);
    items.forEach((el, i) => el.classList.toggle("active", i === teleIndex));
    items[teleIndex]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    teleIndex = Math.max(teleIndex - 1, 0);
    items.forEach((el, i) => el.classList.toggle("active", i === teleIndex));
    items[teleIndex]?.scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (teleIndex >= 0 && items[teleIndex]) items[teleIndex].click();
    else if (items.length) items[0].click();
  } else if (e.key === "Escape") {
    closeTelescope();
  }
}

async function doTelescopeSearch() {
  const q = document.getElementById("telescope-input").value.trim();
  const isLabelFilter = teleFilter !== "all";
  if (!q && !isLabelFilter) return;
  const resultsEl = document.getElementById("telescope-results");
  resultsEl.innerHTML = '<div class="tele-empty">Searching…</div>';
  try {
    const labelParam = isLabelFilter ? `&label_id=${teleFilter}` : "";
    const qParam = q ? `q=${encodeURIComponent(q)}` : "q=";
    const results = await get(`/search?${qParam}${labelParam}`);
    renderTelescopeResults(results, resultsEl);
  } catch {
    resultsEl.innerHTML =
      '<div class="tele-empty" style="color:var(--danger)">Search failed</div>';
  }
}

function renderTelescopeResults(results, el) {
  teleIndex = -1;
  if (!results.length) {
    el.innerHTML = '<div class="tele-empty">No results found</div>';
    return;
  }
  el.innerHTML = results
    .map((r, i) => {
      const labels = (r.labels || [])
        .map(
          (l) =>
            `<span class="label-pill" style="background:${esc(l.color)}20;color:${esc(l.color)};border-color:${esc(l.color)}40">${esc(l.name)}</span>`,
        )
        .join("");
      return `<div class="tele-result-item${i === 0 ? " active" : ""}" onclick="closeTelescope();location.hash='#/note/${r.id}'">
      <div class="tele-result-title">${esc(r.title)}</div>
      <div class="tele-result-meta">
        <span style="color:${esc(r.org_color)}">●</span>
        <span>${esc(r.project_name)}</span>
        ${labels}
        <span style="margin-left:auto;color:var(--text-dim)">${fmtDate(r.updated_at)}</span>
      </div>
    </div>`;
    })
    .join("");
  // re-index after render
  teleIndex = 0;
}

// ─── Labels ───────────────────────────────────────────────────────────────────
async function openLabelManager() {
  const labels = await get("/labels");
  const colorBtns = LABEL_COLORS.map(
    (c) =>
      `<button type="button" class="color-swatch" style="background:${c}" data-color="${c}" onclick="this.parentNode.querySelectorAll('.color-swatch').forEach(b=>b.classList.remove('selected'));this.classList.add('selected')"></button>`,
  ).join("");

  modal(`
    <h3 style="margin:0 0 16px">Label Manager</h3>
    <div style="margin-bottom:16px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px" id="lm-color-row">${colorBtns}</div>
      <div style="display:flex;gap:8px">
        <input id="lm-name" class="form-input" placeholder="Label name" style="flex:1" />
        <button class="btn btn-primary btn-sm" onclick="createLabelFromManager()">Add</button>
      </div>
    </div>
    <div id="lm-list">
      ${
        labels.length
          ? labels
              .map(
                (l) => `
        <div class="label-manager-row">
          <span class="label-pill" style="background:${esc(l.color)}20;color:${esc(l.color)};border-color:${esc(l.color)}40">${esc(l.name)}</span>
          <button class="btn-icon-sm" style="color:var(--danger)" onclick="deleteLabelGlobal(${l.id})" title="Delete">✕</button>
        </div>`,
              )
              .join("")
          : '<div style="color:var(--text-dim);font-size:12px">No labels yet</div>'
      }
    </div>
  `);
}

async function createLabelFromManager() {
  const name = document.getElementById("lm-name").value.trim();
  const selEl = document.querySelector(".color-swatch.selected");
  const color = selEl?.dataset.color || LABEL_COLORS[0];
  if (!name) return;
  await post("/labels", { name, color });
  closeModal();
  await openLabelManager();
}

async function deleteLabelGlobal(id) {
  if (!confirm("Delete this label from all notes?")) return;
  await del(`/labels/${id}`);
  closeModal();
  await openLabelManager();
}

async function openNoteLabelPicker(noteId) {
  const [allLabels, note] = await Promise.all([
    get("/labels"),
    get(`/notes/${noteId}`),
  ]);
  const attached = new Set((note.labels || []).map((l) => l.id));

  modal(`
    <h3 style="margin:0 0 14px">Labels for this note</h3>
    <div id="nlp-list" style="display:flex;flex-direction:column;gap:8px">
      ${
        allLabels.length
          ? allLabels
              .map((l) => {
                const on = attached.has(l.id);
                return `<div class="label-pick-row" onclick="toggleNoteLabel(${noteId},${l.id},${on},this)">
          <span class="label-pill" style="background:${esc(l.color)}20;color:${esc(l.color)};border-color:${esc(l.color)}40">${esc(l.name)}</span>
          <span class="label-pick-check">${on ? "✓" : ""}</span>
        </div>`;
              })
              .join("")
          : '<div style="color:var(--text-dim);font-size:12px">No labels. <a href="#" onclick="closeModal();openLabelManager()">Create one</a></div>'
      }
    </div>
    <div style="margin-top:16px;display:flex;justify-content:space-between">
      <button class="btn btn-ghost btn-sm" onclick="closeModal();openLabelManager()">Manage Labels</button>
      <button class="btn btn-sm" onclick="closeModal()">Done</button>
    </div>
  `);
}

async function toggleNoteLabel(noteId, labelId, isOn, rowEl) {
  try {
    if (isOn) {
      await post("/labels/detach", { note_id: noteId, label_id: labelId });
    } else {
      await post("/labels/attach", { note_id: noteId, label_id: labelId });
    }
    const checkEl = rowEl.querySelector(".label-pick-check");
    if (checkEl) checkEl.textContent = isOn ? "" : "✓";
    rowEl.onclick = () => toggleNoteLabel(noteId, labelId, !isOn, rowEl);
  } catch (err) {
    alert("Failed: " + err.message);
  }
}

// ─── Ideas tab ────────────────────────────────────────────────────────────────
async function renderIdeasTab(projectId) {
  const el = document.getElementById("tab-content");
  el.innerHTML = loading();
  const ideas = await get(`/ideas?project_id=${projectId}`);
  el.innerHTML = buildIdeasHTML(ideas, projectId);
}

function buildIdeasHTML(ideas, projectId) {
  const aiCount = ideas.filter((i) => i.source !== "manual").length;
  const manualCount = ideas.filter((i) => i.source === "manual").length;
  return `
    <div class="tab-filter-bar">
      <div class="tab-filter-pills" id="ideas-filter-pills">
        <button class="tab-pill active" onclick="_filterIdeasDisplay(event,'all')">All (${ideas.length})</button>
        ${aiCount ? `<button class="tab-pill" onclick="_filterIdeasDisplay(event,'ai')">✦ AI (${aiCount})</button>` : ""}
        ${manualCount ? `<button class="tab-pill" onclick="_filterIdeasDisplay(event,'manual')">Manual (${manualCount})</button>` : ""}
      </div>
    </div>
    <div class="ideas-add-row">
      <input id="idea-input" class="form-input" placeholder="New idea or backlog item…" style="flex:1"
        onkeydown="if(event.key==='Enter')quickAddIdea(${projectId})" />
      <button class="btn btn-primary btn-sm" onclick="quickAddIdea(${projectId})">+ Add</button>
      <button class="btn btn-ghost btn-sm ideas-ai-btn" onclick="aiSuggestIdeas(${projectId})" title="AI suggests ideas">✦ AI Suggest</button>
    </div>

    <div id="ideas-list">
      ${
        ideas.length
          ? ideas.map((idea) => ideaItemHTML(idea, projectId)).join("")
          : `
        <div class="empty" style="padding:32px 0">
          <p style="color:var(--text-dim)">No ideas yet. Add a backlog item or let AI suggest some.</p>
        </div>`
      }
    </div>
  `;
}

function _filterIdeasDisplay(event, filter) {
  const btn = event.currentTarget;
  document
    .querySelectorAll("#ideas-filter-pills .tab-pill")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll("#ideas-list .idea-item").forEach((item) => {
    const src = item.dataset.source;
    let show = true;
    if (filter === "ai") show = src !== "manual";
    else if (filter === "manual") show = src === "manual";
    item.style.display = show ? "" : "none";
  });
}

function ideaItemHTML(idea, projectId) {
  const sourceBadge =
    idea.source !== "manual"
      ? `<span class="badge" style="background:var(--accent)20;color:var(--accent)">${esc(idea.source)}</span>`
      : "";
  return `<div class="idea-item" id="idea-${idea.id}" data-source="${idea.source}">
    <span class="idea-bulb">💡</span>
    <span class="idea-text">${esc(idea.text)}</span>
    ${sourceBadge}
    <div class="idea-actions">
      <button class="btn btn-ghost btn-sm" onclick="promoteIdea(${idea.id},${projectId})" title="Promote to Todo">→ Todo</button>
      <button class="btn-icon-sm" style="color:var(--danger)" onclick="deleteIdea(${idea.id},${projectId})" title="Delete">✕</button>
    </div>
  </div>`;
}

async function quickAddIdea(projectId) {
  const inp = document.getElementById("idea-input");
  const text = inp?.value.trim();
  if (!text) return;
  await post("/ideas", { project_id: projectId, text, source: "manual" });
  inp.value = "";
  await renderIdeasTab(projectId);
}

async function deleteIdea(id, projectId) {
  await del(`/ideas/${id}`);
  await renderIdeasTab(projectId);
}

async function promoteIdea(id, projectId) {
  await post(`/ideas/${id}/promote`, {});
  await renderIdeasTab(projectId);
  // refresh todos count in tab header
  location.hash = `#/project/${projectId}/todos`;
}

async function aiSuggestIdeas(projectId) {
  const btn = document.querySelector(".ideas-ai-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Thinking…";
  }

  try {
    const proj = await get(`/projects/${projectId}`);
    const prompt = `You are a helpful engineering assistant. Suggest 5 concrete backlog ideas or improvement tasks for the project "${proj.name}". ${proj.description ? "Project description: " + proj.description : ""} Return only a plain numbered list, one idea per line.`;

    const res = await post("/ai/ask", {
      question: prompt,
      projectId,
      maxNotes: 0,
    });
    const lines = (res.answer || "")
      .split("\n")
      .map((l) => l.replace(/^[\d]+[.)]\s*/, "").trim())
      .filter((l) => l.length > 5 && l.length < 300);

    if (!lines.length) throw new Error("No ideas returned");

    await Promise.all(
      lines.map((text) =>
        post("/ideas", { project_id: projectId, text, source: "ai" }),
      ),
    );
    await renderIdeasTab(projectId);
    showToast(`Added ${lines.length} AI ideas`);
  } catch (err) {
    showToast("AI suggest failed: " + err.message, "error");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✦ AI Suggest";
    }
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const tc = document.getElementById("toast-container");
  if (!tc) return;
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  tc.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
function renderBootError(err) {
  const target = document.getElementById("content");
  if (!target) return;
  target.innerHTML = `
    <div class="card" style="max-width:760px;margin:28px auto;padding:18px;">
      <h2 style="margin-bottom:8px;">UI failed to load</h2>
      <p style="color:var(--text-muted);margin-bottom:12px;">Logbook hit a startup error. You can retry without refreshing the browser.</p>
      <pre style="white-space:pre-wrap;background:var(--bg-elevated);border:1px solid var(--border-soft);border-radius:8px;padding:10px;color:var(--danger);font-size:12px;max-height:180px;overflow:auto;">${esc(err?.message || String(err || "Unknown error"))}</pre>
      <div style="margin-top:12px;display:flex;gap:8px;">
        <button class="btn" onclick="window.location.reload()">Reload page</button>
        <button class="btn btn-secondary" onclick="boot().catch((e)=>{console.error(e);renderBootError(e);})">Retry boot</button>
      </div>
    </div>`;
}

async function boot() {
  // Apply persisted theme & accent before any content renders
  const _savedTheme = localStorage.getItem("logbook_theme") || "dark";
  const _savedAccent = localStorage.getItem("logbook_accent");
  if (_savedTheme === "light") document.body.classList.add("light");
  if (_savedAccent) _applyAccentVars(_savedAccent);
  _restoreSidebarState();

  if (typeof marked !== "undefined" && typeof marked.use === "function") {
    marked.use({ breaks: true, gfm: true });
  } else {
    window.marked = {
      parse(input) {
        return `<pre class="md-fallback">${esc(input)}</pre>`;
      },
      use() {},
    };
  }

  await loadSidebar();
  bindSidebarGlobalNavCollapse();

  // Populate user name for greetings (non-blocking)
  get("/ai/settings")
    .then((cfg) => {
      _userName = cfg.user_name || "";
    })
    .catch(() => {});

  setupSearch();
  refreshReminderBadge();

  window.addEventListener("hashchange", route);
  await route();
}

/** Update the sidebar reminder badge with overdue/soon count (non-blocking). */
async function refreshReminderBadge() {
  try {
    const reminders = await get("/reminders?done=0");
    const now = Date.now();
    const urgentCount = reminders.filter((r) => {
      const diff = new Date(r.remind_at) - now;
      return diff < 24 * 60 * 60 * 1000; // overdue OR within 24 h
    }).length;
    const badge = document.getElementById("nav-reminders-badge");
    if (!badge) return;
    if (urgentCount > 0) {
      badge.textContent = urgentCount;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  } catch (_) {}
}

boot().catch((err) => {
  console.error(err);
  renderBootError(err);
});
