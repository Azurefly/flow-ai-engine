import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { getSharedPool } from "./db";
import { createUser } from "./internal-auth";
import { ensureIamCatalog } from "./iam-service";
import {
  changeDirectoryRow,
  directoryAccess,
  previewDirectory,
  readDirectoryBatch,
} from "./directory-import";
import { directoryManifest } from "../shared/directory-import";

describe("内部目录的预览权限、并发回执和回退", () => {
  const db = getSharedPool(),
    suffix = randomBytes(6).toString("hex");
  const member = "duser_" + suffix,
    code = "DUNIT_" + suffix.toUpperCase();
  const pwd = "A9!" + randomBytes(24).toString("hex");
  const admin = { id: 0, role: "admin" as const, tokenVersion: 1 };
  const observer = { id: 0, role: "user" as const, tokenVersion: 1 };
  const ordinary = { id: 0, role: "user" as const, tokenVersion: 1 };
  const batches: string[] = [];
  let roleId = 0;
  beforeAll(async () => {
    await ensureIamCatalog();
    for (const [actor, label] of [
      [admin, "admin"],
      [observer, "viewer"],
      [ordinary, "ordinary"],
    ] as const) {
      actor.id = await createUser({
        username: label + suffix,
        name: label,
        password: pwd,
        role: actor.role,
      });
    }
    await db.query(
      "INSERT INTO iam_role(code,name,scope) VALUES (?,?,'system')",
      ["dir_" + suffix, "目录观察者"]
    );
    const [role] = await db.query<RowDataPacket[]>(
      "SELECT id FROM iam_role WHERE code=?",
      ["dir_" + suffix]
    );
    roleId = role[0].id;
    await db.query(
      "INSERT INTO role_permission(roleId,permissionId) SELECT ?,id FROM permission WHERE code='directory:preview'",
      [roleId]
    );
    await db.query(
      "INSERT INTO role_assignment(id,userId,roleId,scopeType) VALUES (?,?,?,'system')",
      [randomUUID(), observer.id, roleId]
    );
  });
  afterAll(async () => {
    if (batches.length)
      await db.query("DELETE FROM directory_import_batch WHERE id IN (?)", [
        batches,
      ]);
    const actorIds = [admin.id, observer.id, ordinary.id].filter(Boolean);
    if (actorIds.length)
      await db.query(
        "DELETE FROM authorization_audit_log WHERE actorUserId IN (?)",
        [actorIds]
      );
    await db.query(
      "DELETE m FROM organization_membership m JOIN organization_unit u ON u.id=m.unitId WHERE u.code=?",
      [code]
    );
    await db.query("DELETE FROM organization_unit WHERE code=?", [code]);
    if (roleId) {
      await db.query("DELETE FROM role_assignment WHERE roleId=?", [roleId]);
      await db.query("DELETE FROM role_permission WHERE roleId=?", [roleId]);
      await db.query("DELETE FROM iam_role WHERE id=?", [roleId]);
    }
    await db.query("DELETE FROM users WHERE username IN (?)", [
      [member, "admin" + suffix, "viewer" + suffix, "ordinary" + suffix],
    ]);
  });
  it("拒绝文件内凭据和角色，限制批次总行数", () => {
    for (const extra of [{ password: pwd }, { role: "admin" }])
      expect(
        directoryManifest.safeParse({
          version: 1,
          users: [{ username: member, name: "甲", ...extra }],
        }).success
      ).toBe(false);
    expect(
      directoryManifest.safeParse({
        version: 1,
        units: Array(201).fill({ name: "甲", code }),
      }).success
    ).toBe(false);
  });
  it("同名不同编码生成独立行，省略现有对象保留目录", async () => {
    const prepared = await previewDirectory(
      admin,
      "同名部门.json",
      directoryManifest.parse({
        version: 1,
        units: [
          { code: code + "A", name: "运营" },
          { code: code + "B", name: "运营" },
        ],
      })
    );
    batches.push(prepared.id);
    expect(prepared.rows.map(row => [row.key, row.action, row.state])).toEqual([
      ["unit/" + code + "A", "create", "ready"],
      ["unit/" + code + "B", "create", "ready"],
    ]);
    const [accounts] = await db.query<RowDataPacket[]>(
      "SELECT status FROM users WHERE id=?",
      [observer.id]
    );
    expect(accounts[0].status).toBe("active");
  });
  it("观察者可预览自己的批次，授权管理员应用，重复请求只创建一次", async () => {
    const manifest = directoryManifest.parse({
      version: 1,
      users: [{ username: member, name: "原成员" }],
      units: [{ code, name: "新部门" }],
      memberships: [{ username: member, unitCode: code }],
    });
    expect(await directoryAccess(observer)).toEqual({
      apply: false,
      preview: true,
    });
    await expect(
      previewDirectory(ordinary, "a.json", manifest)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const b = await previewDirectory(observer, "内部目录.json", manifest);
    batches.push(b.id);
    await expect(readDirectoryBatch(ordinary, b.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      changeDirectoryRow(observer, b.id, 0, "apply", pwd)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    let [users] = await db.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE username=?",
      [member]
    );
    expect(users).toHaveLength(0);
    await expect(
      changeDirectoryRow(admin, b.id, 2, "apply")
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await readDirectoryBatch(admin, b.id)).rows[2].state).toBe("ready");
    for (let i = 0; i < 3; i++) {
      const results = await Promise.all(
        [1, 2].map(() =>
          changeDirectoryRow(admin, b.id, i, "apply", i === 0 ? pwd : undefined)
        )
      );
      expect(results[0].rows[i].after?.id).toBe(results[1].rows[i].after?.id);
    }
    [users] = await db.query<RowDataPacket[]>(
      "SELECT id FROM users WHERE username=?",
      [member]
    );
    expect(users).toHaveLength(1);
    const [audit] = await db.query<RowDataPacket[]>(
      "SELECT detailsJson FROM authorization_audit_log WHERE resourceId=? AND JSON_UNQUOTE(JSON_EXTRACT(detailsJson,'$.operation'))='directory_apply'",
      [b.id]
    );
    expect(audit).toHaveLength(3);
    const [stored] = await db.query<RowDataPacket[]>(
      "SELECT rowsJson FROM directory_import_batch WHERE id=?",
      [b.id]
    );
    expect(JSON.stringify([stored, audit])).not.toContain(pwd);
    const second = await previewDirectory(
      admin,
      "重命名.json",
      directoryManifest.parse({
        version: 1,
        users: [{ username: member, name: "新资料" }],
      })
    );
    batches.push(second.id);
    await expect(readDirectoryBatch(observer, second.id)).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    await changeDirectoryRow(admin, second.id, 0, "apply");
    expect(
      (await changeDirectoryRow(admin, b.id, 0, "revert")).rows[0].message
    ).toContain("保留人工修改");
    await changeDirectoryRow(admin, second.id, 0, "revert");
    await db.query(
      "UPDATE organization_unit SET description='人工补充' WHERE code=?",
      [code]
    );
    expect(
      (await changeDirectoryRow(admin, b.id, 1, "revert")).rows[1].message
    ).toContain("保留人工修改");
    await db.query(
      "UPDATE organization_unit SET description=NULL WHERE code=?",
      [code]
    );
    for (const idx of [2, 1, 0])
      expect(
        (await changeDirectoryRow(admin, b.id, idx, "revert")).rows[idx].state
      ).toBe("reverted");
  });
});
