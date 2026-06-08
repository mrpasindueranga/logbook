const express = require("express");
const router  = express.Router();
const db      = require("../database/db");

router.get("/", async (req, res, next) => {
  try {
    const { project_id, org_id, entity_type, entity_id, limit = 50 } = req.query;
    const cap = Math.min(parseInt(limit) || 50, 200);
    let sql = "SELECT * FROM activity_log";
    const params = [];

    if (project_id) {
      sql += " WHERE project_id = $1";
      params.push(project_id);
    } else if (org_id) {
      sql += " WHERE org_id = $1";
      params.push(org_id);
    } else if (entity_type && entity_id) {
      sql += " WHERE entity_type = $1 AND entity_id = $2";
      params.push(entity_type, entity_id);
    }
    params.push(cap);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    res.json(await db.q(sql, params));
  } catch (e) { next(e); }
});

module.exports = router;
