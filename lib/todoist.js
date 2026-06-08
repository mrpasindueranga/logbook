const TODOIST_API_BASE = "https://api.todoist.com/rest/v2";

function getTodoistToken() {
  return process.env.TODOIST_API_TOKEN?.trim() || "";
}

function getTodoistDefaultProjectId() {
  return process.env.TODOIST_PROJECT_ID?.trim() || "";
}

function isTodoistEnabled() {
  return Boolean(getTodoistToken());
}

function mapPriorityToTodoist(priority) {
  if (priority === "high") return 4;
  if (priority === "medium") return 3;
  return 1;
}

function toIsoDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function requestTodoist(path, options = {}) {
  const token = getTodoistToken();
  if (!token) {
    const err = new Error("Todoist token is not configured");
    err.code = "TODOIST_NOT_CONFIGURED";
    throw err;
  }

  const res = await fetch(`${TODOIST_API_BASE}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Todoist API ${res.status}: ${text || res.statusText}`,
    );
    err.code = "TODOIST_API_ERROR";
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

async function createTaskFromTodo(todo, projectName = "") {
  const body = {
    content: todo.title,
    priority: mapPriorityToTodoist(todo.priority),
  };

  const dueDate = toIsoDateOnly(todo.due_date);
  if (dueDate) body.due_date = dueDate;

  const configuredProjectId = getTodoistDefaultProjectId();
  if (configuredProjectId) body.project_id = configuredProjectId;

  if (projectName) body.description = `Logbook project: ${projectName}`;

  return requestTodoist("/tasks", { method: "POST", body });
}

async function updateTaskFromTodo(todoistTaskId, todo) {
  const body = {
    content: todo.title,
    priority: mapPriorityToTodoist(todo.priority),
  };

  const dueDate = toIsoDateOnly(todo.due_date);
  if (dueDate) body.due_date = dueDate;

  return requestTodoist(`/tasks/${todoistTaskId}`, { method: "POST", body });
}

async function closeTask(todoistTaskId) {
  return requestTodoist(`/tasks/${todoistTaskId}/close`, { method: "POST" });
}

async function reopenTask(todoistTaskId) {
  return requestTodoist(`/tasks/${todoistTaskId}/reopen`, { method: "POST" });
}

async function deleteTask(todoistTaskId) {
  return requestTodoist(`/tasks/${todoistTaskId}`, { method: "DELETE" });
}

module.exports = {
  isTodoistEnabled,
  createTaskFromTodo,
  updateTaskFromTodo,
  closeTask,
  reopenTask,
  deleteTask,
};
