import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const mysql = require("mysql2/promise");
// Loaded by the acceptance runner over SSH; credentials stay in the server process.
const { action, fixture, workflowId } = workflowWriteIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
assert(fixture.workflows.length === 3);
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const emit = value => console.log(JSON.stringify(value));
const trigger = "flow_write_" + fixture.tag.slice(9);
try {
  const [projects] = await connection.query(
    "SELECT id,ownerUserId,code FROM flow_project WHERE id=?",
    [fixture.projectId]
  );
  assert(
    projects.length === 1 &&
      Number(projects[0].ownerUserId) === fixture.userId &&
      projects[0].code === fixture.tag.toUpperCase()
  );
  const ids = fixture.workflows.map(row => row.id);
  const [flows] = await connection.query(
    "SELECT id,ownerUserId,projectId,name FROM workflow WHERE id IN (?)",
    [ids]
  );
  assert(
    flows.length === 3 &&
      flows.every(
        row =>
          Number(row.ownerUserId) === fixture.userId &&
          row.projectId === fixture.projectId &&
          row.name.endsWith(fixture.tag)
      )
  );
  if (workflowId) assert(ids.includes(workflowId));
  if (action === "hold_project") {
    await connection.beginTransaction();
    await connection.query(
      "SELECT id FROM flow_project WHERE id=? FOR UPDATE",
      [fixture.projectId]
    );
    let timer;
    try {
      const released = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Fixture barrier expired")),
          25000
        );
        process.stdin.once("data", chunk =>
          chunk.toString().trim() === "release"
            ? resolve()
            : reject(new Error("Unexpected barrier signal"))
        );
        process.stdin.once("end", () =>
          reject(new Error("Barrier input closed"))
        );
      });
      emit({ barrierReady: true, projectId: fixture.projectId });
      await released;
    } finally {
      clearTimeout(timer);
      await connection.rollback();
    }
    emit({ released: true });
  } else if (action === "waiter") {
    const [rows] = await connection.query(
      `SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID()
      AND LOCATE(?,COALESCE(INFO,''))>0 AND LOCATE('FROM flow_project WHERE id=',COALESCE(INFO,''))>0
      AND LOCATE('FOR UPDATE',COALESCE(INFO,''))>0`,
      [fixture.projectId]
    );
    emit({ waiting: rows.length > 0 });
  } else if (action === "snapshot") {
    const [rows] = await connection.query(
      `SELECT w.id,w.name,w.status,w.auditStatus,w.definitionVersion,
      SHA2(CAST(w.definitionJson AS CHAR),256) AS definitionHash,w.publishedExecutionPlanHash,w.publishedAt,w.unpublishedAt,w.updatedAt,
      (SELECT COUNT(*) FROM workflow_version v WHERE v.workflowId=w.id) AS versions,
      (SELECT COUNT(*) FROM authorization_audit_log a WHERE a.resourceType='workflow' AND a.resourceId=w.id
        AND JSON_UNQUOTE(JSON_EXTRACT(a.detailsJson,'$.operation')) IN ('workflow_published','workflow_unpublished')) AS publicationAudits
      FROM workflow w WHERE w.id=?`,
      [workflowId]
    );
    assert(rows.length === 1);
    emit(rows[0]);
  } else if (action === "fail_audit") {
    const [existing] = await connection.query(
      "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert(existing.length === 0, "A fixture trigger already exists");
    const statement = mysql.format(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON authorization_audit_log FOR EACH ROW
      BEGIN IF NEW.resourceType='workflow' AND NEW.resourceId IN (?)
        AND JSON_UNQUOTE(JSON_EXTRACT(NEW.detailsJson,'$.operation')) IN ('workflow_published','workflow_unpublished')
      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated_workflow_audit_rejected'; END IF; END`,
      [ids]
    );
    emit({ statement });
  } else if (action === "restore_audit") {
    const [existing] = await connection.query(
      "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    if (existing.length) {
      assert(
        existing.length === 1 &&
          ids.every(id => existing[0].ACTION_STATEMENT.includes(id)) &&
          existing[0].ACTION_STATEMENT.includes(
            "isolated_workflow_audit_rejected"
          )
      );
      emit({ statement: `DROP TRIGGER ${trigger}` });
    } else {
      emit({ fixtureAuditFailureRemoved: true });
    }
  } else if (action === "audit_state") {
    const [rows] = await connection.query(
      "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert(rows.length <= 1);
    if (rows.length)
      assert(ids.every(id => rows[0].ACTION_STATEMENT.includes(id)));
    emit({ present: rows.length === 1 });
  } else if (action === "environment") {
    const [rows] = await connection.query(
      "SELECT @@global.log_bin_trust_function_creators AS trustRoutineCreators,@@global.transaction_isolation AS isolationLevel,@@global.read_only AS readOnly"
    );
    emit(rows[0]);
  } else throw new Error("Unsupported fixture operation");
} finally {
  await connection.end();
}
