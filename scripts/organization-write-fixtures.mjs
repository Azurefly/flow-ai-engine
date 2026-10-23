import assert from "node:assert/strict";
import { createRequire } from "node:module";
const mysql = createRequire("/app/package.json")("mysql2/promise");
const { action, fixture } = organizationWriteIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
const prefix = "ORG_" + fixture.tag.slice(9).toUpperCase() + "_";
const trigger = "org_write_" + fixture.tag.slice(9);
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const emit = value => console.log(JSON.stringify(value));
try {
  const [users] = await connection.query(
    "SELECT id,username FROM users WHERE id IN (?)",
    [[fixture.userId, fixture.disabledUserId]]
  );
  assert.equal(users.length, 2);
  assert(users.every(row => row.username.startsWith(fixture.tag + "_")));
  const [units] = await connection.query(
    "SELECT * FROM organization_unit WHERE code LIKE ? ORDER BY code",
    [prefix + "%"]
  );
  assert(
    units.every(
      row => row.code.startsWith(prefix) && row.name.includes(fixture.tag)
    )
  );
  const ids = units.map(row => row.id);
  if (action === "snapshot") {
    const [members] = ids.length
      ? await connection.query(
          "SELECT id,unitId,userId,title,isPrimary FROM organization_membership WHERE unitId IN (?) ORDER BY unitId,userId",
          [ids]
        )
      : [[]];
    assert(
      members.every(row =>
        [fixture.userId, fixture.disabledUserId].includes(row.userId)
      )
    );
    const [bindings] = ids.length
      ? await connection.query(
          "SELECT id,unitId,roleId,includeDescendants,effectiveFrom,expiresAt,createdByUserId FROM organization_unit_role WHERE unitId IN (?) ORDER BY unitId,roleId",
          [ids]
        )
      : [[]];
    const [audits] = await connection.query(
      "SELECT COUNT(*) AS total FROM authorization_audit_log WHERE actorUserId IN (?) AND resourceType IN ('organization_unit','organization_membership')",
      [[fixture.userId, fixture.disabledUserId]]
    );
    emit({
      units: units.map(({ updatedAt, createdAt, ...row }) => row),
      members,
      bindings,
      audits: Number(audits[0].total),
    });
  } else if (action === "fail_audit") {
    const [rows] = await connection.query(
      "SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?",
      [trigger]
    );
    assert.equal(rows.length, 0);
    emit({
      statement: mysql.format(
        `CREATE TRIGGER ${trigger} BEFORE INSERT ON authorization_audit_log FOR EACH ROW BEGIN IF NEW.actorUserId IN (?,?) AND NEW.resourceType IN ('organization_unit','organization_membership') THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated_organization_audit_rejected'; END IF; END`,
        [fixture.userId, fixture.disabledUserId]
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
        rows[0].ACTION_STATEMENT.includes(String(fixture.userId)) &&
          rows[0].ACTION_STATEMENT.includes(String(fixture.disabledUserId)) &&
          rows[0].ACTION_STATEMENT.includes(
            "isolated_organization_audit_rejected"
          )
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
      fixture.disabledUserId,
    ]);
    let timer;
    try {
      const signal = await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Barrier expired")), 25000);
        process.stdin.once("data", chunk => resolve(chunk.toString().trim()));
        process.stdin.once("end", () => reject(new Error("Barrier closed")));
        emit({ barrierReady: true });
      });
      if (signal === "release") await connection.rollback();
      else {
        assert(["invalidate", "disable"].includes(signal));
        await connection.query(
          "UPDATE users SET tokenVersion=tokenVersion+1" +
            (signal === "disable" ? ",status='disabled'" : "") +
            " WHERE id=?",
          [fixture.disabledUserId]
        );
        await connection.commit();
      }
    } finally {
      clearTimeout(timer);
      await connection.rollback();
    }
    emit({ released: true });
  } else if (action === "waiter") {
    const [rows] = await connection.query(
      "SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND INFO LIKE 'SELECT id,role,status,tokenVersion FROM users%' AND INFO LIKE '%FOR UPDATE%' AND INFO REGEXP ?",
      ["(^|[^0-9])" + fixture.disabledUserId + "([^0-9]|$)"]
    );
    emit({ waiting: rows.length > 0 });
  } else if (action === "remove_manager_source") {
    const [result] = await connection.query(
      "UPDATE role_assignment ra JOIN iam_role r ON r.id=ra.roleId SET ra.revokedAt=NOW() WHERE ra.userId=? AND ra.scopeType='system' AND ra.revokedAt IS NULL AND r.code=?",
      [fixture.disabledUserId, fixture.identityRoleCode]
    );
    assert.equal(result.affectedRows, 1);
    emit({ ownManagerRemoved: true });
  } else throw new Error("Unsupported fixture operation");
} finally {
  await connection.end();
}
