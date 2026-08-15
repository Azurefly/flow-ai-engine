import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, ensureIamCatalog } from "./iam-service";

const runIntegration = process.env.DATABASE_URL ? it : it.skip;
let pool: mysql.Pool | undefined;

describe("IAM 目录真实数据库集成", () => {
  afterAll(async () => {
    await pool?.end();
  });

  runIntegration("能够幂等初始化内置角色及全部权限目录", async () => {
    await ensureIamCatalog();
    pool = mysql.createPool(process.env.DATABASE_URL!);
    const [permissionRows] = await pool.query<mysql.RowDataPacket[]>("SELECT code FROM permission WHERE code IN (?)", [ALL_PERMISSIONS]);
    const [roleRows] = await pool.query<mysql.RowDataPacket[]>("SELECT code FROM iam_role WHERE code IN ('system_admin','workflow_creator','owner','editor','operator','viewer')");

    expect(permissionRows.map(row => row.code).sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(roleRows.map(row => row.code).sort()).toEqual(["editor", "operator", "owner", "system_admin", "viewer", "workflow_creator"]);
  }, 20_000);
});
