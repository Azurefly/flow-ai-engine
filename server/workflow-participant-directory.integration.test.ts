import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { createWorkflow } from "./workflow-service";
import { grantWorkflowMember, revokeWorkflowMember } from "./iam-service";

const test = process.env.DATABASE_URL ? it : it.skip;
test("流程编辑者可搜索和回显处理人，查看者和撤权用户无权访问", async () => {
  const pool = mysql.createPool(process.env.DATABASE_URL!);
  const tag = `picker_${randomUUID().slice(0, 8)}`;
  let workflowId: string | undefined;
  const ids: number[] = [];
  const unitIds = [randomUUID(), randomUUID()];
  const caller = (user: any) =>
    appRouter.createCaller({
      user,
      req: { headers: {} },
      res: {},
    } as unknown as TrpcContext);
  try {
    for (const suffix of ["owner", "editor", "viewer", "inactive"]) {
      const [result] = await pool.query<mysql.ResultSetHeader>(
        "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,?,?,?,NOW())",
        [
          `test:${tag}_${suffix}`,
          `${tag}_${suffix}`,
          `${tag} ${suffix}`,
          suffix === "owner" ? "admin" : "user",
          suffix === "inactive" ? "disabled" : "active",
          "internal",
        ]
      );
      ids.push(result.insertId);
    }
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT * FROM users WHERE id IN (?)",
      [ids]
    );
    const owner = rows.find(row => row.id === ids[0]);
    const editor = rows.find(row => row.id === ids[1]);
    const viewer = rows.find(row => row.id === ids[2]);
    workflowId = (
      (await createWorkflow(owner as any, "处理人目录权限验收")) as any
    ).id;
    await grantWorkflowMember({
      workflowId: workflowId!,
      userId: editor!.id,
      role: "editor",
      grantedByUserId: owner!.id,
    });
    await grantWorkflowMember({
      workflowId: workflowId!,
      userId: viewer!.id,
      role: "viewer",
      grantedByUserId: owner!.id,
    });
    const input = {
      workflowId: workflowId!,
      kind: "user" as const,
      query: tag,
      selectedIds: [String(editor!.id), String(ids[3])],
    };
    const result = await caller(editor).workflow.participantDirectory(input);
    expect(result.items).toHaveLength(3);
    expect(result.selected).toEqual([
      { value: String(editor!.id), label: `${tag} editor（${tag}_editor）` },
    ]);
    expect(
      result.items.every(
        item => Object.keys(item).sort().join(",") === "label,value"
      )
    ).toBe(true);
    await pool.query(
      "INSERT INTO organization_unit (id,code,name,status,createdByUserId) VALUES (?,?,?,'active',?),(?,?,?,'disabled',?)",
      [
        unitIds[0],
        `${tag}_active`,
        "搜索验收部门",
        owner!.id,
        unitIds[1],
        `${tag}_disabled`,
        "停用验收部门",
        owner!.id,
      ]
    );
    const units = await caller(editor).workflow.participantDirectory({
      ...input,
      kind: "department",
      selectedIds: unitIds,
    });
    expect(units.items).toEqual([
      { value: unitIds[0], label: `搜索验收部门（${tag}_active）` },
    ]);
    expect(units.selected).toEqual(units.items);
    await expect(
      caller(editor).workflow.memberCandidates({ workflowId: workflowId! })
    ).rejects.toThrow("无权管理流程成员");
    await expect(
      caller(viewer).workflow.participantDirectory(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await revokeWorkflowMember({
      workflowId: workflowId!,
      userId: editor!.id,
      role: "editor",
      revokedByUserId: owner!.id,
    });
    await expect(
      caller(editor).workflow.participantDirectory(input)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    await pool.query("DELETE FROM organization_unit WHERE id IN (?)", [
      unitIds,
    ]);
    if (workflowId) {
      await pool.query("DELETE FROM workflow_member WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow_version WHERE workflowId=?", [
        workflowId,
      ]);
      await pool.query("DELETE FROM workflow WHERE id=?", [workflowId]);
    }
    if (ids.length) {
      await pool.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?) OR targetUserId IN (?)",
        [ids, ids]
      );
      await pool.query("DELETE FROM users WHERE id IN (?)", [ids]);
    }
    await pool.end();
  }
}, 30_000);
