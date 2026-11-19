import { randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { directoryManifest } from "../shared/directory-import";
import { getSharedPool } from "./db";
import {
  changeDirectoryRow,
  previewDirectory,
  readDirectoryBatch,
} from "./directory-import";
import { createUser } from "./internal-auth";
import { submitWorkflowRun } from "./workflow-engine";
import { createWorkflow, updateWorkflow } from "./workflow-service";
import { drainWorkflowJobs } from "./workflow-worker";

describe("目录批次新增账号的待办候选人保护", () => {
  const db = getSharedPool();
  const fixture = "g03task_" + randomBytes(6).toString("hex");
  const adminName = fixture + "_admin";
  const memberName = fixture + "_member";
  const admin = { id: 0, role: "admin" as const, tokenVersion: 1 };
  let batchId: string | undefined;
  let workflowId: string | undefined;

  afterAll(async () => {
    if (workflowId) {
      for (const table of ["workflow_task", "workflow_participant_state"]) {
        await db.query("DELETE FROM " + table + " WHERE workflowId=?", [
          workflowId,
        ]);
      }
      await db.query(
        "DELETE e FROM workflow_outbox_event e JOIN workflow_run r ON r.id=e.aggregateId WHERE r.workflowId=?",
        [workflowId]
      );
      await db.query(
        "DELETE n FROM workflow_node_run n JOIN workflow_run r ON r.id=n.runId WHERE r.workflowId=?",
        [workflowId]
      );
      for (const table of [
        "workflow_run",
        "workflow_member",
        "workflow_version",
      ]) {
        await db.query("DELETE FROM " + table + " WHERE workflowId=?", [
          workflowId,
        ]);
      }
      await db.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (batchId)
      await db.query("DELETE FROM directory_import_batch WHERE id=?", [
        batchId,
      ]);
    if (admin.id)
      await db.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId=?",
        [admin.id]
      );
    await db.query("DELETE FROM users WHERE username IN (?,?)", [
      memberName,
      adminName,
    ]);
  });

  it("仅作为共享待办候选人的新账号在回退后仍启用，回执与候选资格均可回读", async () => {
    const password = "A9!" + randomBytes(24).toString("hex");
    admin.id = await createUser({
      username: adminName,
      name: fixture,
      password,
      role: "admin",
    });
    const manifest = directoryManifest.parse({
      version: 1,
      users: [{ username: memberName, name: "待办候选人" }],
    });
    const batch = await previewDirectory(admin, fixture + ".json", manifest);
    batchId = batch.id;
    const applied = await changeDirectoryRow(
      admin,
      batch.id,
      0,
      "apply",
      password
    );
    expect(applied.rows[0]).toMatchObject({
      action: "create",
      state: "applied",
    });
    const memberId = Number(applied.rows[0].after?.id);
    expect(memberId).toBeGreaterThan(0);

    const draft = await createWorkflow(admin, fixture, undefined, {
      flowType: "control",
      definition: {
        schemaVersion: 1,
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        nodes: [
          {
            id: "start",
            type: "start",
            name: "开始",
            position: { x: 0, y: 0 },
            config: {},
          },
          {
            id: "review",
            type: "operate",
            name: "共同候选待办",
            position: { x: 240, y: 0 },
            config: {
              nodeDh: "REV",
              czmc: "办理",
              assigneeMode: "form_user",
              assigneeFormField: "input.reviewers",
            },
          },
          {
            id: "end",
            type: "end",
            name: "结束",
            position: { x: 480, y: 0 },
            config: {},
          },
        ],
        edges: [
          {
            id: "begin",
            sourceNodeId: "start",
            targetNodeId: "review",
            sourceHandle: "default",
          },
          {
            id: "finish",
            sourceNodeId: "review",
            targetNodeId: "end",
            sourceHandle: "approved",
          },
        ],
      },
    });
    workflowId = draft.id;
    await updateWorkflow(draft.id, admin, {
      publish: true,
      expectedDefinitionVersion: Number(draft.definitionVersion),
    });
    const { runId } = await submitWorkflowRun({
      workflowId: draft.id,
      triggeredBy: admin,
      workflowInput: { reviewers: [admin.id, memberId] },
      idempotencyKey: fixture,
    });
    await drainWorkflowJobs(10);
    const task = async () => {
      const [rows] = await db.query<RowDataPacket[]>(
        "SELECT id,status,assignedUserId,claimedByUserId,completedByUserId,candidateUserIdsJson FROM workflow_task WHERE runId=? AND nodeId='review'",
        [runId]
      );
      expect(rows).toHaveLength(1);
      return rows[0];
    };
    const pending = await task();
    expect(pending).toMatchObject({
      status: "pending",
      assignedUserId: null,
      claimedByUserId: null,
      completedByUserId: null,
    });
    const candidates =
      typeof pending.candidateUserIdsJson === "string"
        ? JSON.parse(pending.candidateUserIdsJson)
        : pending.candidateUserIdsJson;
    expect(candidates).toEqual(expect.arrayContaining([admin.id, memberId]));
    const [before] = await db.query<RowDataPacket[]>(
      `SELECT u.status,u.tokenVersion,
              (SELECT COUNT(*) FROM auth_session WHERE userId=u.id) AS sessions,
              (SELECT COUNT(*) FROM role_assignment WHERE userId=u.id) AS roles,
              (SELECT COUNT(*) FROM organization_membership WHERE userId=u.id) AS memberships,
              (SELECT COUNT(*) FROM workflow_member WHERE userId=u.id) AS workflowMemberships
       FROM users u WHERE u.id=?`,
      [memberId]
    );
    expect(before[0]).toMatchObject({
      status: "active",
      sessions: 0,
      roles: 0,
      memberships: 0,
      workflowMemberships: 0,
    });
    const result = await changeDirectoryRow(admin, batch.id, 0, "revert");
    expect(result.rows[0]).toMatchObject({
      state: "applied",
      message: expect.stringMatching(/任务|待办/),
    });
    expect((await readDirectoryBatch(admin, batch.id)).rows[0]).toEqual(
      result.rows[0]
    );
    const [after] = await db.query<RowDataPacket[]>(
      "SELECT status,tokenVersion FROM users WHERE id=?",
      [memberId]
    );
    expect(after[0]).toMatchObject({
      status: "active",
      tokenVersion: before[0].tokenVersion,
    });
    expect(await task()).toEqual(pending);
  });
});
