import mysql from "mysql2/promise";
import { activateDataflowSchedule, pauseDataflowSchedule } from "../server/p2-service";

const pool = mysql.createPool(process.env.DATABASE_URL!);

try {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.projectId,s.workflowId,p.ownerUserId,u.role
       FROM dataflow_schedule s
       JOIN flow_project p ON p.id=s.projectId
       JOIN users u ON u.id=p.ownerUserId
      WHERE s.status='active' AND s.scheduleCronTaskUid IS NOT NULL
      ORDER BY s.updatedAt DESC LIMIT 1`,
  );
  const schedule = rows[0];
  if (!schedule) throw new Error("未找到可进行暂停/恢复验收的激活计划。");
  const owner = { id: Number(schedule.ownerUserId), role: schedule.role === "admin" ? "admin" : "user" } as const;
  const paused = await pauseDataflowSchedule(owner, { projectId: String(schedule.projectId), workflowId: String(schedule.workflowId) });
  const resumed = await activateDataflowSchedule(owner, { projectId: String(schedule.projectId), workflowId: String(schedule.workflowId) });
  console.log(JSON.stringify({ paused, resumed, projectId: schedule.projectId, workflowId: schedule.workflowId }));
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
} finally {
  await pool.end();
}
