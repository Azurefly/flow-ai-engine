import mysql from "mysql2/promise";
import { activateDataflowSchedule } from "../server/p2-service";

const pool = mysql.createPool(process.env.DATABASE_URL!);

try {
  const [rows] = await pool.query<mysql.RowDataPacket[]>(
    `SELECT s.projectId,s.workflowId,p.ownerUserId,u.role
       FROM dataflow_schedule s
       JOIN flow_project p ON p.id=s.projectId
       JOIN users u ON u.id=p.ownerUserId
      WHERE s.status='paused' AND s.scheduleCronTaskUid IS NULL
      ORDER BY s.updatedAt DESC LIMIT 1`,
  );
  const schedule = rows[0];
  if (!schedule) throw new Error("未找到可激活的已发布数据流调度草稿。");
  const result = await activateDataflowSchedule({ id: Number(schedule.ownerUserId), role: schedule.role === "admin" ? "admin" : "user" }, { projectId: String(schedule.projectId), workflowId: String(schedule.workflowId) });
  console.log(JSON.stringify({ activated: result, projectId: schedule.projectId, workflowId: schedule.workflowId }));
} finally {
  await pool.end();
}
