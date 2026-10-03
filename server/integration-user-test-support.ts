import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import type { User } from "../drizzle/schema";

/** Create a test-owned account instead of borrowing an existing user's access. */
export async function createIntegrationAdmin(pool: mysql.Pool, prefix: string) {
  const suffix = randomUUID();
  const [created] = await pool.query<mysql.ResultSetHeader>(
    "INSERT INTO users (openId,username,name,role,status,loginMethod,lastSignedIn) VALUES (?,?,?,'admin','active','internal',NOW())",
    [
      `test:${prefix}:${suffix}`,
      `${prefix}_${suffix.slice(0, 8)}`,
      "集成测试管理员",
    ]
  );
  const [rows] = await pool.query<(mysql.RowDataPacket & User)[]>(
    "SELECT * FROM users WHERE id=?",
    [created.insertId]
  );
  if (!rows[0]) throw new Error("专用集成测试账号创建失败。");
  return rows[0];
}
