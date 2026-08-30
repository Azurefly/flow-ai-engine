import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { submitWorkflowRun } from "./workflow-engine";
import {
  createProject,
  createProjectWorkflow,
  setProjectWorkflowAudit,
} from "./project-service";
import {
  createWorkflow,
  getWorkflow,
  rollbackWorkflowVersion,
  updateWorkflow,
  WorkflowVersionConflictError,
  type Definition,
} from "./workflow-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8).toUpperCase();
const username = `state_guard_${suffix.toLowerCase()}`;
const projectIds: string[] = [];
const workflowIds: string[] = [];
let pool: mysql.Pool | undefined;
let user: any;

const definition: Definition = {
  schemaVersion: 1,
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  nodes: [
    {
      id: "start",
      type: "start",
      name: "开始",
      position: { x: 0, y: 0 },
      config: { initialVariables: {} },
    },
    {
      id: "end",
      type: "end",
      name: "结束",
      position: { x: 180, y: 0 },
      config: { resultTemplate: "{{input.value}}" },
    },
  ],
  edges: [{ id: "start-end", sourceNodeId: "start", targetNodeId: "end" }],
};

async function ensureUser() {
  pool ??= mysql.createPool(process.env.DATABASE_URL!);
  if (user) return user;
  await pool.query(
    "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())",
    [`test:${username}`, username, "工作流状态守卫测试", "admin", "active", "internal"]
  );
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id,role FROM users WHERE username=? LIMIT 1",
    [username]
  );
  user = rows[0];
  return user;
}

async function createPublishedProjectWorkflow(name: string) {
  const owner = await ensureUser();
  const projectId = await createProject(owner, {
    code: `SG${suffix}${projectIds.length}`,
    name: `${name}业务`,
  });
  projectIds.push(projectId);
  const workflow = (await createProjectWorkflow(owner, {
    projectId,
    name,
    flowType: "control",
    definition,
  })) as any;
  workflowIds.push(workflow.id);
  await setProjectWorkflowAudit(owner, {
    projectId,
    workflowId: workflow.id,
    auditStatus: "approved",
  });
  await updateWorkflow(workflow.id, owner, { publish: true });
  return { projectId, workflowId: workflow.id, owner };
}

async function submitWhileWorkflowIsLocked(
  workflowId: string,
  update: (connection: mysql.PoolConnection) => Promise<void>
) {
  const connection = await pool!.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      "SELECT id FROM workflow WHERE id=? LIMIT 1 FOR UPDATE",
      [workflowId]
    );
    const submission = submitWorkflowRun({
      workflowId,
      triggeredBy: { id: Number(user.id), role: user.role },
      workflowInput: { value: "guarded" },
      idempotencyKey: `state-guard-${randomUUID()}`,
    });
    // Allow the submission's non-locking preflight reads to observe the old
    // published state before the blocking transaction changes it.
    await new Promise(resolve => setTimeout(resolve, 50));
    await update(connection);
    await connection.commit();
    return submission;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

