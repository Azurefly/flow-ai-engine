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
});
