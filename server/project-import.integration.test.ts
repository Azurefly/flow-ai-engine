import { randomUUID } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeSharedPool, getSharedPool } from "./db";
import {
  commitProjectImport,
  previewProjectImport,
  projectImportHistory,
  projectImportStatus,
} from "./project-import";
import { createProject } from "./project-service";
import { projectCorrectionCsv } from "../shared/project-import";

const suite = process.env.DATABASE_URL ? describe : describe.skip;
suite("业务导入的记录、权限与事务", () => {
  const pool = () => getSharedPool();
  const owner = { id: 0, role: "admin" as const };
  const other = { id: 0, role: "admin" as const };
  beforeAll(async () => {
    for (const actor of [owner, other]) {
      const [row] = await pool().query<ResultSetHeader>(
        "INSERT INTO users (name,role) VALUES (?,'admin')",
        ["批次验收-" + randomUUID()]
      );
      actor.id = row.insertId;
    }
  });
  afterAll(async () => {
    const ids = [owner.id, other.id].filter(Boolean);
    if (ids.length) {
      await pool().query(
        "DELETE FROM project_import_batch WHERE ownerUserId IN (?)",
        [ids]
      );
      await pool().query(
        "DELETE m FROM flow_project_member m JOIN flow_project p ON m.projectId=p.id WHERE p.ownerUserId IN (?)",
        [ids]
      );
      await pool().query("DELETE FROM flow_project WHERE ownerUserId IN (?)", [
        ids,
      ]);
      await pool().query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?)",
        [ids]
      );
      await pool().query("DELETE FROM users WHERE id IN (?)", [ids]);
    }
    await closeSharedPool();
  });
  it("整批预检不写项目；冲突后按原批次更正，重复确认保留原项目和审计", async () => {
    const batchId = randomUUID();
    const csv = 'code,name,description\r\nAA,甲,"一\r\n二"\r\nBB,乙,示例';
    const invalid = await previewProjectImport(owner, {
      batchId,
      expectedRevision: 0,
      csv: csv.replace("乙", "乙".repeat(161)),
    });
    expect(invalid.issues).toMatchObject([{ line: 4, field: "业务名称" }]);
    await expect(
      commitProjectImport(owner, { batchId, expectedRevision: 1 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const [empty] = await pool().query<RowDataPacket[]>(
      "SELECT id FROM flow_project WHERE ownerUserId=?",
      [owner.id]
    );
    expect(empty).toHaveLength(0);
    const clean = await previewProjectImport(owner, {
      batchId,
      expectedRevision: 1,
      csv,
    });
    expect(clean.issues).toEqual([]);
    expect(await projectImportStatus(other, batchId)).toBeNull();
    await createProject(owner, { code: "BB", name: "并发创建" });
    const partial = await commitProjectImport(owner, {
      batchId,
      expectedRevision: clean.revision,
    });
    expect(partial!.rows[0].projectId).toBeTruthy();
    expect(partial!.rows[1]).toMatchObject({
      projectId: null,
      error: expect.stringContaining("占用"),
    });
    await expect(
      previewProjectImport(owner, {
        batchId,
        expectedRevision: clean.revision,
        csv: csv.replace("AA", "XA"),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const corrected = await previewProjectImport(owner, {
      batchId,
      expectedRevision: clean.revision,
      csv: csv.replace("BB", "BC"),
    });
    const confirm = () =>
      commitProjectImport(owner, {
        batchId,
        expectedRevision: corrected.revision,
      });
    const [first, replay] = await Promise.all([confirm(), confirm()]);
    expect(replay!.rows).toEqual(first!.rows);
    expect(first!.rows[0].projectId).toBe(partial!.rows[0].projectId);
    expect(first!.rows.every(row => row.projectId && !row.error)).toBe(true);
    const projectIds = first!.rows.map(row => row.projectId);
    const [projects] = await pool().query<RowDataPacket[]>(
      "SELECT code,description FROM flow_project WHERE id IN (?) ORDER BY code",
      [projectIds]
    );
    expect(projects).toEqual([
      { code: "AA", description: "一\r\n二" },
      { code: "BC", description: "示例" },
    ]);
    const [audit] = await pool().query<RowDataPacket[]>(
      "SELECT resourceId FROM authorization_audit_log WHERE actorUserId=? AND resourceId IN (?)",
      [owner.id, projectIds]
    );
    expect(audit).toHaveLength(2);
    expect((await projectImportHistory(owner))[0].batchId).toBe(batchId);
    expect(await projectImportHistory(other)).toEqual([]);
  });
  it("暂停批量执行时可预检、读取原回执及单条创建，恢复后按原批次继续", async () => {
    const oldSetting = process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED;
    const code = "PAUSE_" + randomUUID().slice(0, 8).toUpperCase();
    const preview = (suffix: string) => previewProjectImport(owner, {
      batchId: randomUUID(),
      expectedRevision: 0,
      csv: `code,name\r\n${code}_${suffix},受控业务`,
    });
    try {
      delete process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED;
      const original = await preview("ORIGINAL");
      const committed = await commitProjectImport(owner, {
        batchId: original.batchId, expectedRevision: original.revision,
      });
      expect(committed?.rows[0].projectId).toBeTruthy();
      process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED = "false";
      const pending = await preview("PENDING");
      const request = { batchId: pending.batchId, expectedRevision: pending.revision };
      await expect(commitProjectImport(owner, request)).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE", message: expect.stringContaining("暂停"),
      });
      expect(await projectImportStatus(owner, original.batchId)).toEqual(committed);
      expect((await projectImportHistory(owner)).map(batch => batch.batchId)).toContain(original.batchId);
      expect((await projectImportStatus(owner, pending.batchId))?.rows[0].projectId).toBeNull();
      const [uncreated] = await pool().query<RowDataPacket[]>(
        "SELECT id FROM flow_project WHERE ownerUserId=? AND code=?", [owner.id, code + "_PENDING"],
      );
      expect(uncreated).toHaveLength(0);
      expect(await createProject(owner, { code: code + "_MANUAL", name: "单条业务" })).toBeTruthy();
      process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED = "true";
      const resumed = await commitProjectImport(owner, request);
      expect(resumed?.rows[0].projectId).toBeTruthy();
      expect(await commitProjectImport(owner, request)).toEqual(resumed);
    } finally {
      if (oldSetting === undefined) delete process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED;
      else process.env.FLOW_PROJECT_IMPORT_EXECUTION_ENABLED = oldSetting;
    }
  });
  it("按原批次稳定行号回传修正，拒绝跨用户、跨修订、重复标识和全批代码冲突", async () => {
    const batchId = randomUUID();
    const prefix = "FIX_" + batchId.slice(0, 8).toUpperCase();
    const [a, b, c, fixed] = ["A", "B", "C", "FIXED"].map(s => prefix + "_" + s);
    const preview = (csv: string, expectedRevision: number, actor = owner) =>
      previewProjectImport(actor, { batchId, csv, expectedRevision });
    const first = await preview('code,name,description\r\n' + a + ',甲,"一\r\n二"\r\n' + b + ',乙,待修正\r\n' + c + ',丙,待处理', 0);
    await createProject(owner, { code: b, name: "并发占码" });
    const partial = (await commitProjectImport(owner, { batchId, expectedRevision: first.revision }))!;
    expect(partial.rows.map(r => [r.record.line, !!r.projectId, !!r.error])).toEqual([[2, true, false], [4, false, true], [5, false, false]]);
    const patch = projectCorrectionCsv(partial)!;
    const changed = patch.replace('"' + b + '"', '"' + fixed + '"');
    await expect(preview(changed, first.revision, other)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(preview(changed.replace(batchId + "/2", batchId + "/1"), 1)).rejects.toThrow("已经创建");
    await expect(preview(changed.replace(batchId + "/2", batchId + "/99"), 1)).rejects.toThrow("不属于");
    await expect(preview(changed + "\r\n" + changed.split("\r\n")[1], 1)).rejects.toThrow("标识重复");
    await expect(preview(changed.replace(fixed, c.toLowerCase()), 1)).rejects.toThrow("第 4 行 · 业务代号");
    await expect(preview(changed.replace('"' + fixed + '"', '""'), 1)).rejects.toThrow("第 4 行 · 业务代号");
    expect(await projectImportStatus(owner, batchId)).toEqual(partial);
    const [updated, replay] = await Promise.all([preview(changed, 1), preview(changed, 1)]);
    expect(replay).toEqual(updated);
    expect(updated.revision).toBe(2);
    expect(updated.rows[0]).toEqual(partial.rows[0]);
    expect(updated.rows[1]).toMatchObject({ rowNumber: 2, error: null, projectId: null, record: { code: fixed, line: 4 } });
    expect(updated.rows[2]).toEqual(partial.rows[2]);
    await expect(preview(changed, 2)).rejects.toThrow("修订");
    const applied = (await commitProjectImport(owner, { batchId, expectedRevision: 2 }))!;
    expect(applied.rows.every(r => r.projectId)).toBe(true);
    expect(applied.rows[0].projectId).toBe(partial.rows[0].projectId);
    expect(await commitProjectImport(owner, { batchId, expectedRevision: 2 })).toEqual(applied);
    const [audits] = await pool().query<RowDataPacket[]>(
      "SELECT resourceId FROM authorization_audit_log WHERE actorUserId=? AND resourceId IN (?)",
      [owner.id, applied.rows.map(r => r.projectId)]
    );
    expect(audits.map(r => r.resourceId).sort()).toEqual(applied.rows.map(r => r.projectId).sort());
  });
});