describe("工作流运行状态与版本回滚守卫", () => {
  afterAll(async () => {
    if (!pool) return;
    for (const workflowId of workflowIds) {
      await pool.query("DELETE FROM workflow_run_alert WHERE workflowId=?", [workflowId]);
      await pool.query(
        "DELETE nr FROM workflow_node_run nr JOIN workflow_run r ON r.id=nr.runId WHERE r.workflowId=?",
        [workflowId]
      );
      await pool.query("DELETE FROM workflow_run_job WHERE runId IN (SELECT id FROM workflow_run WHERE workflowId=?)", [workflowId]);
      await pool.query("DELETE FROM workflow_run WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [workflowId]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    for (const projectId of projectIds) {
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query(
      "DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?",
      [user?.id ?? -1, user?.id ?? -1]
    );
    await pool.query("DELETE FROM users WHERE username=?", [username]);
    await pool.end();
  });

  runIntegration(
    "在锁内重新复核 workflow、审批和业务状态，阻止过期预检查继续入队",
    async () => {
      const { projectId, workflowId } = await createPublishedProjectWorkflow(
        "运行状态守卫"
      );

      const draftSubmission = await submitWhileWorkflowIsLocked(
        workflowId,
        connection =>
          connection.query(
            "UPDATE workflow SET status='draft',auditStatus='init' WHERE id=?",
            [workflowId]
          ).then(() => undefined)
      );
      await expect(draftSubmission).rejects.toThrow(
        "项目流程尚未发布或未通过审核"
      );

      await pool!.query(
        "UPDATE workflow SET status='published',auditStatus='approved' WHERE id=?",
        [workflowId]
      );
      const rejectedSubmission = await submitWhileWorkflowIsLocked(
        workflowId,
        connection =>
          connection.query(
            "UPDATE workflow SET auditStatus='rejected' WHERE id=?",
            [workflowId]
          ).then(() => undefined)
      );
      await expect(rejectedSubmission).rejects.toThrow(
        "项目流程尚未发布或未通过审核"
      );

      await pool!.query(
        "UPDATE workflow SET status='published',auditStatus='approved' WHERE id=?",
        [workflowId]
      );
      const archivedProjectSubmission = await submitWhileWorkflowIsLocked(
        workflowId,
        connection =>
          connection.query(
            "UPDATE flow_project SET status='archived' WHERE id=?",
            [projectId]
          ).then(() => undefined)
      );
      await expect(archivedProjectSubmission).rejects.toThrow(
        "所属业务已归档或不存在"
      );

      const [runs] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT id FROM workflow_run WHERE workflowId=?",
        [workflowId]
      );
      expect(runs).toHaveLength(0);
    },
    30_000
  );

  runIntegration(
    "回滚已发布历史版本后进入草稿和重新审核队列，不保留可执行计划",
    async () => {
      const { workflowId, owner } = await createPublishedProjectWorkflow(
        "版本回滚守卫"
      );
      const [publishedRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT definitionVersion,status,auditStatus,publishedExecutionPlanJson FROM workflow WHERE id=?",
        [workflowId]
      );
      const publishedVersion = Number(publishedRows[0].definitionVersion);
      expect(publishedRows[0]).toMatchObject({
        status: "published",
        auditStatus: "approved",
      });
      expect(publishedRows[0].publishedExecutionPlanJson).not.toBeNull();

      const rolledBack = await rollbackWorkflowVersion(
        workflowId,
        publishedVersion,
        owner
      );
      expect(rolledBack).toMatchObject({
        status: "draft",
        auditStatus: "init",
        definitionVersion: publishedVersion + 1,
      });

      const [workflowRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT status,auditStatus,publishedExecutionPlanJson,publishedExecutionPlanHash FROM workflow WHERE id=?",
        [workflowId]
      );
      expect(workflowRows[0]).toMatchObject({
        status: "draft",
        auditStatus: "init",
        publishedExecutionPlanJson: null,
        publishedExecutionPlanHash: null,
      });
      const [versionRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT status,changeSource,restoredFromVersion,executionPlanJson,executionPlanHash FROM workflow_version WHERE workflowId=? ORDER BY version DESC LIMIT 1",
        [workflowId]
      );
      expect(versionRows[0]).toMatchObject({
        status: "draft",
        changeSource: "rolled_back",
        restoredFromVersion: publishedVersion,
        executionPlanJson: null,
        executionPlanHash: null,
      });
    },
    30_000
  );

  runIntegration(
    "并发定义更新只允许一个 hydrated 版本成功写入",
    async () => {
      const owner = await ensureUser();
      const workflow = (await createWorkflow(owner, "并发版本守卫")) as any;
      workflowIds.push(workflow.id);
      const hydrated = (await getWorkflow(workflow.id, owner)) as any;
      const expectedDefinitionVersion = Number(hydrated.definitionVersion);

      const firstDefinition = JSON.parse(JSON.stringify(definition)) as Definition;
      const secondDefinition = JSON.parse(JSON.stringify(definition)) as Definition;
      firstDefinition.nodes.find(node => node.id === "end")!.name = "并发提交 A";
      secondDefinition.nodes.find(node => node.id === "end")!.name = "并发提交 B";

      const outcomes = await Promise.allSettled([
        updateWorkflow(workflow.id, owner, {
          definition: firstDefinition,
          expectedDefinitionVersion,
        }),
        updateWorkflow(workflow.id, owner, {
          definition: secondDefinition,
          expectedDefinitionVersion,
        }),
      ]);
      const fulfilled = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<unknown> =>
          outcome.status === "fulfilled"
      );
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected?.reason).toBeInstanceOf(WorkflowVersionConflictError);
      expect(rejected?.reason?.message).toContain("流程版本冲突");

      const [workflowRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT definitionVersion,definitionJson FROM workflow WHERE id=?",
        [workflow.id]
      );
      expect(Number(workflowRows[0].definitionVersion)).toBe(
        expectedDefinitionVersion + 1
      );
      const savedDefinition = JSON.parse(String(workflowRows[0].definitionJson)) as Definition;
      expect(["并发提交 A", "并发提交 B"]).toContain(
        savedDefinition.nodes.find(node => node.id === "end")?.name
      );

      const [versionRows] = await pool!.query<mysql.RowDataPacket[]>(
        "SELECT version FROM workflow_version WHERE workflowId=? ORDER BY version",
        [workflow.id]
      );
      expect(versionRows.map(row => Number(row.version))).toEqual([
        expectedDefinitionVersion,
        expectedDefinitionVersion + 1,
      ]);
    },
    30_000
  );
});
