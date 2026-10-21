import assert from "node:assert/strict";
import { createRequire } from "node:module";
const mysql = createRequire("/app/package.json")("mysql2/promise");
const { action, fixture, operation } = projectAuthorizationIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
assert(fixture.authorizationUnits?.length === 2);
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const trigger = "project_auth_" + fixture.tag.slice(9),
  emit = value => console.log(JSON.stringify(value));
try {
  const [projects] = await connection.query(
    "SELECT ownerUserId,code FROM flow_project WHERE id=?",
    [fixture.projectId]
  );
  assert(
    projects.length === 1 &&
      Number(projects[0].ownerUserId) === fixture.userId &&
      projects[0].code === fixture.tag.toUpperCase(),
    "Unexpected fixture project"
  );
  const [units] = await connection.query(
    "SELECT id,code,name FROM organization_unit WHERE id IN (?)",
    [fixture.authorizationUnits.map(unit => unit.id)]
  );
  assert(
    units.length === 2 &&
      units.every(
        unit =>
          fixture.authorizationUnits.some(
            expected =>
              expected.id === unit.id &&
              expected.code.toUpperCase() === unit.code
          ) && unit.name.endsWith(fixture.tag)
      ),
    "Unexpected fixture units"
  );
  const [people] = await connection.query(
    "SELECT id,username FROM users WHERE id IN (?)",
    [[fixture.userId, fixture.disabledUserId, fixture.recipientUserId]]
  );
  assert(
    people.length === 3 &&
      people.every(person => person.username.startsWith(fixture.tag + "_")),
    "Unexpected fixture accounts"
  );
  if (action === "hold_authorization") {
    assert(
      ["grantMember", "revokeMember", "grantUnit", "revokeUnit"].includes(
        operation
      )
    );
    await connection.beginTransaction();
    await connection.query("SELECT id FROM users WHERE id=? FOR UPDATE", [
      fixture.disabledUserId,
    ]);
    const [rows] = operation.endsWith("Member")
      ? await connection.query(
          "SELECT id FROM flow_project_member WHERE projectId=? AND userId=? AND role='viewer' AND revokedAt IS NULL FOR UPDATE",
          [fixture.projectId, fixture.recipientUserId]
        )
      : await connection.query(
          "SELECT id FROM flow_project_unit WHERE projectId=? AND unitId=? FOR UPDATE",
          [fixture.projectId, fixture.targetUnitId]
        );
    assert.equal(rows.length, 1);
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
            : reject(new Error("Unexpected barrier signal"))
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
      `SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND (
    (LOCATE(?,COALESCE(INFO,''))>0 AND (INFO LIKE 'INSERT INTO flow_project_%' OR INFO LIKE 'UPDATE flow_project_%' OR INFO LIKE 'DELETE FROM flow_project_%' OR LOCATE('FOR UPDATE',INFO)>0))
    OR (INFO LIKE 'SELECT id,role,status,tokenVersion FROM users%' AND LOCATE('FOR UPDATE',INFO)>0 AND INFO REGEXP ?))`,
      [fixture.projectId, "(^|[^0-9])" + fixture.disabledUserId + "([^0-9]|$)"]
    );
    emit({ waiting: rows.length > 0 });
  } else if (action === "membership") {
    const [members] = await connection.query(
      "SELECT unitId,userId FROM organization_membership WHERE unitId IN (?)",
      [fixture.authorizationUnits.map(unit => unit.id)]
    );
    assert(
      members.every(row =>
        [fixture.disabledUserId, fixture.recipientUserId].includes(
          Number(row.userId)
        )
      )
    );
    emit({ members });
  } else if (action === "snapshot") {
    const [members] = await connection.query(
      "SELECT id,userId,role,effectiveFrom,expiresAt,revokedAt,grantedByUserId FROM flow_project_member WHERE projectId=? ORDER BY id",
      [fixture.projectId]
    );
    const [department] = await connection.query(
      "SELECT id,unitId,role,createdAt FROM flow_project_unit WHERE projectId=? ORDER BY id",
      [fixture.projectId]
    );
    const [audit] = await connection.query(
      "SELECT COUNT(*) AS total FROM authorization_audit_log WHERE resourceType='flow_project' AND resourceId=?",
      [fixture.projectId]
    );
    emit({ members, department, audits: Number(audit[0].total) });
  } else if (action === "fail_audit") {
    const [existing] = await connection.query(
      "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert.equal(existing.length, 0);
    emit({
      statement: mysql.format(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON authorization_audit_log FOR EACH ROW BEGIN
    IF NEW.resourceType='flow_project' AND NEW.resourceId=? AND NEW.action IN ('role_assigned','temporary_role_assigned','role_revoked')
    THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated_project_audit_rejected'; END IF; END`,
        [fixture.projectId]
      ),
    });
  } else if (action === "restore_audit" || action === "audit_state") {
    const [rows] = await connection.query(
      "SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert(rows.length <= 1);
    if (rows.length)
      assert(
        rows[0].ACTION_STATEMENT.includes(fixture.projectId) &&
          rows[0].ACTION_STATEMENT.includes("isolated_project_audit_rejected")
      );
    emit(
      action === "audit_state"
        ? { present: rows.length === 1 }
        : rows.length
          ? { statement: `DROP TRIGGER ${trigger}` }
          : { fixtureAuditFailureRemoved: true }
    );
  } else if (action === "environment") {
    const [rows] = await connection.query(
      "SELECT @@global.log_bin_trust_function_creators AS trustRoutineCreators,@@global.transaction_isolation AS isolationLevel,@@global.read_only AS readOnly"
    );
    emit(rows[0]);
  } else throw new Error("Unsupported fixture action");
} finally {
  await connection.end();
}
