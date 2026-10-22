import assert from "node:assert/strict";
import { createRequire } from "node:module";
const mysql = createRequire("/app/package.json")("mysql2/promise");
const { action, fixture } = workflowAuthorizationIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
assert(fixture.workflowRoleCode === "custom_" + fixture.tag);
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const trigger = "workflow_auth_" + fixture.tag.slice(9),
  emit = value => console.log(JSON.stringify(value));
const workflowId = fixture.workflows[0].id;
try {
  const [flows] = await connection.query(
    "SELECT ownerUserId,projectId FROM workflow WHERE id=?",
    [workflowId]
  );
  assert.equal(flows.length, 1);
  assert.equal(Number(flows[0].ownerUserId), fixture.userId);
  assert.equal(flows[0].projectId, fixture.projectId);
  const [accounts] = await connection.query(
    "SELECT id,username FROM users WHERE id IN (?)",
    [[fixture.userId, fixture.disabledUserId, fixture.managerUserId]]
  );
  assert.equal(accounts.length, 3);
  assert(accounts.every(row => row.username.startsWith(fixture.tag + "_")));
  if (action === "snapshot") {
    const [members] = await connection.query(
      "SELECT userId,role,effectiveFrom,expiresAt,revokedAt FROM workflow_member WHERE workflowId=? ORDER BY userId,role",
      [workflowId]
    );
    const [assignments] = await connection.query(
      "SELECT ra.id,ra.userId,ra.roleId,ra.effectiveFrom,ra.expiresAt,ra.revokedAt FROM role_assignment ra JOIN iam_role r ON r.id=ra.roleId WHERE ra.scopeType='workflow' AND ra.scopeId=? AND r.code=? ORDER BY ra.id",
      [workflowId, fixture.workflowRoleCode]
    );
    const [audit] = await connection.query(
      "SELECT COUNT(*) AS total FROM authorization_audit_log WHERE resourceType='workflow' AND resourceId=?",
      [workflowId]
    );
    emit({ members, assignments, audits: Number(audit[0].total) });
  } else if (action === "fail_audit") {
    const [rows] = await connection.query(
      "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert.equal(rows.length, 0);
    emit({
      statement: mysql.format(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON authorization_audit_log FOR EACH ROW BEGIN IF NEW.resourceType='workflow' AND NEW.resourceId=? AND NEW.action IN ('role_assigned','temporary_role_assigned','role_revoked') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated_workflow_audit_rejected'; END IF; END`,
        [workflowId]
      ),
    });
  } else if (action === "audit_state" || action === "restore_audit") {
    const [rows] = await connection.query(
      "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert(rows.length <= 1);
    if (rows.length)
      assert(
        rows[0].ACTION_STATEMENT.includes(workflowId) &&
          rows[0].ACTION_STATEMENT.includes("isolated_workflow_audit_rejected")
      );
    emit(
      action === "audit_state"
        ? { present: rows.length === 1 }
        : rows.length
          ? { statement: `DROP TRIGGER ${trigger}` }
          : { present: false }
    );
  } else if (action === "hold_authorization") {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM users WHERE id=? FOR UPDATE", [
      fixture.managerUserId,
    ]);
    let timer;
    try {
      const release = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Authorization barrier expired")),
          25000
        );
        process.stdin.once("data", chunk =>
          chunk.toString().trim() === "release"
            ? resolve()
            : reject(new Error("Unexpected signal"))
        );
        process.stdin.once("end", () =>
          reject(new Error("Barrier input closed"))
        );
      });
      emit({ barrierReady: true });
      await release;
    } finally {
      clearTimeout(timer);
      await connection.rollback();
    }
    emit({ released: true });
  } else if (action === "waiter") {
    const [rows] = await connection.query(
      "SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND INFO LIKE 'SELECT id,role,status,tokenVersion FROM users%' AND INFO LIKE '%FOR UPDATE%' AND INFO REGEXP ?",
      ["(^|[^0-9])" + fixture.managerUserId + "([^0-9]|$)"]
    );
    emit({ waiting: rows.length > 0 });
  } else if (action === "remove_manager_source") {
    // Only this isolated account's workflow grant is changed, to release authority while a request waits.
    const [result] = await connection.query(
      "UPDATE workflow_member SET revokedAt=NOW() WHERE workflowId=? AND userId=? AND role='owner' AND revokedAt IS NULL",
      [workflowId, fixture.managerUserId]
    );
    assert.equal(result.affectedRows, 1);
    emit({ removedOwnManagerSource: true });
  } else if (action === "environment") {
    const [rows] = await connection.query(
      "SELECT @@global.log_bin_trust_function_creators AS trustRoutineCreators,@@global.transaction_isolation AS isolationLevel,@@global.read_only AS readOnly"
    );
    emit(rows[0]);
  } else throw new Error("Unsupported fixture operation");
} finally {
  await connection.end();
}
