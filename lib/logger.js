const db = require("../database/db");

async function log({
  entity_type,
  entity_id,
  entity_name = "",
  project_id  = null,
  org_id      = null,
  action,
  meta        = {},
}) {
  try {
    await db.run(
      `INSERT INTO activity_log
         (entity_type, entity_id, entity_name, project_id, org_id, action, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [entity_type, entity_id, entity_name, project_id, org_id, action, JSON.stringify(meta)],
    );
  } catch (_) {
    // Never let logging crash the main request
  }
}

module.exports = { log };
