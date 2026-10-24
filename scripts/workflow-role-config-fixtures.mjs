import assert from "node:assert/strict";
import { createRequire } from "node:module";
const mysql = createRequire("/app/package.json")("mysql2/promise");
const { action, fixture, permissions, name } = workflowRoleConfigIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
assert.equal(fixture.workflowRoleCode, "custom_" + fixture.tag);
const workflowId = fixture.workflows[0].id;
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const emit = value => console.log(JSON.stringify(value));
try {
  const [flows] = await connection.query(
    "SELECT ownerUserId,projectId FROM workflow WHERE id=?",
    [workflowId]
  );
  assert.equal(Number(flows[0]?.ownerUserId), fixture.userId);
  assert.equal(flows[0]?.projectId, fixture.projectId);
  const [accounts] = await connection.query(
    "SELECT id,username FROM users WHERE id IN (?)",
    [[fixture.userId, fixture.disabledUserId]]
  );
  assert.equal(accounts.length, 2);
  assert(accounts.every(row => row.username.startsWith(fixture.tag + "_")));
  const [roles] = await connection.query(
    "SELECT id,name,scope,isSystem FROM iam_role WHERE code=?",
    [fixture.workflowRoleCode]
  );
  assert.equal(roles.length, 1);
  assert.equal(roles[0].scope, "workflow");
  assert.equal(Number(roles[0].isSystem), 0);
  assert(
    roles[0].name.startsWith("流程权限验收_") &&
      roles[0].name.endsWith(fixture.tag)
  );
  const roleId = Number(roles[0].id);
  if (action === "snapshot") {
    const [bindings] = await connection.query(
      "SELECT userId,revokedAt,expiresAt FROM role_assignment WHERE roleId=? AND scopeType='workflow' AND scopeId=?",
      [roleId, workflowId]
    );
    const [audits] = await connection.query(
      "SELECT action,targetUserId,detailsJson FROM authorization_audit_log WHERE resourceType='workflow' AND resourceId=? AND JSON_UNQUOTE(JSON_EXTRACT(detailsJson,'$.roleCode'))=?",
      [workflowId, fixture.workflowRoleCode]
    );
    emit({
      bindings: bindings.length,
      active: bindings.filter(
        row =>
          !row.revokedAt &&
          (!row.expiresAt || new Date(row.expiresAt) > new Date())
      ).length,
      audits: audits.length,
      grants: audits
        .filter(row =>
          ["role_assigned", "temporary_role_assigned"].includes(row.action)
        )
        .map(row => ({
          targetUserId: Number(row.targetUserId),
          ...(typeof row.detailsJson === "string"
            ? JSON.parse(row.detailsJson)
            : row.detailsJson),
        })),
    });
  } else if (action === "waiter") {
    const [rows] = await connection.query(
      "SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND INFO LIKE 'SELECT id,code,name,description,scope,isSystem FROM iam_role%' AND INFO LIKE '%FOR SHARE%' AND LOCATE(?,INFO)>0",
      [fixture.workflowRoleCode]
    );
    emit({ waiting: rows.length > 0 });
  } else if (action === "hold_name" || action === "hold_permissions") {
    await connection.beginTransaction();
    const [locked] = await connection.query(
      "SELECT id,name FROM iam_role WHERE id=? FOR UPDATE",
      [roleId]
    );
    assert.equal(locked.length, 1);
    if (action === "hold_name") {
      assert(name.startsWith("流程权限验收_") && name.endsWith(fixture.tag));
      await connection.query("UPDATE iam_role SET name=? WHERE id=?", [
        name,
        roleId,
      ]);
    } else {
      assert(
        Array.isArray(permissions) &&
          permissions.length &&
          permissions.every(code =>
            ["workflow:view", "workflow:run"].includes(code)
          )
      );
      await connection.query("DELETE FROM role_permission WHERE roleId=?", [
        roleId,
      ]);
      const [result] = await connection.query(
        "INSERT INTO role_permission(roleId,permissionId) SELECT ?,id FROM permission WHERE code IN (?)",
        [roleId, permissions]
      );
      assert.equal(result.affectedRows, permissions.length);
    }
    let timer;
    try {
      const release = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Scoped role barrier expired")),
          25000
        );
        process.stdin.once("data", chunk =>
          chunk.toString().trim() === "release"
            ? resolve()
            : reject(new Error("Unexpected release signal"))
        );
        process.stdin.once("end", () =>
          reject(new Error("Role barrier input closed"))
        );
      });
      emit({ barrierReady: true });
      await release;
    } finally {
      clearTimeout(timer);
    }
    await connection.commit();
    emit({ released: true });
  } else throw new Error("Unsupported role fixture action");
} finally {
  await connection.rollback().catch(() => {});
  await connection.end();
}
