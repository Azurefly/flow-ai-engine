import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire("/app/package.json");
const mysql = require("mysql2/promise");
const { action, fixture, workflowId, identityChange } = workflowWriteIntent;
assert(/^uiconfig_[a-f0-9]{12}$/.test(fixture.tag));
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const trigger = "flow_life_" + fixture.tag.slice(9);
const emit = value => console.log(JSON.stringify(value));
const operations = ["workflow_created", "project_workflow_created", "workflow_archived", "workflow_restored", "version_rolled_back", "workflow_duplicated"];
try {
  const [projects] = await connection.query("SELECT ownerUserId,code FROM flow_project WHERE id=?", [fixture.projectId]);
  assert(projects.length === 1 && Number(projects[0].ownerUserId) === fixture.userId && projects[0].code === fixture.tag.toUpperCase());
  const [actors] = await connection.query("SELECT id,username FROM users WHERE id IN (?)", [[fixture.userId, fixture.disabledUserId]]);
  assert(actors.length === 2 && actors.every(row => row.username.startsWith(fixture.tag + "_")));
  if (workflowId) {
    const [rows] = await connection.query("SELECT ownerUserId,projectId,name FROM workflow WHERE id=?", [workflowId]);
    assert(rows.length === 1 && Number(rows[0].ownerUserId) === fixture.userId && (rows[0].projectId === fixture.projectId || rows[0].projectId === null) && rows[0].name.endsWith(fixture.tag));
  }
  if (action === "fail_audit") {
    const [rows] = await connection.query("SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [trigger]);
    assert.equal(rows.length, 0);
    emit({ statement: mysql.format(`CREATE TRIGGER ${trigger} BEFORE INSERT ON authorization_audit_log FOR EACH ROW
      BEGIN IF NEW.resourceType='workflow' AND NEW.actorUserId IN (?)
        AND JSON_UNQUOTE(JSON_EXTRACT(NEW.detailsJson,'$.operation')) IN (?)
      THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated_workflow_lifecycle_audit_rejected'; END IF; END`, [[fixture.userId, fixture.disabledUserId], operations]) });
  } else if (action === "restore_audit" || action === "audit_state") {
    const [rows] = await connection.query("SELECT ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [trigger]);
    assert(rows.length <= 1);
    if (rows.length) assert(rows[0].ACTION_STATEMENT.includes("isolated_workflow_lifecycle_audit_rejected") && rows[0].ACTION_STATEMENT.includes(String(fixture.userId)) && rows[0].ACTION_STATEMENT.includes(String(fixture.disabledUserId)));
    emit(action === "audit_state" ? {present: rows.length === 1} : rows.length ? {statement: `DROP TRIGGER ${trigger}`} : {fixtureAuditFailureRemoved: true});
  } else if (action === "snapshot") {
    const [rows] = await connection.query(`SELECT w.id,w.name,w.status,w.archivedAt,w.auditStatus,w.definitionVersion,w.ownerUserId,w.projectId,
      SHA2(CAST(w.definitionJson AS CHAR),256) AS definitionHash,w.publishedExecutionPlanHash,w.updatedAt,
      (SELECT COUNT(*) FROM workflow_version v WHERE v.workflowId=w.id) AS versions,
      (SELECT COUNT(*) FROM authorization_audit_log a WHERE a.resourceType='workflow' AND a.resourceId=w.id) AS audits
      FROM workflow w WHERE w.id=?`, [workflowId]);
    assert.equal(rows.length, 1); emit(rows[0]);
  } else if (action === "own_flows") {
    const [rows] = await connection.query("SELECT id,name,flowType,definitionVersion,archivedAt,ownerUserId FROM workflow WHERE ownerUserId IN (?) AND (projectId=? OR projectId IS NULL) AND name LIKE ? ORDER BY id", [[fixture.userId,fixture.disabledUserId], fixture.projectId, "%" + fixture.tag]);
    assert(rows.every(row => row.name.endsWith(fixture.tag))); emit({flows: rows});
  } else if (action === "hold_project" || action === "hold_actor") {
    await connection.beginTransaction();
    if(action === "hold_project") await connection.query("SELECT id FROM flow_project WHERE id=? FOR UPDATE", [fixture.projectId]);
    else {
      assert(["permission","session","disable"].includes(identityChange));
      await connection.query("SELECT id FROM users WHERE id=? FOR UPDATE",[fixture.disabledUserId]);
    }
    let timer;
    try {
      const release = new Promise((resolve,reject) => {
        timer = setTimeout(() => reject(new Error("Fixture barrier expired")),25000);
        process.stdin.once("data", chunk => chunk.toString().trim()==="release" ? resolve() : reject(new Error("Unexpected barrier signal")));
        process.stdin.once("end", () => reject(new Error("Barrier input closed")));
      });
      emit({barrierReady:true}); await release;
      if(action === "hold_actor") {
        if(identityChange === "permission") {
          await connection.query("UPDATE flow_project_member SET revokedAt=NOW() WHERE projectId=? AND userId=? AND revokedAt IS NULL",[fixture.projectId,fixture.disabledUserId]);
          await connection.query("UPDATE role_assignment ra JOIN iam_role r ON r.id=ra.roleId SET ra.revokedAt=NOW(),ra.revokedByUserId=? WHERE ra.userId=? AND ra.revokedAt IS NULL AND ((ra.scopeType='workflow' AND ra.scopeId IN (?)) OR (ra.scopeType='system' AND r.code=?))",[fixture.userId,fixture.disabledUserId,fixture.workflows.map(row=>row.id),"custom_life_system_"+fixture.tag.slice(9)]);
        } else if(identityChange === "session") await connection.query("UPDATE users SET tokenVersion=tokenVersion+1 WHERE id=?",[fixture.disabledUserId]);
        else await connection.query("UPDATE users SET status='disabled',tokenVersion=tokenVersion+1 WHERE id=?",[fixture.disabledUserId]);
        await connection.commit();
      } else await connection.rollback();
    } catch(error) {await connection.rollback();throw error;}
    finally {clearTimeout(timer);}
    emit({released:true});
  } else if (action === "waiter" || action === "waiter_actor") {
    const [rows] = await connection.query("SELECT ID FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID() AND LOCATE(?,COALESCE(INFO,''))>0 AND LOCATE(?,COALESCE(INFO,''))>0 AND LOCATE('FOR UPDATE',COALESCE(INFO,''))>0", [action === "waiter_actor" ? String(fixture.disabledUserId) : fixture.projectId,action === "waiter_actor" ? "FROM users WHERE id=" : "flow_project"]);
    emit({waiting:rows.length>0});
  } else if (action === "environment") {
    const [rows] = await connection.query("SELECT @@global.log_bin_trust_function_creators AS trustRoutineCreators,@@global.transaction_isolation AS isolationLevel,@@global.read_only AS readOnly"); emit(rows[0]);
  } else throw new Error("Unknown lifecycle fixture action");
} finally { await connection.end(); }
