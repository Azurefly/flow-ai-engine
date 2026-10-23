import assert from "node:assert/strict";
import { createRequire } from "node:module";
const mysql = createRequire("/app/package.json")("mysql2/promise");
const { fixture, action } = workflowWriteIntent;
assert.equal(action, "creation_receipts");
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [actors] = await connection.query(
    "SELECT id,username FROM users WHERE id=?",
    [fixture.userId]
  );
  assert.equal(actors[0]?.username, fixture.tag + "_admin");
  const [rows] = await connection.query(
    `SELECT r.id,r.requestKind,r.workflowId,r.projectId,r.requestKeyHash,r.payloadHash,
  w.name,w.ownerUserId,w.archivedAt,w.definitionVersion,
  (SELECT COUNT(*) FROM workflow_version v WHERE v.workflowId=r.workflowId) AS versions,
  (SELECT COUNT(*) FROM authorization_audit_log a WHERE a.resourceType='workflow' AND a.resourceId=r.workflowId AND JSON_UNQUOTE(JSON_EXTRACT(a.detailsJson,'$.creationRequestId'))=r.id) AS audits
  FROM workflow_creation_request r LEFT JOIN workflow w ON w.id=r.workflowId WHERE r.actorUserId=? ORDER BY r.id`,
    [fixture.userId]
  );
  assert(
    rows.every(
      row =>
        !row.name ||
        (row.name.endsWith(fixture.tag) &&
          Number(row.ownerUserId) === fixture.userId)
    )
  );
  console.log(JSON.stringify({ receipts: rows }));
} finally {
  await connection.end();
}
