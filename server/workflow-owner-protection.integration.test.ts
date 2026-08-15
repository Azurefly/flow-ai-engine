import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { revokeWorkflowMember } from "./iam-service";
import type { Definition } from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const workflowId = randomUUID();
let pool: mysql.Pool | undefined;
let ownerId: number | undefined;
let ownerMemberId: string | undefined;

const definition: Definition = { schemaVersion: 1, viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, nodes: [{ id: "start", type: "start", name: "开始", position: { x: 0, y: 0 }, config: { initialVariables: {} } }, { id: "end", type: "end", name: "结束", position: { x: 200, y: 0 }, config: { resultTemplate: "{{vars}}" } }], edges: [{ id: "start-end", sourceNodeId: "start", sourceHandle: "default", targetNodeId: "end" }] };

describe("流程最后所有者保护", () => {
  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
    await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    await pool.end();
  });

  runIntegration("拒绝撤销流程唯一有效所有者", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM users WHERE status='active' ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,id LIMIT 1");
    ownerId = users[0]?.id;
    expect(ownerId).toBeTruthy();
    ownerMemberId = randomUUID();
    await pool.query("INSERT INTO workflow (id,ownerUserId,name,status,definitionVersion,definitionJson) VALUES (?,?,?,'draft',1,?)", [workflowId, ownerId, "最后所有者保护测试", JSON.stringify(definition)]);
    await pool.query("INSERT INTO workflow_member (id,workflowId,userId,role,effectiveFrom,grantedByUserId) VALUES (?,?,?,'owner',NOW(),?)", [ownerMemberId, workflowId, ownerId, ownerId]);

    await expect(revokeWorkflowMember({ workflowId, userId: ownerId!, role: "owner", revokedByUserId: ownerId! })).rejects.toThrow("至少一位有效所有者");
    const [members] = await pool.query<mysql.RowDataPacket[]>("SELECT revokedAt FROM workflow_member WHERE id=?", [ownerMemberId]);
    expect(members[0]?.revokedAt).toBeNull();
  }, 30_000);
});
