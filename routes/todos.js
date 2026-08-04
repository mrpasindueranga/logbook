const express = require("express");
const router = express.Router();
const db = require("../database/db");
const { log } = require("../lib/logger");
const {
  isTodoistEnabled,
  createTaskFromTodo,
  updateTaskFromTodo,
  closeTask,
  reopenTask,
  deleteTask,
} = require("../lib/todoist");

async function syncTodoCreated(todo, projectName = "") {
  if (!isTodoistEnabled()) return;
  try {
    const remote = await createTaskFromTodo(todo, projectName);
    if (!remote?.id) return;
    await db.run(
      `UPDATE todos
       SET todoist_task_id = $1, todoist_last_sync_at = NOW(), updated_at = NOW()
       WHERE id = $2`,
      [String(remote.id), todo.id],
    );
  } catch (err) {
    console.warn("[todoist] create sync failed:", err.message);
  }
}

async function syncTodoUpdated(before, after) {
  if (!isTodoistEnabled()) return;

  try {
    let todoistTaskId = after.todoist_task_id || before.todoist_task_id;

    if (!todoistTaskId) {
      await syncTodoCreated(after);
      return;
    }

    await updateTaskFromTodo(todoistTaskId, after);

    if (before.status !== after.status) {
      if (after.status === "done") await closeTask(todoistTaskId);
      if (before.status === "done" && after.status !== "done")
        await reopenTask(todoistTaskId);
    }

    await db.run(
      `UPDATE todos
       SET todoist_last_sync_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [after.id],
    );
  } catch (err) {
    console.warn("[todoist] update sync failed:", err.message);
  }
}

async function syncTodoDeleted(todo) {
  if (!isTodoistEnabled() || !todo.todoist_task_id) return;
  try {
    await deleteTask(todo.todoist_task_id);
  } catch (err) {
    console.warn("[todoist] delete sync failed:", err.message);
  }
}

router.get("/", async (req, res, next) => {
  try {
    const { project_id } = req.query;
    if (!project_id)
      return res.status(400).json({ error: "project_id is required" });
    const rows = await db.q(
      `
      SELECT * FROM todos WHERE project_id = $1
      ORDER BY
        CASE status WHEN 'done' THEN 1 ELSE 0 END ASC,
        CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END ASC,
        position ASC, created_at ASC`,
      [project_id],
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const todo = await db.one("SELECT * FROM todos WHERE id = $1", [
      req.params.id,
    ]);
    if (!todo) return res.status(404).json({ error: "Todo not found" });
    res.json(todo);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const {
      project_id,
      title,
      priority = "medium",
      due_date = null,
      description = "",
      handwritten = false,
    } = req.body;
    if (!project_id)
      return res.status(400).json({ error: "project_id is required" });
    if (!title?.trim())
      return res.status(400).json({ error: "title is required" });

    const proj = await db.one(
      "SELECT id, org_id, name FROM projects WHERE id = $1",
      [project_id],
    );
    if (!proj) return res.status(404).json({ error: "Project not found" });

    const { maxpos } = await db.one(
      "SELECT COALESCE(MAX(position),0) AS maxpos FROM todos WHERE project_id = $1",
      [project_id],
    );

    const todo = await db.one(
      "INSERT INTO todos (project_id, title, priority, due_date, position, description, handwritten) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [
        project_id,
        title.trim(),
        priority,
        due_date || null,
        Number(maxpos) + 1,
        description,
        !!handwritten,
      ],
    );
    log({
      entity_type: "todo",
      entity_id: todo.id,
      entity_name: todo.title,
      project_id,
      org_id: proj.org_id,
      action: "created",
    });

    await syncTodoCreated(todo, proj.name);

    const withSync = await db.one("SELECT * FROM todos WHERE id = $1", [
      todo.id,
    ]);
    res.status(201).json(withSync || todo);
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const todo = await db.one("SELECT * FROM todos WHERE id = $1", [
      req.params.id,
    ]);
    if (!todo) return res.status(404).json({ error: "Todo not found" });
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [
      todo.project_id,
    ]);

    const title = (req.body.title ?? todo.title).trim() || todo.title;
    const status = req.body.status ?? todo.status;
    const priority = req.body.priority ?? todo.priority;
    const due_date =
      req.body.due_date !== undefined ? req.body.due_date : todo.due_date;
    const position = req.body.position ?? todo.position;
    const description =
      req.body.description !== undefined
        ? req.body.description
        : todo.description || "";
    const handwritten =
      req.body.handwritten !== undefined
        ? !!req.body.handwritten
        : todo.handwritten;

    const validStatus = ["todo", "in_progress", "done"].includes(status)
      ? status
      : todo.status;
    const validPriority = ["low", "medium", "high"].includes(priority)
      ? priority
      : todo.priority;

    const updated = await db.one(
      `UPDATE todos SET title=$1, status=$2, priority=$3, due_date=$4, position=$5, description=$6, handwritten=$7, updated_at=NOW()
       WHERE id=$8 RETURNING *`,
      [
        title,
        validStatus,
        validPriority,
        due_date || null,
        position,
        description,
        handwritten,
        req.params.id,
      ],
    );
    const changed = {};
    if (status !== todo.status)
      changed.status = { from: todo.status, to: validStatus };
    if (priority !== todo.priority)
      changed.priority = { from: todo.priority, to: validPriority };
    if (title !== todo.title) changed.title = { from: todo.title, to: title };
    log({
      entity_type: "todo",
      entity_id: todo.id,
      entity_name: title,
      project_id: todo.project_id,
      org_id: proj?.org_id,
      action: changed.status ? "status_changed" : "updated",
      meta: changed,
    });

    await syncTodoUpdated(todo, updated);

    const withSync = await db.one("SELECT * FROM todos WHERE id = $1", [
      updated.id,
    ]);
    res.json(withSync || updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const todo = await db.one("SELECT * FROM todos WHERE id = $1", [
      req.params.id,
    ]);
    if (!todo) return res.status(404).json({ error: "Todo not found" });
    const proj = await db.one("SELECT org_id FROM projects WHERE id = $1", [
      todo.project_id,
    ]);
    await syncTodoDeleted(todo);
    await db.run("DELETE FROM todos WHERE id = $1", [req.params.id]);
    log({
      entity_type: "todo",
      entity_id: todo.id,
      entity_name: todo.title,
      project_id: todo.project_id,
      org_id: proj?.org_id,
      action: "deleted",
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
