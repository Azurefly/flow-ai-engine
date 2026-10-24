import assert from "node:assert/strict";
import { createRequire } from "node:module";
const mysql = createRequire("/app/package.json")("mysql2/promise");
const { action, fixture, workflowId, name } = workflowInfoIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
assert(fixture.workflows.length === 3);
const ids = fixture.workflows.map(flow => flow.id);
if (workflowId) assert(ids.includes(workflowId));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const emit = value => console.log(JSON.stringify(value));
const trigger = "flow_write_" + fixture.tag.slice(9);
try {
  const [projects] = await connection.query(
    "SELECT ownerUserId,code FROM flow_project WHERE id=?",
    [fixture.projectId]
  );
  assert.equal(Number(projects[0]?.ownerUserId), fixture.userId);
  assert.equal(projects[0]?.code, fixture.tag.toUpperCase());
  const [flows] = await connection.query(
    "SELECT id,ownerUserId,projectId,name FROM workflow WHERE id IN (?)",
    [ids]
  );
  assert.equal(flows.length, 3);
  assert(
    flows.every(
      row =>
        Number(row.ownerUserId) === fixture.userId &&
        row.projectId === fixture.projectId &&
        row.name.endsWith(fixture.tag)
    )
  );
  const [users] = await connection.query(
    "SELECT id,username FROM users WHERE id IN (?)",
    [[fixture.userId, fixture.disabledUserId]]
  );
  assert.equal(users.length, 2);
  assert(users.every(row => row.username.startsWith(fixture.tag + "_")));
  if (action === "activate") {
    let cookie = "";
    async function api(method, input) {
      const response = await fetch(
        "http://124.223.198.84:1180/api/trpc/" + method,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ json: input }),
          signal: AbortSignal.timeout(20000),
        }
      );
      const next = response.headers.getSetCookie()[0];
      if (next) cookie = next.split(";", 1)[0];
      const data = await response.json();
      assert(response.ok && !data.error, "Fixture activation failed");
      return data.result.data.json;
    }
    await api("auth.login", {
      username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
      password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
    });
    await api("iam.updateUserStatus", {
      userId: fixture.disabledUserId,
      status: "active",
    });
    emit({ activatedOwnAccount: true });
  } else if (action === "snapshot") {
    const [rows] = await connection.query(
      `SELECT id,name,description,status,auditStatus,definitionVersion,
      SHA2(CAST(definitionJson AS CHAR),256) AS definitionHash,publishedExecutionPlanHash,publishedAt,unpublishedAt,
      (SELECT COUNT(*) FROM workflow_version v WHERE v.workflowId=w.id) AS versions,
      (SELECT COUNT(*) FROM authorization_audit_log a WHERE a.resourceType='workflow' AND a.resourceId=w.id AND JSON_UNQUOTE(JSON_EXTRACT(a.detailsJson,'$.operation'))='project_workflow_info_updated') AS infoAudits
      FROM workflow w WHERE id=?`,
      [workflowId]
    );
    assert.equal(rows.length, 1);
    emit(rows[0]);
  } else if (action === "hold_workflow" || action === "hold_project_revoke") {
    await connection.beginTransaction();
    if (action === "hold_workflow") {
      assert(name.endsWith(fixture.tag));
      await connection.query("SELECT id FROM workflow WHERE id=? FOR UPDATE", [
        workflowId,
      ]);
      await connection.query(
        "UPDATE workflow SET name=?,updatedAt=NOW() WHERE id=?",
        [name, workflowId]
      );
    } else {
      await connection.query(
        "SELECT id FROM flow_project WHERE id=? FOR UPDATE",
        [fixture.projectId]
      );
      const [result] = await connection.query(
        "UPDATE flow_project_member SET revokedAt=NOW() WHERE projectId=? AND userId=? AND revokedAt IS NULL",
        [fixture.projectId, fixture.disabledUserId]
      );
      assert.equal(result.affectedRows, 1);
    }
    let timer;
    try {
      const released = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Scoped info barrier expired")),
          25000
        );
        process.stdin.once("data", chunk =>
          chunk.toString().trim() === "release"
            ? resolve()
            : reject(new Error("Unexpected release"))
        );
        process.stdin.once("end", () => reject(new Error("Barrier closed")));
      });
      emit({ barrierReady: true });
      await released;
      await connection.commit();
      emit({ released: true });
    } finally {
      clearTimeout(timer);
    }
  } else if (action === "waiter") {
    const [rows] = await connection.query(
      `SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND INFO LIKE 'SELECT %' AND INFO LIKE '%FOR UPDATE%'
      AND ((LOCATE(?,COALESCE(INFO,''))>0 AND INFO LIKE '%FROM workflow WHERE id=%') OR (LOCATE(?,COALESCE(INFO,''))>0 AND INFO LIKE '%FROM flow_project WHERE id=%'))`,
      [workflowId || ids[0], fixture.projectId]
    );
    emit({ waiting: rows.length > 0 });
  } else if (action === "fail_audit") {
    const [existing] = await connection.query(
      "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert.equal(existing.length, 0);
    emit({
      statement: mysql.format(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON authorization_audit_log FOR EACH ROW BEGIN IF NEW.resourceType='workflow' AND NEW.resourceId IN (?) AND JSON_UNQUOTE(JSON_EXTRACT(NEW.detailsJson,'$.operation'))='project_workflow_info_updated' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated_workflow_audit_rejected'; END IF; END`,
        [ids]
      ),
    });
  } else if (action === "restore_audit") {
    const [rows] = await connection.query(
      "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    if (rows.length) {
      assert.equal(rows.length, 1);
      assert(ids.every(id => rows[0].ACTION_STATEMENT.includes(id)));
      assert(
        rows[0].ACTION_STATEMENT.includes("isolated_workflow_audit_rejected")
      );
      emit({ statement: `DROP TRIGGER ${trigger}` });
    } else emit({ fixtureAuditFailureRemoved: true });
  } else throw new Error("Unsupported info fixture operation");
} finally {
  await connection.rollback().catch(() => {});
  await connection.end();
}
