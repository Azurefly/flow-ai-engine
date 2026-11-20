import { sql } from "drizzle-orm";
import type { RowDataPacket } from "mysql2/promise";
import { expect, it } from "vitest";
import { closeSharedPool, getDb, getSharedPool } from "./db";

it("应用与 MySQL 使用不同本地时区时，查询参数和读取结果都保持同一个绝对时刻", async () => {
  const prior = process.env.TZ;
  process.env.TZ = "Asia/Singapore";
  try {
    const instant = new Date("2026-11-20T12:00:00.000Z");
    expect(instant.getTimezoneOffset()).toBe(-480);
    const connection = await getSharedPool().getConnection();
    try {
      const [[row]] = await connection.query<RowDataPacket[]>(
        "SELECT @@session.time_zone AS zone, UNIX_TIMESTAMP(?) AS epoch, CAST('2026-11-20 12:00:00' AS DATETIME) AS observed",
        [instant],
      );
      expect(row.zone).toBe("+00:00");
      expect(Number(row.epoch)).toBe(instant.getTime() / 1000);
      expect(row.observed).toEqual(instant);
    } finally {
      connection.release();
    }
    const db = await getDb();
    expect(db).toBeTruthy();
    const [rows] = await db!.execute<RowDataPacket[]>(sql`SELECT @@session.time_zone AS zone`);
    expect(rows[0].zone).toBe("+00:00");
  } finally {
    if (prior === undefined) delete process.env.TZ;
    else process.env.TZ = prior;
    await closeSharedPool();
  }
});
