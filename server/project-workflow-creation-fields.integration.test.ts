import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { createDataSource } from "./p2-service";
import { createProject, createProjectWorkflow, listProjectWorkflows } from "./project-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
const suffix = randomUUID().slice(0, 8).toUpperCase();
let pool: mysql.Pool | undefined;
let user: any;
const projectIds: string[] = [];

describe("项目流程创建字段与数据源隔离", () => {
  afterAll(async () => {
    if (!pool) return;
    for (const projectId of projectIds) {
      await pool.query("DELETE FROM workflow_member WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId IN (SELECT id FROM workflow WHERE projectId=?)", [projectId]);
      await pool.query("DELETE FROM workflow WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM data_source WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project_member WHERE projectId=?", [projectId]);
      await pool.query("DELETE FROM flow_project WHERE id=?", [projectId]);
    }
    await pool.query("DELETE FROM authorization_audit_log WHERE actorUserId=? OR targetUserId=?", [user?.id ?? -1, user?.id ?? -1]);
    await pool.query("DELETE FROM users WHERE username=?", [`creation_fields_${suffix.toLowerCase()}`]);
    await pool.end();
  });

  runIntegration("项目创建仅接受本项目数据源，持久化代号与来源并阻止重复代号", async () => {
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const username = `creation_fields_${suffix.toLowerCase()}`;
    await pool.query(
      "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())",
      [`test:${username}`, username, "流程创建字段验收管理员", "admin", "active", "internal"],
    );
    const [users] = await pool.query<mysql.RowDataPacket[]>("SELECT * FROM users WHERE username=?", [username]);
    user = users[0];

    const primaryProjectId = await createProject(user, { code: `CR${suffix.slice(0, 6)}`, name: "流程创建字段主项目" });
    const otherProjectId = await createProject(user, { code: `OT${suffix.slice(0, 6)}`, name: "流程创建字段隔离项目" });
    projectIds.push(primaryProjectId, otherProjectId);
    const sourceId = await createDataSource(user, { projectId: primaryProjectId, name: "主项目数据源", sourceType: "inline", connection: { description: "字段验收来源" } });
    const foreignSourceId = await createDataSource(user, { projectId: otherProjectId, name: "隔离项目数据源", sourceType: "inline", connection: { description: "隔离来源" } });

    const dataflow: any = await createProjectWorkflow(user, {
      projectId: primaryProjectId,
      processCode: `DF_${suffix}`,
      name: "字段化数据流程",
      flowType: "data",
      creationSource: "manual",
      dataSourceId: sourceId,
    });
    expect(dataflow).toMatchObject({ processCode: `DF_${suffix}`, creationSource: "manual", dataSourceId: sourceId, flowType: "data" });
    await expect(createProjectWorkflow(user, { projectId: primaryProjectId, processCode: `DF_${suffix}`, name: "重复代号", flowType: "state" })).rejects.toThrow("相同流程代号");
    await expect(createProjectWorkflow(user, { projectId: primaryProjectId, processCode: `ST_${suffix}`, name: "状态流程错误关联", flowType: "state", dataSourceId: sourceId })).rejects.toThrow("仅数据流程");
    await expect(createProjectWorkflow(user, { projectId: primaryProjectId, processCode: `X_${suffix}`, name: "跨项目数据源", flowType: "data", dataSourceId: foreignSourceId })).rejects.toThrow("不属于当前业务");
    await expect(createProjectWorkflow(user, { projectId: primaryProjectId, processCode: `IMP_DF_${suffix}`, name: "仓库数据流程", flowType: "data", creationSource: "warehouse" })).rejects.toThrow("数据流程不支持从流程仓库导入");

    const imported: any = await createProjectWorkflow(user, { projectId: primaryProjectId, name: "仓库导入流程", flowType: "control", creationSource: "warehouse" });
    expect(imported.creationSource).toBe("warehouse");
    expect(imported.processCode).toMatch(/^IMP_/);
    const listed = await listProjectWorkflows(user, primaryProjectId);
    expect(listed.find(item => item.id === dataflow.id)).toMatchObject({ processCode: `DF_${suffix}`, dataSourceId: sourceId });
  }, 30_000);
});
